'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  TransferRecord,
  DayRecord,
  ConfidenceLevel,
  GeminiExtractionResponse,
} from '@/types/transfer';
import { resizeImageForUpload } from '@/utils/imageResize';
import {
  computeTallyWithDuplicates,
  formatETB,
  normalizeReference,
} from '@/utils/tally';
import {
  getSavedDays,
  saveDayRecord,
  deleteDayRecord,
  exportTransfersToCsv,
} from '@/utils/storage';
import { extractWithOcr, getOcrConcurrency, prewarmOcr, terminateOcrWorker } from '@/utils/ocr';

const MAX_UPLOAD_FILE_SIZE = 15 * 1024 * 1024; // 15MB file cap
const MAX_EXTRACTION_ATTEMPTS = 3; // 1 initial request + up to 2 retries
const RETRY_BACKOFF_SECONDS = 5;

const ETHIOPIAN_BANKS = [
  'Telebirr',
  'Commercial Bank of Ethiopia (CBE)',
  'Awash Bank',
  'Bank of Abyssinia',
  'Dashen Bank',
  'Zemen Bank',
  'Hibret Bank',
  'Cooperative Bank of Oromia',
  'CBE Birr',
];

/**
 * Returns YYYY-MM-DD formatted for the local calendar date without UTC offset shifts.
 */
function getLocalTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Safe unique ID generator using crypto.randomUUID with fallback.
 */
function generateTransferId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `t_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type ExtractionAttempt =
  | { kind: 'success'; data: GeminiExtractionResponse }
  | { kind: 'retry'; message: string; retryAfterSeconds?: number }
  | { kind: 'fatal'; message: string };

/**
 * How receipt data is read:
 * - 'on-device': local OCR only. Images are never sent to AI (free + private),
 *   and anything unreadable is left for the cashier to type.
 * - 'hybrid': local OCR first; the AI extractor is called only when OCR cannot
 *   confidently read the amount + reference.
 * - 'ai': always use the Gemini extractor (most accurate, uses quota).
 */
type ExtractionMode = 'on-device' | 'hybrid' | 'ai';

const EXTRACTION_MODE_STORAGE_KEY = 'tt_extraction_mode';

function readStoredExtractionMode(): ExtractionMode {
  if (typeof window === 'undefined') return 'hybrid';
  const raw = localStorage.getItem(EXTRACTION_MODE_STORAGE_KEY);
  return raw === 'on-device' || raw === 'hybrid' || raw === 'ai' ? raw : 'hybrid';
}

/**
 * Performs a single extraction request and classifies the outcome so the caller
 * can decide whether retrying is worthwhile (rate limits, server faults and
 * network failures) or pointless (validation / configuration errors).
 */
async function requestExtraction(
  image: string,
  mimeType: string,
  fileName: string
): Promise<ExtractionAttempt> {
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, mimeType, fileName }),
    });

    if (res.ok) {
      return { kind: 'success', data: (await res.json()) as GeminiExtractionResponse };
    }

    const errJson = await res.json().catch(() => null);
    const message =
      errJson && typeof errJson.error === 'string'
        ? errJson.error
        : `Extraction request failed (HTTP ${res.status}).`;

    // A missing API key is a configuration problem, not a transient fault —
    // never worth retrying (the AI fallback is optional, so this is expected
    // when the cashier runs without a Gemini key).
    if (errJson && errJson.missingApiKey) {
      return { kind: 'fatal', message };
    }

    // 429 (rate limit) and 5xx (transient server faults) are worth retrying.
    if (res.status === 429 || res.status >= 500) {
      // Prefer the server's own cooldown hint so a big nightly batch paces
      // itself instead of hammering the endpoint (and the API key quota).
      const headerSeconds = Number(res.headers.get('Retry-After'));
      const bodySeconds =
        errJson && typeof errJson.retryAfterSeconds === 'number'
          ? errJson.retryAfterSeconds
          : undefined;
      const retryAfterSeconds =
        Number.isFinite(headerSeconds) && headerSeconds > 0
          ? headerSeconds
          : bodySeconds;
      return { kind: 'retry', message, retryAfterSeconds };
    }
    return { kind: 'fatal', message };
  } catch {
    return {
      kind: 'retry',
      message: 'Network error while contacting the extraction service.',
    };
  }
}

export default function TransferTallyPage() {
  // Navigation: 'batch' | 'history'
  const [activeTab, setActiveTab] = useState<'batch' | 'history'>('batch');

  // Theme: 'light' | 'dark'
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Extraction mode: on-device OCR only, OCR + AI fallback, or AI only.
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('hybrid');

  // Day context (defaults to local YYYY-MM-DD)
  const [selectedDate, setSelectedDate] = useState<string>('');

  // Current batch of transfers
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);

  // Past saved days
  const [savedDays, setSavedDays] = useState<DayRecord[]>([]);
  const [expandedHistoryDayId, setExpandedHistoryDayId] = useState<string | null>(null);

  // Saved day currently loaded into the editor (if any). Its own reference
  // numbers must not be treated as cross-day duplicates.
  const [loadedDayId, setLoadedDayId] = useState<string | null>(null);

  // Processing Queue state
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  const [retryAttempt, setRetryAttempt] = useState<number | null>(null);

  // Edit Modal State
  const [editingTransfer, setEditingTransfer] = useState<TransferRecord | null>(null);

  // Image Zoom Lightbox State
  const [zoomedImage, setZoomedImage] = useState<{ url: string; title: string } | null>(null);

  // Toast notification and timer ref
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  // File Input Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const refreshHistoricalData = React.useCallback(() => {
    setSavedDays(getSavedDays());
  }, []);

  // Reference numbers from every saved day except the one currently loaded into
  // the editor, used to flag cross-day duplicates.
  const historicalRefs = useMemo(() => {
    const refs = new Set<string>();
    for (const day of savedDays) {
      if (loadedDayId && day.id === loadedDayId) continue;
      for (const t of day.transfers) {
        const ref = normalizeReference(t.reference_no);
        if (ref && !t.is_duplicate && !t.missing_reference) {
          refs.add(ref);
        }
      }
    }
    return refs;
  }, [savedDays, loadedDayId]);

  const showToast = React.useCallback((msg: string): void => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3500);
  }, []);

  // Initialize theme, today's local date, and load historical data on mount
  useEffect(() => {
    // Start downloading the OCR engine right away: the first scan should not
    // stall on a ~15MB download while the cashier waits.
    prewarmOcr();

    const timer = setTimeout(() => {
      setSelectedDate(getLocalTodayDateString());
      refreshHistoricalData();
      setExtractionMode(readStoredExtractionMode());

      const savedTheme = localStorage.getItem('tt_theme') as 'light' | 'dark' | null;
      if (savedTheme) {
        setTheme(savedTheme);
        document.documentElement.setAttribute('data-theme', savedTheme);
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const initial = prefersDark ? 'dark' : 'light';
        setTheme(initial);
        document.documentElement.setAttribute('data-theme', initial);
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      // Release the OCR worker (if one was ever started) on unmount.
      void terminateOcrWorker();
    };
  }, [refreshHistoricalData]);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('tt_theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const changeExtractionMode = (mode: ExtractionMode) => {
    setExtractionMode(mode);
    try {
      localStorage.setItem(EXTRACTION_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore storage failures (private mode / quota) — mode still applies.
    }
  };

  // Recompute tally and duplicates strictly in code
  const tally = useMemo(() => {
    return computeTallyWithDuplicates(transfers, historicalRefs);
  }, [transfers, historicalRefs]);

  /**
   * Batch upload and extraction with canvas resize, parallel on-device OCR and
   * 429 retries for the optional AI fallback.
   */
  const processFilesSequentially = async (files: File[]) => {
    if (!files.length) return;

    // Validate files before starting
    const validFiles: File[] = [];
    for (const file of files) {
      if (!file || !file.type.startsWith('image/') || file.size <= 0) {
        showToast(`Skipped ${file?.name || 'file'}: not a valid image.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_FILE_SIZE) {
        showToast(`Skipped ${file.name}: over 15MB`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      return;
    }

    setIsProcessing(true);
    setProgressTotal(validFiles.length);
    setProgressCurrent(0);

    // Read the batch with a small pool: up to getOcrConcurrency() images are
    // resized and OCR'd at the same time, so a night's screenshots finish in a
    // fraction of the sequential time. Results are written back by index to
    // preserve the order the cashier selected them in.
    const newExtractedTransfers: TransferRecord[] = new Array(validFiles.length);
    let nextIndex = 0;
    let completed = 0;

    const processOne = async (i: number): Promise<void> => {
      const file = validFiles[i];
      setProcessingStatus(`Resizing & preparing receipt ${i + 1} of ${validFiles.length}...`);

      try {
        // 1. Client-side canvas resize (max 1400px, JPEG 0.85)
        const resized = await resizeImageForUpload(file, 1400, 0.85);

        let result: GeminiExtractionResponse | null = null;

        // 2. On-device OCR first: free, private and quota-free. Skipped only in
        //    AI-only mode. The image is read locally and never uploaded here.
        if (extractionMode !== 'ai') {
          try {
            setProcessingStatus(
              `Reading receipt ${i + 1} of ${validFiles.length} on-device...`
            );
            const ocr = await extractWithOcr(resized.dataUrl, (p) => {
              setProcessingStatus(
                `Reading receipt ${i + 1} of ${validFiles.length} on-device... ${Math.round(
                  p * 100
                )}%`
              );
            });
            // Keep the on-device read when it clearly found amount + reference,
            // or when the cashier chose never to send images to AI.
            if (ocr.reliable || extractionMode === 'on-device') {
              result = ocr.fields;
            }
          } catch (ocrErr) {
            console.warn(`On-device OCR failed for ${file.name}:`, ocrErr);
            if (extractionMode === 'on-device') {
              throw new Error(
                'On-device reading is unavailable (it needs internet the first time).'
              );
            }
            // hybrid mode: fall through to the AI extractor below.
          }
        }

        // 3. AI fallback: used in AI-only mode, and in hybrid mode when the
        //    on-device read was not confident. Never used in on-device mode.
        if (!result) {
          for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt++) {
            setProcessingStatus(
              `Scanning receipt ${i + 1} of ${validFiles.length} with AI...`
            );

            const outcome = await requestExtraction(
              resized.base64,
              resized.mimeType,
              file.name
            );

            if (outcome.kind === 'success') {
              result = outcome.data;
              break;
            }

            // Validation / configuration errors will never succeed on retry.
            if (outcome.kind === 'fatal' || attempt >= MAX_EXTRACTION_ATTEMPTS) {
              throw new Error(outcome.message);
            }

            // Wait as long as the server asked (rate-limit cooldown), bounded so a
            // large nightly batch never stalls too long on a single image.
            const waitSeconds = Math.min(
              Math.max(outcome.retryAfterSeconds ?? RETRY_BACKOFF_SECONDS, 2),
              30
            );
            setRetryAttempt(attempt);
            for (let sec = waitSeconds; sec > 0; sec--) {
              setProcessingStatus(
                `Extraction service busy. Retrying in ${sec}s (attempt ${
                  attempt + 1
                } of ${MAX_EXTRACTION_ATTEMPTS})...`
              );
              await sleep(1000);
            }
            setRetryAttempt(null);
          }
        }

        // 4. Create transfer record with crypto ID
        const record: TransferRecord = {
          id: generateTransferId(),
          bank: result?.bank || 'Unknown Bank',
          amount: typeof result?.amount === 'number' ? result.amount : 0,
          sender_name: result?.sender_name || '',
          receiver_name: result?.receiver_name || '',
          date_time: result?.date_time || new Date().toLocaleString(),
          reference_no: result?.reference_no || '',
          confidence: (result?.confidence as ConfidenceLevel) || 'low',
          is_receipt: result?.is_receipt !== false,
          image_preview: resized.dataUrl,
          file_name: file.name,
          created_at: new Date().toISOString(),
        };

        newExtractedTransfers[i] = record;
      } catch (err: unknown) {
        console.error(`Error processing ${file.name}:`, err);
        const reason = err instanceof Error ? err.message : 'unknown error';
        // Add card with low confidence so cashier can enter data manually
        newExtractedTransfers[i] = {
          id: generateTransferId(),
          bank: 'Unknown / Review Required',
          amount: 0,
          sender_name: '',
          receiver_name: '',
          date_time: new Date().toLocaleString(),
          reference_no: '',
          confidence: 'low',
          is_receipt: false,
          file_name: file.name,
          created_at: new Date().toISOString(),
        };
        showToast(`Could not read ${file.name}: ${reason} Added it for manual entry.`);
      } finally {
        completed++;
        setProgressCurrent(completed);
      }
    };

    const concurrency = Math.min(getOcrConcurrency(), validFiles.length);
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (true) {
          // The increment is synchronous, so two loops never take the same index.
          const i = nextIndex++;
          if (i >= validFiles.length) return;
          await processOne(i);
        }
      })
    );

    // Append to batch
    setTransfers((prev) => [...prev, ...newExtractedTransfers]);
    setIsProcessing(false);
    setProgressCurrent(0);
    setProgressTotal(0);
    setProcessingStatus('');
    setRetryAttempt(null);

    // Reset file input values
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';

    // Summarize the batch result in one toast
    const nonReceiptInBatch = newExtractedTransfers.filter(
      (t) => t.is_receipt === false
    ).length;
    const counted = newExtractedTransfers.length - nonReceiptInBatch;
    if (nonReceiptInBatch > 0) {
      showToast(
        `Added ${newExtractedTransfers.length} images: ${counted} transfer(s) + ${nonReceiptInBatch} non-receipt(s) excluded.`
      );
    } else {
      showToast(`Added ${counted} transfer(s) to the batch.`);
    }
  };

  // Consume screenshots delivered through the Web Share Target flow. The
  // service worker parks shared images in the Cache API and redirects here with
  // ?shared=1; we pull them out once and start scanning automatically.
  useEffect(() => {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    const sharedState = new URLSearchParams(window.location.search).get('shared');
    if (!sharedState) return;

    let cancelled = false;

    (async () => {
      try {
        const cache = await caches.open('transfer-tally-shared');
        const countRes = await cache.match('/__shared_count');
        const count = countRes ? parseInt(await countRes.text(), 10) || 0 : 0;

        const files: File[] = [];
        for (let i = 0; i < count; i++) {
          const res = await cache.match(`/__shared_${i}`);
          if (!res) continue;
          const blob = await res.blob();
          const type = blob.type || 'image/jpeg';
          const ext = type.split('/')[1] || 'jpg';
          files.push(new File([blob], `shared_${i + 1}.${ext}`, { type }));
        }

        // Clear the hand-off cache whether or not any files were found.
        const keys = await cache.keys();
        await Promise.all(keys.map((key) => cache.delete(key)));

        if (cancelled) return;

        // Drop the query flag so a manual refresh does not re-process.
        window.history.replaceState({}, '', window.location.pathname);

        if (files.length > 0) {
          setActiveTab('batch');
          showToast(`Received ${files.length} shared image(s). Scanning...`);
          await processFilesSequentially(files);
        } else if (sharedState === 'error') {
          showToast('Could not receive the shared images — use Pick Screenshots instead.');
        }
      } catch (err) {
        console.error('Failed to import shared images:', err);
        if (!cancelled) showToast('Could not import the shared images.');
      }
    })();

    return () => {
      cancelled = true;
    };
    // Runs once on mount: the shared-image hand-off is a one-time import.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFilesSequentially(Array.from(e.target.files));
    }
  };

  /**
   * Save the current day to localStorage with quota protection feedback
   */
  const handleSaveDay = () => {
    if (transfers.length === 0) {
      showToast('No transfers to save.');
      return;
    }

    // Pre-save review: surface everything that was excluded or needs eyes,
    // so the cashier confirms the day's file is intentionally correct.
    const warnings: string[] = [];
    if (tally.duplicateCount > 0) {
      warnings.push(`${tally.duplicateCount} duplicate(s) excluded`);
    }
    if (tally.nonReceiptCount > 0) {
      warnings.push(`${tally.nonReceiptCount} non-receipt(s) excluded`);
    }
    if (tally.missingRefCount > 0) {
      warnings.push(`${tally.missingRefCount} missing-reference row(s) excluded`);
    }
    if (tally.lowConfidenceCount > 0) {
      warnings.push(`${tally.lowConfidenceCount} low-confidence row(s) counted`);
    }

    if (warnings.length > 0) {
      const proceed = window.confirm(
        `Day review for ${selectedDate}:\n` +
          `- ${tally.validCount} transfers will count (ETB ${formatETB(tally.totalAmount)})\n` +
          `- ${warnings.join('\n- ')}\n\n` +
          'Save the day with these rows?'
      );
      if (!proceed) {
        showToast('Save cancelled — review the flagged rows first.');
        return;
      }
    }

    const dayRecord: DayRecord = {
      id: selectedDate,
      date: selectedDate,
      total_amount: tally.totalAmount,
      transfer_count: tally.validCount,
      duplicate_count: tally.duplicateCount,
      transfers: tally.processedTransfers,
      saved_at: new Date().toISOString(),
    };

    const res = saveDayRecord(dayRecord);
    if (res.success) {
      refreshHistoricalData();
      if (res.previewsStripped) {
        showToast('Saved without receipt images (storage limit)');
      } else {
        showToast(`Saved ${tally.validCount} transfers for ${selectedDate}!`);
      }
    } else {
      showToast('Failed to save day to localStorage.');
    }
  };

  /**
   * Export CSV of current batch
   */
  const handleExportCsv = () => {
    if (transfers.length === 0) {
      showToast('No transfers to export.');
      return;
    }
    exportTransfersToCsv(selectedDate, tally.processedTransfers, tally.totalAmount);
    showToast(`Exported CSV for ${selectedDate}`);
  };

  /**
   * Delete a transfer row
   */
  const handleDeleteTransfer = (id: string) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id));
    showToast('Transfer deleted.');
  };

  /**
   * Save edited transfer from modal
   */
  const handleSaveEdit = (updated: TransferRecord) => {
    setTransfers((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setEditingTransfer(null);
    showToast('Transfer details updated.');
  };

  /**
   * Clear current batch
   */
  const handleClearBatch = () => {
    if (transfers.length === 0) return;
    if (window.confirm('Clear all transfers from the current screen?')) {
      setTransfers([]);
      setLoadedDayId(null);
      showToast('Cleared current batch.');
    }
  };

  /**
   * Load a saved day from history into current batch
   */
  const handleLoadDayIntoEditor = (day: DayRecord) => {
    setSelectedDate(day.date);
    setTransfers(day.transfers.map((t) => ({ ...t })));
    setLoadedDayId(day.id);
    setActiveTab('batch');
    showToast(`Loaded ${day.date} with ${day.transfers.length} transfers.`);
  };

  /**
   * Delete a saved day
   */
  const handleDeleteDay = (dayId: string) => {
    if (window.confirm(`Delete saved record for ${dayId}?`)) {
      deleteDayRecord(dayId);
      refreshHistoricalData();
      showToast(`Deleted ${dayId}`);
    }
  };

  return (
    <div className="app-container">
      {/* Hidden File Pickers */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* Header Actions */}
      <header className="header-actions">
        <div className="brand-row">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size static brand SVG; next/image adds an optimizer round-trip and no benefit for local SVG */}
          <img src="/icon.svg" alt="Transfer Tally Logo" className="brand-logo" />
          <h1 className="brand-title">Transfer Tally</h1>
        </div>
        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          aria-label="Toggle light or dark mode"
          title="Toggle light / dark mode"
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </header>

      {/* Sticky Top Bar with Daylight-Readable Total */}
      <section className="sticky-bar">
        <div className="total-hero">
          <div className="total-main">
            <span className="total-label">Day Total (Excluding Duplicates)</span>
            <div className="total-amount-row">
              <span className="total-currency">ETB</span>
              <span className="total-amount">{formatETB(tally.totalAmount)}</span>
            </div>
          </div>
          <div className="total-meta">
            <span className="badge-count">
              {tally.validCount} {tally.validCount === 1 ? 'transfer' : 'transfers'}
            </span>
            {tally.duplicateCount > 0 && (
              <span className="badge-dup-excluded">
                ⚠️ {tally.duplicateCount} dup excluded
              </span>
            )}
            {tally.missingRefCount > 0 && (
              <span
                style={{
                  background: '#fef3c7',
                  color: '#b45309',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                }}
              >
                ⚠️ {tally.missingRefCount} missing ref
              </span>
            )}
            {tally.nonReceiptCount > 0 && (
              <span
                style={{
                  background: '#fee2e2',
                  color: '#b91c1c',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                }}
              >
                🚫 {tally.nonReceiptCount} not a receipt
              </span>
            )}
            {tally.lowConfidenceCount > 0 && (
              <span
                style={{
                  background: '#fef3c7',
                  color: '#92400e',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                }}
              >
                🔍 {tally.lowConfidenceCount} review needed
              </span>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="nav-tabs">
          <button
            className={`tab-btn ${activeTab === 'batch' ? 'active' : ''}`}
            onClick={() => setActiveTab('batch')}
          >
            📋 Today&apos;s Batch ({transfers.length})
          </button>
          <button
            className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            🗄️ History ({savedDays.length})
          </button>
        </nav>
      </section>

      {/* Main Content Area */}
      <main className="main-content">
        {activeTab === 'batch' ? (
          <>
            {/* Upload Area */}
            <section className="upload-card">
              <div className="upload-icon-circle">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div>
                <h3>Upload Transfer Screenshots</h3>
                <p>Telebirr, CBE, Awash, or any Ethiopian mobile money receipt</p>
              </div>

              <div className="upload-buttons-row">
                <button
                  className="btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                >
                  📁 Pick Screenshots
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={isProcessing}
                >
                  📸 Take Photo
                </button>
              </div>

              <p className="upload-hint">
                Or share straight from your gallery: select the screenshots →
                Share → Transfer Tally.
              </p>

              <div className="extraction-mode-row">
                <label htmlFor="extraction-mode">Scan mode</label>
                <select
                  id="extraction-mode"
                  value={extractionMode}
                  onChange={(e) =>
                    changeExtractionMode(e.target.value as ExtractionMode)
                  }
                  disabled={isProcessing}
                >
                  <option value="hybrid">On-device + AI fallback (best accuracy)</option>
                  <option value="on-device">On-device only (no AI, private)</option>
                  <option value="ai">AI only</option>
                </select>
              </div>
            </section>

            {/* Processing Progress Bar & Status */}
            {isProcessing && (
              <section className="progress-card">
                <div className="progress-header">
                  <span>Processing Receipts</span>
                  <span>
                    {progressCurrent} of {progressTotal}
                  </span>
                </div>
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill"
                    style={{
                      width: `${
                        progressTotal > 0 ? (progressCurrent / progressTotal) * 100 : 0
                      }%`,
                    }}
                  />
                </div>
                <div className="progress-subtext">{processingStatus}</div>
                {retryAttempt !== null && (
                  <div className="rate-limit-banner">
                    ⏳ Extraction service is busy. Waiting before retry...
                  </div>
                )}
              </section>
            )}

            {/* Batch Controls & Date Selector */}
            <div className="section-header">
              <div className="section-title">
                <span>Receipt List</span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  ({tally.processedTransfers.length} items)
                </span>
              </div>
              <input
                type="date"
                className="day-picker-input"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                title="Select date for this tally"
              />
            </div>

            {/* Quick Action Strip (Save Day, Export CSV, Clear) */}
            {transfers.length > 0 && (
              <div className="action-strip">
                <button className="btn-primary" onClick={handleSaveDay}>
                  💾 Save Day
                </button>
                <button className="btn-secondary" onClick={handleExportCsv}>
                  📥 Export CSV
                </button>
                <button
                  className="btn-icon-text"
                  onClick={handleClearBatch}
                  title="Clear batch"
                >
                  🗑️
                </button>
              </div>
            )}

            {/* Transfer Cards List */}
            {tally.processedTransfers.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🧾</div>
                <h3>No transfers in current batch</h3>
                <p>
                  Upload or photograph your customers&apos; transfer screenshots above. Telebirr,
                  CBE, Awash and other Ethiopian receipts are read automatically, duplicates are
                  excluded, and the day&apos;s total is calculated for you.
                </p>
              </div>
            ) : (
              <div className="cards-list" id="transfers-list">
                {tally.processedTransfers.map((item, idx) => {
                  const isLowConfidence = item.confidence === 'low';
                  const isDuplicate = Boolean(item.is_duplicate);
                  const isMissingRef = Boolean(item.missing_reference);

                  return (
                    <article
                      key={item.id}
                      className={`transfer-card ${
                        isLowConfidence ? 'low-confidence' : ''
                      } ${isDuplicate ? 'is-duplicate' : ''}`}
                      id={`card-${item.id}`}
                    >
                      {/* Top Row: Bank Info & Badges */}
                      <div className="card-top-row">
                        <div className="bank-info">
                          <div className="bank-avatar">
                            {item.bank ? item.bank.substring(0, 2).toUpperCase() : 'BK'}
                          </div>
                          <div>
                            <div className="bank-name">
                              {item.bank || 'Unknown Bank'}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                              #{idx + 1} • {item.date_time || 'No date'}
                            </div>
                          </div>
                        </div>

                        <div className="badges-group">
                          {isDuplicate ? (
                            <span className="badge badge-dup">
                              ⚠️ Duplicate (Excluded)
                            </span>
                          ) : !Boolean(item.is_receipt) ? (
                            <span className="badge badge-low">
                              🚫 Not a Receipt (Excluded)
                            </span>
                          ) : isMissingRef ? (
                            <span className="badge badge-low">
                              ⚠️ Needs Ref (Excluded)
                            </span>
                          ) : (
                            <span
                              className={`badge ${
                                item.confidence === 'high'
                                  ? 'badge-high'
                                  : item.confidence === 'medium'
                                  ? 'badge-med'
                                  : 'badge-low'
                              }`}
                            >
                              {item.confidence === 'high'
                                ? '✓ High'
                                : item.confidence === 'medium'
                                ? '• Medium'
                                : '⚠️ Low Confidence'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Amount Container */}
                      <div className="card-amount-box">
                        <span className="amount-currency">AMOUNT (ETB)</span>
                        <span className="amount-value">{formatETB(item.amount)}</span>
                      </div>

                      {/* Details Grid */}
                      <div className="details-grid">
                        <div className="detail-item">
                          <span className="detail-label">Reference No (Txn ID)</span>
                          <span className="detail-value detail-ref">
                            {item.reference_no || '(Empty - Needs Review)'}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Sender (Payer)</span>
                          <span className="detail-value">
                            {item.sender_name || '—'}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Receiver (Beneficiary)</span>
                          <span className="detail-value">
                            {item.receiver_name || '—'}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Receipt Status</span>
                          <span className="detail-value">
                            {item.is_receipt
                              ? 'Payment Confirmed'
                              : 'Not a receipt (Excluded)'}
                          </span>
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <footer className="card-footer">
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {item.image_preview && (
                            <button
                              className="btn-icon-text"
                              onClick={() =>
                                setZoomedImage({
                                  url: item.image_preview!,
                                  title: `${item.bank} - Ref: ${item.reference_no || 'No ref'}`,
                                })
                              }
                            >
                              🔍 View Receipt
                            </button>
                          )}
                          <button
                            className="btn-icon-text"
                            onClick={() => setEditingTransfer(item)}
                          >
                            ✏️ Edit
                          </button>
                        </div>

                        <button
                          className="btn-icon-text btn-delete"
                          onClick={() => handleDeleteTransfer(item.id)}
                          title="Delete this row"
                        >
                          🗑️ Delete
                        </button>
                      </footer>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          /* History Tab */
          <div className="cards-list">
            <div className="section-header">
              <div className="section-title">Saved Day Archives</div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Stored in browser localStorage
              </span>
            </div>

            {savedDays.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📂</div>
                <h3>No saved days yet</h3>
                <p>
                  At the end of the day, click &quot;Save Day&quot; in the batch tab to archive that
                  day&apos;s transfers and total amount.
                </p>
              </div>
            ) : (
              savedDays.map((day) => {
                const isExpanded = expandedHistoryDayId === day.id;

                return (
                  <article key={day.id} className="history-day-card">
                    <div className="history-header">
                      <div>
                        <div className="history-date">📅 {day.date}</div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          {day.transfer_count} valid transfers • {day.duplicate_count} duplicates
                          {day.previews_stripped && (
                            <span style={{ color: '#b45309', marginLeft: '6px', fontWeight: 600 }}>
                              • (Images removed for quota)
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="history-total">ETB {formatETB(day.total_amount)}</div>
                    </div>

                    <div className="history-actions">
                      <button
                        className="btn-secondary"
                        style={{ minHeight: '40px', padding: '6px 12px' }}
                        onClick={() =>
                          setExpandedHistoryDayId(isExpanded ? null : day.id)
                        }
                      >
                        {isExpanded ? '▲ Hide Details' : '▼ Expand'}
                      </button>
                      <button
                        className="btn-secondary"
                        style={{ minHeight: '40px', padding: '6px 12px' }}
                        onClick={() =>
                          exportTransfersToCsv(day.date, day.transfers, day.total_amount)
                        }
                      >
                        📥 CSV
                      </button>
                      <button
                        className="btn-primary"
                        style={{ minHeight: '40px', padding: '6px 12px' }}
                        onClick={() => handleLoadDayIntoEditor(day)}
                      >
                        Load to Editor
                      </button>
                      <button
                        className="btn-icon-text btn-delete"
                        style={{ minHeight: '40px' }}
                        onClick={() => handleDeleteDay(day.id)}
                      >
                        🗑️
                      </button>
                    </div>

                    {/* Expanded Day Details Table */}
                    {isExpanded && (
                      <div
                        style={{
                          marginTop: '8px',
                          borderTop: '1px solid var(--border-light)',
                          paddingTop: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        {day.transfers.map((t, idx) => (
                          <div
                            key={t.id || idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: '0.85rem',
                              padding: '6px 8px',
                              background: t.is_duplicate
                                ? 'var(--badge-dup-bg)'
                                : 'var(--bg-subtle)',
                              borderRadius: '6px',
                            }}
                          >
                            <div>
                              <strong>{t.bank}</strong> • Ref: {t.reference_no || '(Empty)'}
                              {t.is_duplicate && (
                                <span
                                  style={{
                                    color: '#b91c1c',
                                    fontWeight: 'bold',
                                    marginLeft: '6px',
                                  }}
                                >
                                  (Duplicate)
                                </span>
                              )}
                              {t.missing_reference && (
                                <span
                                  style={{
                                    color: '#b45309',
                                    fontWeight: 'bold',
                                    marginLeft: '6px',
                                  }}
                                >
                                  (Missing Ref)
                                </span>
                              )}
                              {t.is_receipt === false && (
                                <span
                                  style={{
                                    color: '#b91c1c',
                                    fontWeight: 'bold',
                                    marginLeft: '6px',
                                  }}
                                >
                                  (Not a receipt)
                                </span>
                              )}
                            </div>
                            <div style={{ fontWeight: '800' }}>
                              ETB {formatETB(t.amount)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        )}
      </main>

      {/* Edit Modal Sheet */}
      {editingTransfer && (
        <div className="modal-overlay" onClick={() => setEditingTransfer(null)}>
          <div
            className="modal-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Edit transfer"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Edit Transfer</h2>
              <button
                className="btn-close"
                onClick={() => setEditingTransfer(null)}
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveEdit(editingTransfer);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              <div className="form-group">
                <label className="form-label">Bank / Mobile Money Provider</label>
                <input
                  type="text"
                  className="form-input"
                  list="bank-suggestions"
                  value={editingTransfer.bank}
                  onChange={(e) =>
                    setEditingTransfer({ ...editingTransfer, bank: e.target.value })
                  }
                  required
                />
                <datalist id="bank-suggestions">
                  {ETHIOPIAN_BANKS.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>

              <div className="form-group">
                <label className="form-label">Transferred Amount (ETB)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="form-input"
                  value={editingTransfer.amount}
                  onChange={(e) =>
                    setEditingTransfer({
                      ...editingTransfer,
                      amount: parseFloat(e.target.value) || 0,
                    })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Reference Number (Txn ID)</label>
                <input
                  type="text"
                  className="form-input"
                  value={editingTransfer.reference_no}
                  onChange={(e) =>
                    setEditingTransfer({
                      ...editingTransfer,
                      reference_no: e.target.value,
                    })
                  }
                  placeholder="e.g. TLB88941203"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Sender Name (Payer)</label>
                <input
                  type="text"
                  className="form-input"
                  value={editingTransfer.sender_name}
                  onChange={(e) =>
                    setEditingTransfer({
                      ...editingTransfer,
                      sender_name: e.target.value,
                    })
                  }
                />
              </div>

              <div className="form-group">
                <label className="form-label">Receiver Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={editingTransfer.receiver_name}
                  onChange={(e) =>
                    setEditingTransfer({
                      ...editingTransfer,
                      receiver_name: e.target.value,
                    })
                  }
                />
              </div>

              <div className="form-group">
                <label className="form-label">Date / Time</label>
                <input
                  type="text"
                  className="form-input"
                  value={editingTransfer.date_time}
                  onChange={(e) =>
                    setEditingTransfer({
                      ...editingTransfer,
                      date_time: e.target.value,
                    })
                  }
                />
              </div>

              <div className="form-group">
                <label className="form-label">Is this a payment receipt?</label>
                <select
                  className="form-input"
                  value={editingTransfer.is_receipt ? 'yes' : 'no'}
                  onChange={(e) =>
                    setEditingTransfer({
                      ...editingTransfer,
                      is_receipt: e.target.value === 'yes',
                    })
                  }
                >
                  <option value="yes">Yes — count in the total</option>
                  <option value="no">No — not a receipt (excluded)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Confidence</label>
                <select
                  className="form-input"
                  value={editingTransfer.confidence}
                  onChange={(e) =>
                    setEditingTransfer({
                      ...editingTransfer,
                      confidence: e.target.value as ConfidenceLevel,
                    })
                  }
                >
                  <option value="high">High (Certain)</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low (Needs verification)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" className="btn-primary">
                  💾 Save Changes
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingTransfer(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Preview Lightbox */}
      {zoomedImage && (
        <div className="modal-overlay" onClick={() => setZoomedImage(null)}>
          <div
            className="modal-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Receipt preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>{zoomedImage.title}</h2>
              <button className="btn-close" onClick={() => setZoomedImage(null)}>
                ✕
              </button>
            </div>
            <div className="image-zoom-container">
              {/* eslint-disable-next-line @next/next/no-img-element -- src is a runtime data URL / blob preview; next/image does not optimize those and would add no value here */}
              <img
                src={zoomedImage.url}
                alt="Receipt Full Preview"
                className="image-zoom-img"
              />
            </div>
          </div>
        </div>
      )}

      {/* Toast Feedback — polite live region so screen readers announce it */}
      {toastMessage && (
        <div className="toast" role="status" aria-live="polite">
          ℹ️ {toastMessage}
        </div>
      )}
    </div>
  );
}
