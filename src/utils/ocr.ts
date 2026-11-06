import { parseReceiptText, ParsedReceipt } from '@/utils/receiptParser';

/**
 * On-device OCR using Tesseract.js (WASM).
 *
 * The receipt image never leaves the device: only the OCR engine and the
 * English language model are downloaded (cached by the browser/IndexedDB after
 * the first run). This is the primary extraction path; the AI route is only
 * used as a fallback for receipts this cannot read confidently.
 */

type ProgressFn = (progress: number, status: string) => void;
type TesseractWorker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>;

// One worker is reused across the whole batch: spinning one up per image is
// by far the slowest part of OCR.
let workerPromise: Promise<TesseractWorker> | null = null;
let progressFn: ProgressFn | null = null;

function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng', 1, {
        logger: (m) => {
          if (progressFn && typeof m.progress === 'number') {
            progressFn(m.progress, m.status);
          }
        },
      });
    })().catch((err) => {
      // Do not cache a failed initialisation — let the next image retry.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
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
  progressFn = onProgress ?? null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    const rawText = data.text || '';
    const parsed = parseReceiptText(rawText);
    return { ...parsed, rawText, ocrConfidence: data.confidence ?? 0 };
  } finally {
    progressFn = null;
  }
}

/** Tears down the OCR worker (e.g. on unmount) to free memory. */
export async function terminateOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Worker already gone — nothing to clean up.
  }
}
