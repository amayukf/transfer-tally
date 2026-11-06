import { parseReceiptText, ParsedReceipt } from '@/utils/receiptParser';
import { preprocessImageForOcr } from '@/utils/imageResize';

/**
 * On-device OCR using Tesseract.js (WASM).
 *
 * The receipt image never leaves the device: only the OCR engine and the
 * English language model are downloaded (cached by the browser/IndexedDB after
 * the first run). This is the primary extraction path; the AI route is only
 * used as an optional fallback for receipts this cannot read confidently.
 *
 * Reading a whole night's screenshots is the slowest part of the close, so the
 * engine is treated as a small pool of reusable workers:
 *   - `prewarmOcr()` downloads the engine while the cashier is still picking
 *     screenshots, so the first scan is not blocked by the download;
 *   - up to `getOcrConcurrency()` images are recognised at the same time;
 *   - each worker is created once and reused, because spinning one up per
 *     image is by far the slowest part of OCR.
 */

type ProgressFn = (progress: number, status: string) => void;
type TesseractWorker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>;

interface PoolSlot {
  worker: TesseractWorker | null;
  init: Promise<TesseractWorker> | null;
  progressFn: ProgressFn | null;
  inUse: boolean;
}

let slots: PoolSlot[] = [];
const waiting: Array<(slot: PoolSlot) => void> = [];

/**
 * How many screenshots this device can read at the same time. Phones report
 * many cores but only a few are fast, and each worker costs real memory, so
 * this stays small.
 */
export function getOcrConcurrency(): number {
  if (typeof navigator === 'undefined') return 1;
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
}

function createWorkerFor(slot: PoolSlot): Promise<TesseractWorker> {
  if (slot.worker) return Promise.resolve(slot.worker);
  if (!slot.init) {
    slot.init = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, {
        logger: (m) => {
          if (slot.progressFn && typeof m.progress === 'number') {
            slot.progressFn(m.progress, m.status);
          }
        },
      });
      // A receipt is one dense text block, so keep lines intact instead of
      // letting Tesseract re-segment them. Preserving inter-word spacing keeps
      // "Amount 1,250.00" together on one line for the parser, and a declared
      // DPI stops it from guessing a resolution that hurts digit accuracy.
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });
      slot.worker = worker;
      return worker;
    })().catch((err) => {
      // Do not cache a failed initialisation — let the next image retry.
      slot.init = null;
      throw err;
    });
  }
  return slot.init;
}

function acquireSlot(): Promise<PoolSlot> {
  const free = slots.find((s) => !s.inUse);
  if (free) {
    free.inUse = true;
    return Promise.resolve(free);
  }
  if (slots.length < getOcrConcurrency()) {
    const slot: PoolSlot = { worker: null, init: null, progressFn: null, inUse: true };
    slots.push(slot);
    return Promise.resolve(slot);
  }
  // Every worker is busy — hand the next released slot straight to a waiter.
  return new Promise<PoolSlot>((resolve) => waiting.push(resolve));
}

function releaseSlot(slot: PoolSlot): void {
  slot.progressFn = null;
  const next = waiting.shift();
  if (next) {
    // Ownership transfers to the waiting task, so the slot stays in use.
    next(slot);
  } else {
    slot.inUse = false;
  }
}

/**
 * Downloads and starts the OCR engine ahead of time. Safe to call repeatedly;
 * failures are ignored because the first real scan will retry the download.
 */
export function prewarmOcr(): void {
  if (typeof window === 'undefined') return;
  void acquireSlot()
    .then((slot) => createWorkerFor(slot).finally(() => releaseSlot(slot)))
    .catch(() => {
      // Offline or CDN blocked — nothing to do here.
    });
}

export interface OcrExtractionResult extends ParsedReceipt {
  rawText: string;
  ocrConfidence: number;
}

/**
 * Runs OCR on a (already resized) receipt image and parses the text.
 * Throws if the OCR engine cannot be loaded (e.g. first run with no network).
 */
export async function extractWithOcr(
  image: string,
  onProgress?: ProgressFn
): Promise<OcrExtractionResult> {
  const slot = await acquireSlot();
  slot.progressFn = onProgress ?? null;
  try {
    const worker = await createWorkerFor(slot);
    // Normalise the image (grayscale, flip dark receipts, enlarge small text)
    // so Tesseract reads digits far more reliably than from the raw screenshot.
    const prepared = await preprocessImageForOcr(image);
    const { data } = await worker.recognize(prepared);
    const rawText = data.text || '';
    const parsed = parseReceiptText(rawText);
    return { ...parsed, rawText, ocrConfidence: data.confidence ?? 0 };
  } finally {
    releaseSlot(slot);
  }
}

/** Tears down every OCR worker (e.g. on unmount) to free memory. */
export async function terminateOcrWorker(): Promise<void> {
  const closing = slots;
  slots = [];
  waiting.length = 0;
  await Promise.all(
    closing.map(async (slot) => {
      const worker = slot.worker ?? (slot.init ? await slot.init.catch(() => null) : null);
      if (!worker) return;
      try {
        await worker.terminate();
      } catch {
        // Worker already gone — nothing to clean up.
      }
    })
  );
}
