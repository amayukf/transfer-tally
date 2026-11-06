/**
 * Normaliser for links.et verification responses.
 *
 * links.et returns a different receipt schema for every provider (17 banks and
 * wallets), and amount fields are numbers on some providers and strings like
 * "100 Birr" or "100 ETB" on others. This module reduces all of that to the two
 * things this app actually needs: a bank-confirmed amount and whether the bank
 * confirmed the transfer at all.
 *
 * Field names are read through candidate key lists rather than a fixed schema,
 * so a provider we have not mapped yet degrades to "unverified" instead of
 * throwing or silently reporting a wrong amount.
 */

import { VerifiedReceipt } from '@/types/transfer';

/* ------------------------------------------------------------------ */
/* Response shapes (links.et /api/verify-image)                        */
/* ------------------------------------------------------------------ */

export interface LinksEtDetected {
  provider: 'telebirr' | 'cbe' | 'boa' | 'zemen' | 'awashbank' | 'none' | string;
  reference: string | null;
  url: string | null;
  confidence: number;
}

export interface LinksEtEnvelope {
  ok: boolean;
  source?: string;
  error?: { code?: string; message?: string } | null;
  detected?: LinksEtDetected;
  upstream?: {
    attempted?: boolean;
    reason?: string;
    url?: string | null;
    error?: string | null;
    result?: {
      ok?: boolean;
      providerKey?: string;
      resolvedUrl?: string;
      cached?: boolean;
      fetchedAt?: string;
      receipt?: Record<string, unknown> | null;
      error?: { code?: string; message?: string } | null;
    } | null;
  } | null;
}

/**
 * Why a transfer could not be confirmed. The first four are links.et's own
 * `upstream.reason` values; the rest are raised by this app.
 */
export type UnverifiedReason =
  | 'unsupported_provider'
  | 'no_reference'
  | 'provider_needs_full_url'
  | 'upstream_failed'
  | 'qr_receipt'
  | 'not_completed'
  | 'amount_not_found';

export type VerificationOutcome =
  | { status: 'verified'; receipt: VerifiedReceipt }
  | {
      status: 'unverified';
      reason: UnverifiedReason;
      detected?: LinksEtDetected;
    };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Human-readable bank name for a links.et provider key. */
const PROVIDER_LABELS: Record<string, string> = {
  telebirr: 'Telebirr',
  cbe: 'Commercial Bank of Ethiopia (CBE)',
  cbebirr: 'CBE Birr',
  boa: 'Bank of Abyssinia',
  abyssinia: 'Bank of Abyssinia',
  zemen: 'Zemen Bank',
  awash: 'Awash Bank',
  awashbank: 'Awash Bank',
  dashen: 'Dashen Bank',
  mpesa: 'M-PESA',
  ebirr: 'Ebirr',
  amhara: 'Amhara Bank',
  abay: 'Abay Bank',
  berhan: 'Berhan Bank',
  oromia: 'Oromia Bank',
  ahadu: 'Ahadu Bank',
  siinqee: 'Siinqee Bank',
  zamzam: 'ZamZam Bank',
};

export function providerLabel(providerKey: string | null | undefined): string {
  if (!providerKey) return '';
  return PROVIDER_LABELS[providerKey.toLowerCase()] || providerKey;
}

/**
 * Reads the first present key from a receipt, tolerating the casing and
 * separators that differ between providers (payerName / payer_name) and the
 * nested blocks some providers use (Awash ships `customer` + `transaction`).
 */
function pick(receipt: Record<string, unknown>, keys: string[]): unknown {
  const normalise = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Nested blocks are searched too, but a top-level key of the same name wins.
  const nested: Record<string, unknown> = {};
  for (const value of Object.values(receipt)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
        nested[normalise(innerKey)] = innerValue;
      }
    }
  }

  const lookup: Record<string, unknown> = { ...nested };
  for (const [key, value] of Object.entries(receipt)) {
    lookup[normalise(key)] = value;
  }

  for (const key of keys) {
    const value = lookup[normalise(key)];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * Parses an amount that may be a number or a provider-formatted string
 * ("1,004.00 Birr", "100 ETB", "1,004.00"). Returns null when unusable.
 */
function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;

  // Drop currency words and any spaces, keep digits, separators and signs.
  const cleaned = value
    .replace(/[a-zA-Z\u1200-\u137F]+/g, ' ')
    .replace(/[^0-9.,-]/g, '')
    .trim();
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);

  let str: string;
  if (lastSep !== -1 && cleaned.length - 1 - lastSep <= 2 && lastSep > 0) {
    // Treat the final separator as the decimal point, the rest as grouping.
    str = `${cleaned.slice(0, lastSep).replace(/[.,]/g, '')}.${cleaned.slice(lastSep + 1)}`;
  } else {
    str = cleaned.replace(/[.,]/g, '');
  }

  const num = Number(str);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

// Candidate keys per logical field, covering the provider schemas documented
// by links.et. Unmapped providers fall back to the shared names first.
const KEY_SETS = {
  reference: ['reference', 'receiptNo', 'transactionReference', 'receiptNumber', 'invoiceNo', 'transactionNumber', 'transactionId', 'ref'],
  amount: ['transferredAmount', 'settledAmount', 'amount', 'transactionAmount'],
  totalPaid: ['totalAmount', 'totalPaidAmount', 'totalAmountPaid', 'totalPaid'],
  fee: ['serviceCharge', 'serviceFee', 'charge', 'commission'],
  payer: ['payerName', 'senderName', 'customerName', 'payer', 'sender'],
  receiver: ['receiverName', 'creditedPartyName', 'recipientName', 'beneficiaryName', 'receiver'],
  paidAt: ['paymentDate', 'transactionDate', 'transactionTime', 'dateTime', 'date', 'paidAt'],
  status: ['transactionStatus', 'upstreamStatus', 'status', 'paymentStatus'],
};

function buildReceipt(
  receipt: Record<string, unknown>,
  providerKey: string,
  resolvedUrl: string,
  fetchedAt: string,
  cached: boolean
): VerifiedReceipt | null {
  const amount = parseAmount(pick(receipt, KEY_SETS.amount));
  if (amount === null || amount <= 0) return null;

  const fee = parseAmount(pick(receipt, KEY_SETS.fee));
  const totalPaid = parseAmount(pick(receipt, KEY_SETS.totalPaid));

  return {
    source: asString(receipt.source),
    provider: providerKey,
    reference: asString(pick(receipt, KEY_SETS.reference)),
    amount,
    fee: fee === null ? undefined : fee,
    total_paid: totalPaid === null ? undefined : totalPaid,
    currency: asString(pick(receipt, ['currency'])) || 'ETB',
    payer_name: asString(pick(receipt, KEY_SETS.payer)),
    receiver_name: asString(pick(receipt, KEY_SETS.receiver)),
    paid_at: asString(pick(receipt, KEY_SETS.paidAt)),
    status: asString(pick(receipt, KEY_SETS.status)),
    fetched_at: fetchedAt,
    cached,
  };
}

/**
 * The bank-reported status must be checked explicitly: a cancelled or pending
 * transfer can still return a complete-looking receipt.
 */
const REJECTED_STATUS = /\b(fail|failed|failure|cancel|cancelled|canceled|reversed|declined|pending|expired)\b/i;

/**
 * Reduces a links.et `/api/verify-image` envelope to either a bank-confirmed
 * receipt or a reason the transfer could not be confirmed.
 */
export function normalizeVerification(envelope: LinksEtEnvelope): VerificationOutcome {
  const detected = envelope.detected;
  const upstream = envelope.upstream;

  if (!upstream?.attempted) {
    const reason = upstream?.reason;
    const mapped: UnverifiedReason =
      reason === 'unsupported_provider' ||
      reason === 'no_reference' ||
      reason === 'provider_needs_full_url' ||
      reason === 'qr_receipt'
        ? reason
        : reason === 'verifier_threw'
          ? 'upstream_failed'
          : 'unsupported_provider';
    return { status: 'unverified', reason: mapped, detected };
  }

  const result = upstream.result;
  if (!result?.ok || !result.receipt) {
    return { status: 'unverified', reason: 'upstream_failed', detected };
  }

  const providerKey = asString(result.providerKey) || detected?.provider || '';
  const receipt = buildReceipt(
    result.receipt,
    providerKey,
    asString(result.resolvedUrl),
    asString(result.fetchedAt),
    Boolean(result.cached)
  );

  if (!receipt) {
    return { status: 'unverified', reason: 'amount_not_found', detected };
  }

  if (receipt.status && REJECTED_STATUS.test(receipt.status)) {
    return { status: 'unverified', reason: 'not_completed', detected };
  }

  return { status: 'verified', receipt };
}
