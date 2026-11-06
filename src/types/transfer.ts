export type ConfidenceLevel = 'high' | 'medium' | 'low';

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
