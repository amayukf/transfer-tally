'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TransferRecord, DayRecord, ConfidenceLevel } from '@/types/transfer';
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
  getVerifyCache,
  setVerifyCacheEntry,
  type CachedVerification,
} from '@/utils/storage';
import { providerLabel } from '@/utils/linksEt';
import type { VerifyApiResponse } from '@/app/api/verify/route';
import {
  translate,
  readStoredLanguage,
  LANGUAGE_STORAGE_KEY,
  type Language,
} from '@/utils/i18n';

const MAX_UPLOAD_FILE_SIZE = 15 * 1024 * 1024; // 15MB file cap
// One initial request plus one retry: a retry usually hits links.et's cache,
// because the first call already made the bank fetch the receipt.
const VERIFY_MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_SECONDS = 4;
// /api/verify is rate-limited per IP (default 20/min) and each call spends a
// metered screenshot read, so only a few screenshots are checked at a time.
const VERIFY_CONCURRENCY = 3;
// links.et accepts 5MB of base64 per image.
const MAX_VERIFY_BASE64_CHARS = 5 * 1024 * 1024;
const VERIFY_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** links.et `upstream.reason` values this app knows how to explain. */
const KNOWN_VERIFY_REASONS = [
  'unsupported_provider',
  'no_reference',
  'provider_needs_full_url',
  'upstream_failed',
  'qr_receipt',
  'not_completed',
  'amount_not_found',
];

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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Prepares the image sent to links.et. The original bytes are preferred,
 * because the bank detector reads small digits far better than a downscaled
 * copy; only oversized photos are re-encoded for the 5MB base64 limit.
 */
async function buildVerifyPayload(file: File): Promise<{ image: string; mimeType: string }> {
  const dataUrl = await readFileAsDataUrl(file);
  const originalBase64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
  const originalMime = file.type || 'image/jpeg';

  if (
    originalBase64.length <= MAX_VERIFY_BASE64_CHARS &&
    VERIFY_MIME_TYPES.includes(originalMime)
  ) {
    return { image: originalBase64, mimeType: originalMime };
  }

  const resized = await resizeImageForUpload(file, 2600, 0.92);
  return { image: resized.base64, mimeType: resized.mimeType };
}

/**
 * Fingerprints the exact file bytes so re-scanning the same screenshot reuses
 * the earlier result instead of spending another metered screenshot read.
 */
async function fingerprintFile(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return ''; // Hashing unavailable (insecure context): always call the API.
  }
}

type VerifyAttempt =
  | { kind: 'outcome'; value: VerifyApiResponse }
  | { kind: 'retry'; message: string; retryAfterSeconds?: number }
  | { kind: 'fatal'; message: string; variant?: 'quota' | 'key' };

/**
 * Performs a single bank verification through our own /api/verify proxy (the
 * links.et key is a server-side credential) and classifies the outcome so the
 * caller can decide whether a retry is worthwhile.
 */
async function requestVerification(
  image: string,
  mimeType: string,
  translateMessage: (key: string) => string
): Promise<VerifyAttempt> {
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, mimeType }),
    });

    if (res.ok) {
      return { kind: 'outcome', value: (await res.json()) as VerifyApiResponse };
    }

    const errJson = await res.json().catch(() => null);
    const message =
      errJson && typeof errJson.error === 'string'
        ? errJson.error
        : `Verification failed (HTTP ${res.status}).`;

    // Configuration and quota problems never succeed on retry.
    if (errJson?.missingApiKey) return { kind: 'fatal', message, variant: 'key' };
    if (errJson?.quotaExceeded) return { kind: 'fatal', message, variant: 'quota' };

    if (res.status === 429 || res.status >= 500) {
      const headerSeconds = Number(res.headers.get('Retry-After'));
      const bodySeconds =
        errJson && typeof errJson.retryAfterSeconds === 'number'
          ? errJson.retryAfterSeconds
          : undefined;
      const retryAfterSeconds =
        Number.isFinite(headerSeconds) && headerSeconds > 0 ? headerSeconds : bodySeconds;
      return { kind: 'retry', message, retryAfterSeconds };
    }
    return { kind: 'fatal', message };
  } catch {
    return { kind: 'retry', message: translateMessage('err.network') };
  }
}

export default function TransferTallyPage() {
  // Navigation: 'batch' | 'history'
  const [activeTab, setActiveTab] = useState<'batch' | 'history'>('batch');

  // Theme: 'light' | 'dark'
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // UI language: 'en' | 'am'
  const [language, setLanguage] = useState<Language>('en');

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

  // Image-fingerprint → bank result, held in memory for this session and
  // mirrored to localStorage so the same screenshot never bills twice.
  const verifyCacheRef = useRef<Record<string, CachedVerification>>({});

  // Translation helper bound to the active language.
  const t = (key: string, vars?: Record<string, string | number>): string =>
    translate(language, key, vars);

  /** Explains why the bank did not confirm a transfer, with a safe fallback. */
  const verifyReasonText = (reason?: string): string =>
    t(
      `verify.reason.${
        reason && KNOWN_VERIFY_REASONS.includes(reason) ? reason : 'unknown'
      }`
    );

  const refreshHistoricalData = React.useCallback(() => {
    setSavedDays(getSavedDays());
  }, []);

  // Reference numbers from every saved day except the one currently loaded into
  // the editor, used to flag cross-day duplicates.
  const historicalRefs = useMemo(() => {
    const refs = new Set<string>();
    for (const day of savedDays) {
      if (loadedDayId && day.id === loadedDayId) continue;
      for (const transfer of day.transfers) {
        const ref = normalizeReference(transfer.reference_no);
        if (ref && !transfer.is_duplicate && !transfer.missing_reference) {
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

  // Initialize theme, language, today's local date, and load historical data on mount
  useEffect(() => {
    // Load the bank-verification cache up front so re-scanning a screenshot
    // already checked on this device never spends another metered read.
    verifyCacheRef.current = getVerifyCache();

    const timer = setTimeout(() => {
      setSelectedDate(getLocalTodayDateString());
      refreshHistoricalData();

      const savedLanguage = readStoredLanguage();
      setLanguage(savedLanguage);
      document.documentElement.setAttribute('lang', savedLanguage);

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
    };
  }, [refreshHistoricalData]);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('tt_theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const toggleLanguage = () => {
    const next: Language = language === 'en' ? 'am' : 'en';
    setLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures (private mode / quota) — language still applies.
    }
    document.documentElement.setAttribute('lang', next);
  };

  // Recompute tally and duplicates strictly in code
  const tally = useMemo(() => {
    return computeTallyWithDuplicates(transfers, historicalRefs);
  }, [transfers, historicalRefs]);

  /**
   * Batch upload: every screenshot is checked with the bank through links.et
   * (proxied by /api/verify) and the row is built from the bank's own receipt,
   * never from the pixels of the image.
   */
  const processFilesSequentially = async (files: File[]) => {
    if (!files.length) return;

    // Validate files before starting
    const validFiles: File[] = [];
    for (const file of files) {
      if (!file || !file.type.startsWith('image/') || file.size <= 0) {
        showToast(t('toast.invalidImage', { name: file?.name || 'file' }));
        continue;
      }
      if (file.size > MAX_UPLOAD_FILE_SIZE) {
        showToast(t('toast.tooLarge', { name: file.name }));
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

    // Check the batch with a small pool: only a few screenshots are verified
    // at once, because each one is a rate-limited, metered links.et call.
    // Results are written back by index to preserve the order the cashier
    // selected them in.
    const newExtractedTransfers: TransferRecord[] = new Array(validFiles.length);
    let nextIndex = 0;
    let completed = 0;

    const processOne = async (i: number): Promise<void> => {
      const file = validFiles[i];
      setProcessingStatus(t('status.preparing', { i: i + 1, n: validFiles.length }));

      try {
        // 1. Small local copy used only for the cashier's preview thumbnail.
        const preview = await resizeImageForUpload(file, 1000, 0.8);
        const fingerprint = await fingerprintFile(file);

        let outcome: VerifyApiResponse | null = null;
        let failureMessage = '';
        let failureVariant: 'quota' | 'key' | undefined;

        // 2. The same screenshot checked before on this device is reused: the
        //    bank's answer cannot change for the same picture, and a cached
        //    result costs nothing.
        const cached = fingerprint ? verifyCacheRef.current[fingerprint] : undefined;
        if (cached) {
          setProcessingStatus(t('status.cachedCheck', { i: i + 1, n: validFiles.length }));
          outcome =
            cached.outcome === 'verified' && cached.receipt
              ? { ok: true, status: 'verified', receipt: cached.receipt }
              : {
                  ok: true,
                  status: 'unverified',
                  reason: cached.reason || 'unsupported_provider',
                  provider: cached.provider,
                  reference: cached.reference,
                };
        } else {
          const payload = await buildVerifyPayload(file);

          for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
            setProcessingStatus(t('status.verifying', { i: i + 1, n: validFiles.length }));

            const result = await requestVerification(payload.image, payload.mimeType, t);
            if (result.kind === 'outcome') {
              outcome = result.value;
              break;
            }
            if (result.kind === 'fatal') {
              failureMessage = result.message;
              failureVariant = result.variant;
              break;
            }
            if (attempt >= VERIFY_MAX_ATTEMPTS) {
              failureMessage = result.message;
              break;
            }

            // Wait as long as the server asked, bounded so a large batch never
            // stalls on a single screenshot. A retry usually hits links.et's
            // cache, because the first call already made the bank fetch it.
            const waitSeconds = Math.min(
              Math.max(result.retryAfterSeconds ?? RETRY_BACKOFF_SECONDS, 2),
              20
            );
            setRetryAttempt(attempt);
            for (let sec = waitSeconds; sec > 0; sec--) {
              setProcessingStatus(
                t('status.retrying', {
                  s: sec,
                  a: attempt + 1,
                  b: VERIFY_MAX_ATTEMPTS,
                })
              );
              await sleep(1000);
            }
            setRetryAttempt(null);
          }
        }
        setRetryAttempt(null);

        if (!outcome) {
          throw Object.assign(new Error(failureMessage || t('err.network')), {
            variant: failureVariant,
          });
        }

        // 3. Park the bank's answer against the image fingerprint.
        if (fingerprint) {
          const entry: CachedVerification =
            outcome.status === 'verified'
              ? {
                  outcome: 'verified',
                  receipt: outcome.receipt,
                  saved_at: new Date().toISOString(),
                }
              : {
                  outcome: 'unverified',
                  reason: outcome.reason,
                  provider: outcome.provider,
                  reference: outcome.reference,
                  saved_at: new Date().toISOString(),
                };
          verifyCacheRef.current[fingerprint] = entry;
          setVerifyCacheEntry(fingerprint, entry);
        }

        if (outcome.status === 'verified') {
          // 4a. The row IS the bank's receipt — amount, payer and time all come
          //     from the bank, so a doctored screenshot cannot get through.
          const r = outcome.receipt;
          newExtractedTransfers[i] = {
            id: generateTransferId(),
            bank: providerLabel(r.provider) || r.provider || t('card.unknownBank'),
            amount: r.amount,
            sender_name: r.payer_name,
            receiver_name: r.receiver_name,
            date_time: r.paid_at || new Date().toLocaleString(),
            reference_no: r.reference,
            confidence: 'high',
            is_receipt: true,
            verification: 'verified',
            verified_receipt: r,
            image_preview: preview.dataUrl,
            file_name: file.name,
            created_at: new Date().toISOString(),
          };
        } else {
          // 4b. Not confirmed. The cashier types the amount and reference by
          //     hand; the row stays flagged as unverified.
          newExtractedTransfers[i] = {
            id: generateTransferId(),
            bank: providerLabel(outcome.provider) || '',
            amount: 0,
            sender_name: '',
            receiver_name: '',
            date_time: new Date().toLocaleString(),
            reference_no: outcome.reference || '',
            confidence: 'low',
            is_receipt: true,
            verification: 'unverified',
            verification_note: outcome.reason,
            image_preview: preview.dataUrl,
            file_name: file.name,
            created_at: new Date().toISOString(),
          };
        }
      } catch (err: unknown) {
        console.error(`Error verifying ${file.name}:`, err);
        const reason = err instanceof Error ? err.message : 'unknown error';
        const variant =
          err && typeof err === 'object' && 'variant' in err
            ? (err as { variant?: 'quota' | 'key' }).variant
            : undefined;

        if (variant === 'quota') {
          showToast(t('toast.quotaExceeded'));
        } else if (variant === 'key') {
          showToast(t('toast.keyMissing'));
        } else {
          showToast(t('toast.verifyFailed', { name: file.name, reason }));
        }

        // Keep the card so the cashier can still enter the transfer by hand.
        newExtractedTransfers[i] = {
          id: generateTransferId(),
          bank: '',
          amount: 0,
          sender_name: '',
          receiver_name: '',
          date_time: new Date().toLocaleString(),
          reference_no: '',
          confidence: 'low',
          is_receipt: true,
          verification: 'unverified',
          verification_note: 'upstream_failed',
          file_name: file.name,
          created_at: new Date().toISOString(),
        };
      } finally {
        completed++;
        setProgressCurrent(completed);
      }
    };

    const concurrency = Math.min(VERIFY_CONCURRENCY, validFiles.length);
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
    const verifiedInBatch = newExtractedTransfers.filter(
      (transfer) => transfer.verification === 'verified'
    ).length;
    const unverifiedInBatch = newExtractedTransfers.length - verifiedInBatch;
    if (unverifiedInBatch > 0) {
      showToast(
        t('toast.batchChecked', {
          n: newExtractedTransfers.length,
          verified: verifiedInBatch,
          unverified: unverifiedInBatch,
        })
      );
    } else {
      showToast(t('toast.verified', { n: verifiedInBatch }));
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
          showToast(t('toast.sharedReceived', { n: files.length }));
          await processFilesSequentially(files);
        } else if (sharedState === 'error') {
          showToast(t('toast.sharedError'));
        }
      } catch (err) {
        console.error('Failed to import shared images:', err);
        if (!cancelled) showToast(t('toast.sharedImportFailed'));
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
      showToast(t('toast.nothingToSave'));
      return;
    }

    // Pre-save review: surface everything that was excluded or needs eyes,
    // so the cashier confirms the day's file is intentionally correct.
    const warnings: string[] = [];
    if (tally.duplicateCount > 0) {
      warnings.push(t('review.duplicates', { n: tally.duplicateCount }));
    }
    if (tally.nonReceiptCount > 0) {
      warnings.push(t('review.nonReceipt', { n: tally.nonReceiptCount }));
    }
    if (tally.missingRefCount > 0) {
      warnings.push(t('review.missingRef', { n: tally.missingRefCount }));
    }
    if (tally.lowConfidenceCount > 0) {
      warnings.push(t('review.lowConfidence', { n: tally.lowConfidenceCount }));
    }

    if (warnings.length > 0) {
      const proceed = window.confirm(
        `${t('review.header', { date: selectedDate })}\n` +
          `${t('review.counts', {
            n: tally.validCount,
            total: formatETB(tally.totalAmount),
          })}\n` +
          `- ${warnings.join('\n- ')}\n\n` +
          t('review.ask')
      );
      if (!proceed) {
        showToast(t('toast.saveCancelled'));
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
        showToast(t('toast.savedNoImages'));
      } else {
        showToast(t('toast.saved', { n: tally.validCount, date: selectedDate }));
      }
    } else {
      showToast(t('toast.saveFailed'));
    }
  };

  /**
   * Export CSV of current batch
   */
  const handleExportCsv = () => {
    if (transfers.length === 0) {
      showToast(t('toast.nothingToExport'));
      return;
    }
    exportTransfersToCsv(selectedDate, tally.processedTransfers, tally.totalAmount);
    showToast(t('toast.exported', { date: selectedDate }));
  };

  /**
   * Delete a transfer row
   */
  const handleDeleteTransfer = (id: string) => {
    setTransfers((prev) => prev.filter((transfer) => transfer.id !== id));
    showToast(t('toast.deleted'));
  };

  /**
   * Save edited transfer from modal
   */
  const handleSaveEdit = (updated: TransferRecord) => {
    setTransfers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    setEditingTransfer(null);
    showToast(t('toast.updated'));
  };

  /**
   * Clear current batch
   */
  const handleClearBatch = () => {
    if (transfers.length === 0) return;
    if (window.confirm(t('toast.clearConfirm'))) {
      setTransfers([]);
      setLoadedDayId(null);
      showToast(t('toast.cleared'));
    }
  };

  /**
   * Load a saved day from history into current batch
   */
  const handleLoadDayIntoEditor = (day: DayRecord) => {
    setSelectedDate(day.date);
    setTransfers(day.transfers.map((transfer) => ({ ...transfer })));
    setLoadedDayId(day.id);
    setActiveTab('batch');
    showToast(t('toast.loaded', { date: day.date, n: day.transfers.length }));
  };

  /**
   * Delete a saved day
   */
  const handleDeleteDay = (dayId: string) => {
    if (window.confirm(t('toast.deleteDayConfirm', { id: dayId }))) {
      deleteDayRecord(dayId);
      refreshHistoricalData();
      showToast(t('toast.dayDeleted', { id: dayId }));
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
          <img src="/icon.svg" alt="Transfer Tally" className="brand-logo" />
          <h1 className="brand-title">Transfer Tally</h1>
        </div>
        <div className="header-actions-right">
          <button
            className="lang-toggle-btn"
            onClick={toggleLanguage}
            aria-label={t('header.toggleLanguageTitle')}
            title={t('header.toggleLanguageTitle')}
          >
            {language === 'en' ? 'አማ' : 'EN'}
          </button>
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            aria-label={t('header.toggleThemeTitle')}
            title={t('header.toggleThemeTitle')}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>

      {/* Sticky Top Bar with Daylight-Readable Total */}
      <section className="sticky-bar">
        <div className="total-hero">
          <div className="total-main">
            <span className="total-label">{t('total.label')}</span>
            <div className="total-amount-row">
              <span className="total-currency">{t('currency')}</span>
              <span className="total-amount">{formatETB(tally.totalAmount)}</span>
            </div>
          </div>
          <div className="total-meta">
            <span className="badge-count">
              {tally.validCount}{' '}
              {tally.validCount === 1 ? t('total.transfer') : t('total.transfers')}
            </span>
            {tally.duplicateCount > 0 && (
              <span className="badge-dup-excluded">
                ⚠️ {t('total.dupExcluded', { n: tally.duplicateCount })}
              </span>
            )}
            {tally.missingRefCount > 0 && (
              <span className="total-pill total-pill-warn">
                ⚠️ {t('total.missingRef', { n: tally.missingRefCount })}
              </span>
            )}
            {tally.nonReceiptCount > 0 && (
              <span className="total-pill total-pill-danger">
                🚫 {t('total.nonReceipt', { n: tally.nonReceiptCount })}
              </span>
            )}
            {tally.unverifiedCount > 0 && (
              <span className="total-pill total-pill-unverified">
                🛡️ {t('total.unverified', { n: tally.unverifiedCount })}
              </span>
            )}
            {tally.lowConfidenceCount > 0 && (
              <span className="total-pill total-pill-review">
                🔍 {t('total.reviewNeeded', { n: tally.lowConfidenceCount })}
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
            📋 {t('nav.batch')} ({transfers.length})
          </button>
          <button
            className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            🗄️ {t('nav.history')} ({savedDays.length})
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
                <h3>{t('upload.title')}</h3>
                <p>{t('upload.subtitle')}</p>
              </div>

              <div className="upload-buttons-row">
                <button
                  className="btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                >
                  📁 {t('upload.pick')}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={isProcessing}
                >
                  📸 {t('upload.camera')}
                </button>
              </div>

              <p className="upload-hint">{t('upload.shareHint')}</p>

              <div className="verify-note">
                <span aria-hidden="true">🛡️</span>
                <span>{t('upload.verifyHint')}</span>
              </div>
            </section>

            {/* Processing Progress Bar & Status */}
            {isProcessing && (
              <section className="progress-card">
                <div className="progress-header">
                  <span>{t('progress.title')}</span>
                  <span>{t('progress.of', { a: progressCurrent, b: progressTotal })}</span>
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
                  <div className="rate-limit-banner">{t('progress.rateLimited')}</div>
                )}
              </section>
            )}

            {/* Batch Controls & Date Selector */}
            <div className="section-header">
              <div className="section-title">
                <span>{t('list.title')}</span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {t('list.items', { n: tally.processedTransfers.length })}
                </span>
              </div>
              <input
                type="date"
                className="day-picker-input"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                title={t('list.dateTitle')}
              />
            </div>

            {/* Quick Action Strip (Save Day, Export CSV, Clear) */}
            {transfers.length > 0 && (
              <div className="action-strip">
                <button className="btn-primary" onClick={handleSaveDay}>
                  💾 {t('actions.saveDay')}
                </button>
                <button className="btn-secondary" onClick={handleExportCsv}>
                  📥 {t('actions.exportCsv')}
                </button>
                <button
                  className="btn-icon-text"
                  onClick={handleClearBatch}
                  title={t('actions.clearBatch')}
                  aria-label={t('actions.clearBatch')}
                >
                  🗑️
                </button>
              </div>
            )}

            {/* Transfer Cards List */}
            {tally.processedTransfers.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🧾</div>
                <h3>{t('empty.batchTitle')}</h3>
                <p>{t('empty.batchBody')}</p>
              </div>
            ) : (
              <div className="cards-list" id="transfers-list">
                {tally.processedTransfers.map((item, idx) => {
                  const isLowConfidence = item.confidence === 'low';
                  const isDuplicate = Boolean(item.is_duplicate);
                  const isMissingRef = Boolean(item.missing_reference);
                  const isVerified = item.verification === 'verified';
                  const isUnverified = item.verification === 'unverified';

                  return (
                    <article
                      key={item.id}
                      className={`transfer-card ${
                        isLowConfidence ? 'low-confidence' : ''
                      } ${isDuplicate ? 'is-duplicate' : ''} ${
                        isVerified ? 'is-verified' : ''
                      }`}
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
                              {item.bank || t('card.unknownBank')}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                              #{idx + 1} • {item.date_time || t('card.noDate')}
                            </div>
                          </div>
                        </div>

                        <div className="badges-group">
                          {isDuplicate ? (
                            <span className="badge badge-dup">{t('badge.duplicate')}</span>
                          ) : !Boolean(item.is_receipt) ? (
                            <span className="badge badge-low">{t('badge.notReceipt')}</span>
                          ) : isMissingRef ? (
                            <span className="badge badge-low">{t('badge.needsRef')}</span>
                          ) : isVerified ? (
                            <span className="badge badge-verified">
                              {t('verify.verifiedBadge')}
                            </span>
                          ) : isUnverified ? (
                            <span className="badge badge-unverified">
                              {t('verify.unverifiedBadge')}
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
                                ? t('badge.high')
                                : item.confidence === 'medium'
                                ? t('badge.medium')
                                : t('badge.low')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Amount Container — the bank's own figure once verified */}
                      <div className="card-amount-box">
                        <span className="amount-currency">
                          {isVerified ? t('verify.amountLabel') : t('card.amount')}
                        </span>
                        <span className="amount-value">{formatETB(item.amount)}</span>
                      </div>

                      {/* Bank verification outcome */}
                      {isVerified && (
                        <div className="verify-band verify-band-ok">
                          <span aria-hidden="true">🛡️</span>
                          <span>{t('verify.verifiedBy', { bank: item.bank })}</span>
                        </div>
                      )}
                      {isUnverified && (
                        <div className="verify-band verify-band-warn">
                          <span aria-hidden="true">⚠️</span>
                          <span>{verifyReasonText(item.verification_note)}</span>
                        </div>
                      )}

                      {/* Details Grid */}
                      <div className="details-grid">
                        <div className="detail-item">
                          <span className="detail-label">
                            {isVerified ? t('verify.receiptNo') : t('card.reference')}
                          </span>
                          <span className="detail-value detail-ref">
                            {item.reference_no || t('card.emptyRef')}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">
                            {isVerified ? t('verify.payerLabel') : t('card.sender')}
                          </span>
                          <span className="detail-value">
                            {item.sender_name || '—'}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">{t('card.receiver')}</span>
                          <span className="detail-value">
                            {item.receiver_name || '—'}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">{t('card.status')}</span>
                          <span className="detail-value">
                            {isVerified
                              ? item.verified_receipt?.status || t('card.confirmed')
                              : isUnverified
                              ? t('verify.statusUnverified')
                              : t('card.notReceiptExcluded')}
                          </span>
                        </div>
                        {isVerified && item.verified_receipt?.fee !== undefined && (
                          <div className="detail-item">
                            <span className="detail-label">{t('verify.feeLabel')}</span>
                            <span className="detail-value">
                              {t('currency')} {formatETB(item.verified_receipt.fee)}
                            </span>
                          </div>
                        )}
                        {isVerified && item.verified_receipt?.total_paid !== undefined && (
                          <div className="detail-item">
                            <span className="detail-label">{t('verify.totalPaidLabel')}</span>
                            <span className="detail-value">
                              {t('currency')} {formatETB(item.verified_receipt.total_paid)}
                            </span>
                          </div>
                        )}
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
                                  title: t('preview.refTitle', {
                                    bank: item.bank || t('card.unknownBank'),
                                    ref: item.reference_no || t('preview.noRef'),
                                  }),
                                })
                              }
                            >
                              🔍 {t('card.viewReceipt')}
                            </button>
                          )}
                          <button
                            className="btn-icon-text"
                            onClick={() => setEditingTransfer(item)}
                          >
                            ✏️ {t('card.edit')}
                          </button>
                        </div>

                        <button
                          className="btn-icon-text btn-delete"
                          onClick={() => handleDeleteTransfer(item.id)}
                          title={t('card.deleteTitle')}
                          aria-label={t('card.deleteTitle')}
                        >
                          🗑️ {t('card.delete')}
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
              <div className="section-title">{t('history.title')}</div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {t('history.storage')}
              </span>
            </div>

            {savedDays.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📂</div>
                <h3>{t('history.emptyTitle')}</h3>
                <p>{t('history.emptyBody')}</p>
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
                          {t('history.validTransfers', { n: day.transfer_count })} •{' '}
                          {t('history.duplicates', { n: day.duplicate_count })}
                          {day.previews_stripped && (
                            <span style={{ color: '#b45309', marginLeft: '6px', fontWeight: 600 }}>
                              • {t('history.imagesRemoved')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="history-total">
                        {t('currency')} {formatETB(day.total_amount)}
                      </div>
                    </div>

                    <div className="history-actions">
                      <button
                        className="btn-secondary"
                        style={{ minHeight: '40px', padding: '6px 12px' }}
                        onClick={() =>
                          setExpandedHistoryDayId(isExpanded ? null : day.id)
                        }
                      >
                        {isExpanded
                          ? `▲ ${t('history.hideDetails')}`
                          : `▼ ${t('history.expand')}`}
                      </button>
                      <button
                        className="btn-secondary"
                        style={{ minHeight: '40px', padding: '6px 12px' }}
                        onClick={() =>
                          exportTransfersToCsv(day.date, day.transfers, day.total_amount)
                        }
                      >
                        📥 {t('history.csv')}
                      </button>
                      <button
                        className="btn-primary"
                        style={{ minHeight: '40px', padding: '6px 12px' }}
                        onClick={() => handleLoadDayIntoEditor(day)}
                      >
                        {t('history.loadToEditor')}
                      </button>
                      <button
                        className="btn-icon-text btn-delete"
                        style={{ minHeight: '40px' }}
                        onClick={() => handleDeleteDay(day.id)}
                        aria-label={t('card.deleteTitle')}
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
                        {day.transfers.map((row, idx) => (
                          <div
                            key={row.id || idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: '0.85rem',
                              padding: '6px 8px',
                              background: row.is_duplicate
                                ? 'var(--badge-dup-bg)'
                                : 'var(--bg-subtle)',
                              borderRadius: '6px',
                            }}
                          >
                            <div>
                              <strong>{row.bank}</strong> • {t('list.refPrefix')}{' '}
                              {row.reference_no || t('history.emptyRef')}
                              {row.is_duplicate && (
                                <span
                                  style={{
                                    color: '#b91c1c',
                                    fontWeight: 'bold',
                                    marginLeft: '6px',
                                  }}
                                >
                                  {t('history.duplicateTag')}
                                </span>
                              )}
                              {row.missing_reference && (
                                <span
                                  style={{
                                    color: '#b45309',
                                    fontWeight: 'bold',
                                    marginLeft: '6px',
                                  }}
                                >
                                  {t('history.missingRefTag')}
                                </span>
                              )}
                              {row.is_receipt === false && (
                                <span
                                  style={{
                                    color: '#b91c1c',
                                    fontWeight: 'bold',
                                    marginLeft: '6px',
                                  }}
                                >
                                  {t('history.notReceiptTag')}
                                </span>
                              )}
                            </div>
                            <div style={{ fontWeight: '800' }}>
                              {t('currency')} {formatETB(row.amount)}
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
            aria-label={t('modal.editTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>{t('modal.editTitle')}</h2>
              <button
                className="btn-close"
                onClick={() => setEditingTransfer(null)}
                aria-label={t('form.cancel')}
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
                <label className="form-label">{t('form.bank')}</label>
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
                <label className="form-label">{t('form.amount')}</label>
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
                <label className="form-label">{t('form.reference')}</label>
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
                  placeholder={t('form.referencePlaceholder')}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">{t('form.sender')}</label>
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
                <label className="form-label">{t('form.receiver')}</label>
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
                <label className="form-label">{t('form.dateTime')}</label>
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
                <label className="form-label">{t('form.isReceipt')}</label>
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
                  <option value="yes">{t('form.isReceiptYes')}</option>
                  <option value="no">{t('form.isReceiptNo')}</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">{t('form.confidence')}</label>
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
                  <option value="high">{t('form.confidenceHigh')}</option>
                  <option value="medium">{t('form.confidenceMedium')}</option>
                  <option value="low">{t('form.confidenceLow')}</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" className="btn-primary">
                  💾 {t('form.save')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingTransfer(null)}
                >
                  {t('form.cancel')}
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
            aria-label={t('preview.aria')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>{zoomedImage.title}</h2>
              <button
                className="btn-close"
                onClick={() => setZoomedImage(null)}
                aria-label={t('form.cancel')}
              >
                ✕
              </button>
            </div>
            <div className="image-zoom-container">
              {/* eslint-disable-next-line @next/next/no-img-element -- src is a runtime data URL / blob preview; next/image does not optimize those and would add no value here */}
              <img
                src={zoomedImage.url}
                alt={t('preview.aria')}
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
