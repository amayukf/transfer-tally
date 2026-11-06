export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Whether the bank itself confirmed this transfer.
 * - 'verified': the receipt was fetched from the issuing bank (links.et).
 * - 'unverified': no bank confirmation — the cashier must check it by hand.
 */
export type VerificationStatus = 'verified' | 'unverified';

/**
 * The bank's own receipt, kept as the audit trail for a verified transfer.
 * Re-checking an already-verified reference is free, so this can always be
 * re-proved later even after the original screenshot is gone.
 */
export interface VerifiedReceipt {
  source: string; // links.et receipt schema tag, e.g. 'telebirr-html'
  provider: string; // e.g. 'telebirr', 'cbe'
  reference: string;
  amount: number; // Transferred amount, excluding any service fee
  fee?: number;
  total_paid?: number; // Amount debited including the fee
  currency: string;
  payer_name: string;
  receiver_name: string;
  paid_at: string;
  status: string; // Bank-reported status, e.g. 'Completed'
  fetched_at: string;
  cached?: boolean;
}

export interface TransferRecord {
  id: string; // Unique client ID
  bank: string; // Telebirr, CBE, Awash, etc.
  amount: number; // Plain ETB transfer amount
  sender_name: string;
  receiver_name: string;
  date_time: string;
  reference_no: string;
  confidence: ConfidenceLevel;
  is_receipt: boolean;
  image_preview?: string; // Resized data URL for cashier inspection
  file_name?: string;
  is_duplicate?: boolean;
  duplicate_source?: 'current_batch' | 'historical';
  missing_reference?: boolean; // Flagged when reference is missing/empty
  verification?: VerificationStatus;
  verification_note?: string; // Why verification did not complete
  verified_receipt?: VerifiedReceipt; // Bank-side receipt for verified rows
  created_at: string;
}

export interface DayRecord {
  id: string; // Typically YYYY-MM-DD
  date: string;
  total_amount: number;
  transfer_count: number;
  duplicate_count: number;
  transfers: TransferRecord[];
  saved_at: string;
  note?: string;
  previews_stripped?: boolean; // True if image_previews were omitted due to storage quota
}

export interface SaveDayResult {
  success: boolean;
  previewsStripped: boolean;
}

export interface GeminiExtractionResponse {
  is_receipt: boolean;
  bank: string;
  amount: number;
  sender_name: string;
  receiver_name: string;
  date_time: string;
  reference_no: string;
  confidence: ConfidenceLevel;
}
