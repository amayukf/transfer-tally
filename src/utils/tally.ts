import { TransferRecord } from '@/types/transfer';

export interface TallySummary {
  totalAmount: number; // Sum of amounts for valid rows (excluding duplicates, missing refs & non-receipts)
  validCount: number; // Count of valid transfers counted in total
  duplicateCount: number; // Count of duplicates excluded
  missingRefCount: number; // Count of transfers with missing reference numbers (excluded until entered)
  nonReceiptCount: number; // Count of uploads that are not payment receipts (excluded)
  lowConfidenceCount: number; // Count of transfers needing cashier review
  processedTransfers: TransferRecord[];
}

/**
 * Normalizes reference numbers by trimming, uppercasing,
 * and stripping all non-alphanumeric characters.
 */
export function normalizeReference(ref?: string): string {
  if (!ref) return '';
  return ref.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Computes duplicate status for each transfer against both the current batch
 * and previously saved historical days, and calculates the exact sum in code.
 *
 * Transfers with empty/missing normalized reference numbers are marked as
 * missing_reference, set to low confidence, and excluded from the total until
 * the cashier enters a reference number.
 */
export function computeTallyWithDuplicates(
  transfers: TransferRecord[],
  historicalRefs: Set<string> = new Set()
): TallySummary {
  const seenInCurrentBatch = new Set<string>();
  let totalAmount = 0;
  let validCount = 0;
  let duplicateCount = 0;
  let missingRefCount = 0;
  let nonReceiptCount = 0;
  let lowConfidenceCount = 0;

  const processedTransfers: TransferRecord[] = transfers.map((item) => {
    const normRef = normalizeReference(item.reference_no);
    let isDuplicate = false;
    let duplicateSource: 'current_batch' | 'historical' | undefined = undefined;
    let isMissingRef = false;
    let isNonReceipt = false;

    // 1. Duplicate check runs first (a duplicate is always excluded, receipt or not)
    if (normRef.length > 0) {
      if (seenInCurrentBatch.has(normRef)) {
        isDuplicate = true;
        duplicateSource = 'current_batch';
      } else if (historicalRefs.has(normRef)) {
        isDuplicate = true;
        duplicateSource = 'historical';
      } else {
        seenInCurrentBatch.add(normRef);
      }
    }

    // 2. Non-receipt screenshots (random gallery content) are excluded
    //    until the cashier explicitly marks them as receipts in the editor
    if (!isDuplicate && item.is_receipt === false) {
      isNonReceipt = true;
    }

    // 3. Missing reference blocks counting until the cashier types it in
    if (!isDuplicate && !isNonReceipt && normRef.length === 0) {
      isMissingRef = true;
    }

    const effectiveConfidence =
      isMissingRef || isNonReceipt ? 'low' : item.confidence;
    if (effectiveConfidence === 'low') {
      lowConfidenceCount++;
    }

    if (isDuplicate) {
      duplicateCount++;
    } else if (isNonReceipt) {
      nonReceiptCount++;
      // Excluded from total until cashier marks it as a receipt in the editor
    } else if (isMissingRef) {
      missingRefCount++;
      // Excluded from total until cashier reviews and enters reference number
    } else {
      validCount++;
      // Strict in-code sum with floating point safety
      totalAmount = Math.round((totalAmount + (Number(item.amount) || 0)) * 100) / 100;
    }

    return {
      ...item,
      is_duplicate: isDuplicate,
      duplicate_source: duplicateSource,
      missing_reference: isMissingRef,
      confidence: effectiveConfidence,
    };
  });

  return {
    totalAmount,
    validCount,
    duplicateCount,
    missingRefCount,
    nonReceiptCount,
    lowConfidenceCount,
    processedTransfers,
  };
}

/**
 * Format currency in ETB with proper commas and 2 decimals.
 */
export function formatETB(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
