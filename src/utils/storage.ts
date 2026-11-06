import { DayRecord, TransferRecord, SaveDayResult } from '@/types/transfer';

const STORAGE_KEY = 'days';
const MAX_STORAGE_BYTES = 4.5 * 1024 * 1024; // 4.5MB threshold to prevent localStorage quota exhaustion

/**
 * Type guard for runtime shape validation of DayRecord entries.
 */
function isValidDayRecord(item: unknown): item is DayRecord {
  if (!item || typeof item !== 'object') return false;
  const rec = item as Record<string, unknown>;
  if (typeof rec.id !== 'string' || !rec.id.trim()) return false;
  if (typeof rec.date !== 'string' || !rec.date.trim()) return false;
  if (typeof rec.total_amount !== 'number' || !Number.isFinite(rec.total_amount)) return false;
  if (!Array.isArray(rec.transfers)) return false;
  return true;
}

/**
 * Safely retrieve all saved days from localStorage with runtime validation.
 */
export function getSavedDays(): DayRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const validDays: DayRecord[] = [];
    for (const entry of parsed) {
      if (isValidDayRecord(entry)) {
        // Defensively sanitize transfers inside the entry
        entry.transfers = entry.transfers.filter(
          (t) => t && typeof t === 'object' && typeof t.amount === 'number'
        );
        validDays.push(entry);
      } else {
        console.warn('Skipping invalid DayRecord from localStorage:', entry);
      }
    }
    return validDays;
  } catch (err) {
    console.error('Failed to read days from localStorage:', err);
    return [];
  }
}

function stripPreviews(transfers: TransferRecord[]): TransferRecord[] {
  return transfers.map((t) => {
    const copy = { ...t };
    delete copy.image_preview;
    return copy;
  });
}

/**
 * Safely save or update a day in localStorage.
 * Checks serialized size against ~4.5MB limit. If exceeded, strips image_preview
 * from stored transfers and retries to prevent silent quota loss.
 */
export function saveDayRecord(day: DayRecord): SaveDayResult {
  if (typeof window === 'undefined') return { success: false, previewsStripped: false };
  try {
    const days = getSavedDays();
    const existingIndex = days.findIndex((d) => d.id === day.id);

    // Deep copy transfers so in-memory session retains image_previews
    const dayToStore: DayRecord = {
      ...day,
      transfers: day.transfers.map((t) => ({ ...t })),
    };

    if (existingIndex >= 0) {
      days[existingIndex] = dayToStore;
    } else {
      days.unshift(dayToStore);
    }

    let serialized = JSON.stringify(days);
    let previewsStripped = false;

    // If approaching 4.5MB limit, strip image_preview from dayToStore
    if (serialized.length > MAX_STORAGE_BYTES) {
      previewsStripped = true;
      dayToStore.previews_stripped = true;
      dayToStore.transfers = stripPreviews(dayToStore.transfers);

      if (existingIndex >= 0) {
        days[existingIndex] = dayToStore;
      } else {
        days[0] = dayToStore;
      }

      // If still exceeding, strip image_preview from older days as well
      for (let i = 0; i < days.length; i++) {
        if (JSON.stringify(days).length <= MAX_STORAGE_BYTES) break;
        days[i] = {
          ...days[i],
          previews_stripped: true,
          transfers: stripPreviews(days[i].transfers),
        };
      }

      serialized = JSON.stringify(days);
    }

    try {
      localStorage.setItem(STORAGE_KEY, serialized);
      return { success: true, previewsStripped };
    } catch (quotaErr) {
      // If browser quota exception was triggered, strip previews and retry once more
      console.warn('LocalStorage quota exceeded on first write. Stripping previews...', quotaErr);
      for (let i = 0; i < days.length; i++) {
        days[i] = {
          ...days[i],
          previews_stripped: true,
          transfers: stripPreviews(days[i].transfers),
        };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(days));
      return { success: true, previewsStripped: true };
    }
  } catch (err) {
    console.error('Failed to write day to localStorage:', err);
    return { success: false, previewsStripped: false };
  }
}

/**
 * Safely delete a day record from localStorage.
 */
export function deleteDayRecord(dayId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const days = getSavedDays();
    const filtered = days.filter((d) => d.id !== dayId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (err) {
    console.error('Failed to delete day from localStorage:', err);
    return false;
  }
}

/**
 * Sanitizes CSV field against formula injection (=, +, -, @, tab, CR)
 * and escapes double quotes.
 */
function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let str = String(value);

  // Prefix leading formula trigger characters with a single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Download a list of transfers as a clean CSV file with formula injection protection.
 */
export function exportTransfersToCsv(
  dateStr: string,
  transfers: TransferRecord[],
  totalAmount: number
) {
  const headers = [
    'Date / Time',
    'Bank',
    'Amount (ETB)',
    'Sender Name',
    'Receiver Name',
    'Reference No',
    'Confidence',
    'Status',
  ];

  const rows = transfers.map((t) => {
    let status = 'Valid';
    if (t.is_duplicate) {
      status = 'Duplicate (Excluded)';
    } else if (t.is_receipt === false) {
      status = 'Not a Receipt (Excluded)';
    } else if (t.missing_reference) {
      status = 'Missing Ref (Excluded)';
    }

    return [
      sanitizeCsvCell(t.date_time),
      sanitizeCsvCell(t.bank),
      t.amount.toFixed(2),
      sanitizeCsvCell(t.sender_name),
      sanitizeCsvCell(t.receiver_name),
      sanitizeCsvCell(t.reference_no),
      sanitizeCsvCell(t.confidence),
      sanitizeCsvCell(status),
    ];
  });

  const countedTransfers = transfers.filter(
    (t) => !t.is_duplicate && !t.missing_reference && t.is_receipt !== false
  );

  // Add summary footer rows
  rows.push([]);
  rows.push([
    sanitizeCsvCell('TOTAL VALID TRANSFERS'),
    '""',
    totalAmount.toFixed(2),
    '""',
    '""',
    '""',
    '""',
    sanitizeCsvCell(`${countedTransfers.length} transfers`),
  ]);

  const csvContent =
    '\uFEFF' + // UTF-8 BOM for Excel compatibility with Amharic / special characters
    [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `TransferTally_${dateStr.replace(/[^0-9-]/g, '_')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
