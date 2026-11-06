import { ConfidenceLevel, GeminiExtractionResponse } from '@/types/transfer';

/**
 * Heuristic parser that turns raw OCR text from an Ethiopian bank / mobile
 * money receipt into the same shape the AI extractor returns.
 *
 * It is intentionally conservative: `reliable` is only true when BOTH the
 * amount and a plausible reference number were found. Callers use that flag to
 * decide whether the on-device result is trustworthy or whether the image
 * should be escalated to the AI fallback.
 */
export interface ParsedReceipt {
  fields: GeminiExtractionResponse;
  /** True only when amount AND reference were both read with confidence. */
  reliable: boolean;
  matched: {
    bank: boolean;
    amount: boolean;
    reference: boolean;
    date: boolean;
  };
}

/* ------------------------------------------------------------------ */
/* Bank detection                                                      */
/* ------------------------------------------------------------------ */

// Ordered most-specific first so "CBE Birr" is not swallowed by "CBE".
const BANK_PATTERNS: Array<{ name: string; patterns: RegExp[] }> = [
  { name: 'Telebirr', patterns: [/telebirr/i, /ቴሌብር/] },
  { name: 'CBE Birr', patterns: [/cbe\s*birr/i, /ሲቢኢ\s*ብር/] },
  {
    name: 'Commercial Bank of Ethiopia (CBE)',
    patterns: [/commercial bank of ethiopia/i, /\bcbe\b/i, /የኢትዮጵያ\s*ንግድ\s*ባንክ/],
  },
  { name: 'Bank of Abyssinia', patterns: [/bank of abyssinia/i, /abyssinia/i, /አቢሲኒያ/] },
  { name: 'Awash Bank', patterns: [/awash/i, /አዋሽ/] },
  { name: 'Dashen Bank', patterns: [/dashen/i, /ዳሸን/] },
  { name: 'Zemen Bank', patterns: [/zemen/i, /ዘመን/] },
  { name: 'Hibret Bank', patterns: [/hibret/i, /ሕብረት/] },
  { name: 'Cooperative Bank of Oromia', patterns: [/cooperative bank of oromia/i, /coop.*oromia/i] },
];

function detectBank(text: string): string | null {
  for (const bank of BANK_PATTERNS) {
    if (bank.patterns.some((re) => re.test(text))) return bank.name;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Number helpers                                                      */
/* ------------------------------------------------------------------ */

// Matches "1,250.00", "1.250,00", "1250", "1 250.00" style numbers.
const NUMBER_RE = /\d{1,3}(?:[,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g;

/**
 * Converts a numeric token to a number, resolving whether the final separator
 * is a decimal point or a thousands separator.
 */
function toNumber(token: string): number | null {
  let s = token.replace(/\s/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);
  if (lastSep !== -1 && s.length - 1 - lastSep <= 2 && lastSep > 0) {
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, '');
    const decPart = s.slice(lastSep + 1);
    s = `${intPart}.${decPart}`;
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* Amount detection                                                    */
/* ------------------------------------------------------------------ */

const AMOUNT_POSITIVE = [
  /amount/i,
  /transferred/i,
  /transfer\s*amount/i,
  /\btotal\b/i,
  /\betb\b/i,
  /\bbr\b/i,
  /ብር/,
  /የተላለፈ/,
  /ገንዘብ/,
];

// Lines that mention a currency figure but are NOT the transfer amount.
const AMOUNT_NEGATIVE = [
  /fee/i,
  /vat/i,
  /\btax\b/i,
  /service/i,
  /charge/i,
  /commission/i,
  /balance/i,
  /remaining/i,
  /ክፍያ/,
  /ተቀማጭ/,
  /አገልግሎት/,
];

function findAmount(lines: string[]): number | null {
  type Candidate = { value: number; priority: number };
  const candidates: Candidate[] = [];

  for (const line of lines) {
    const numbers = line.match(NUMBER_RE);
    if (!numbers) continue;

    const isNegative = AMOUNT_NEGATIVE.some((re) => re.test(line));
    const isPositive = AMOUNT_POSITIVE.some((re) => re.test(line));
    if (isNegative && !isPositive) continue;

    for (const raw of numbers) {
      const value = toNumber(raw);
      if (value === null || value <= 0) continue;
      // Reject implausible values (phone fragments, years, ref chunks).
      if (value > 5_000_000) continue;
      candidates.push({ value, priority: isPositive ? 2 : 1 });
    }
  }

  if (candidates.length === 0) return null;

  // Prefer keyword-adjacent amounts, then the largest value on those lines.
  candidates.sort((a, b) => b.priority - a.priority || b.value - a.value);
  return candidates[0].value;
}

/* ------------------------------------------------------------------ */
/* Reference detection                                                 */
/* ------------------------------------------------------------------ */

const REF_LABELS = [
  /transaction\s*(?:id|no|number|ref(?:erence)?)/i,
  /ref(?:erence)?\s*(?:no|number|id)?/i,
  /\btxn\b/i,
  /receipt\s*(?:no|number)/i,
  /መለያ/,
  /ቁጥር/,
];

const PHONE_RE = /^(?:\+?251|0)9\d{8}$/;
const DATEISH_RE = /^\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}$/;

function scoreReferenceToken(token: string): number {
  if (token.length < 6 || token.length > 40) return 0;
  if (PHONE_RE.test(token)) return 0;
  if (DATEISH_RE.test(token)) return 0;
  const hasDigit = /\d/.test(token);
  const hasLetter = /[A-Za-z]/.test(token);
  if (!hasDigit) return 0;
  // Mixed letter+digit refs are the strongest signal; long numeric refs next.
  let score = token.length;
  if (hasLetter) score += 25;
  if (hasLetter && hasDigit) score += 10;
  return score;
}

function findReference(text: string, lines: string[]): string | null {
  let best: { token: string; score: number } | null = null;

  // 1. Tokens sitting right after a "Transaction ID / Ref No" style label.
  for (const line of lines) {
    if (!REF_LABELS.some((re) => re.test(line))) continue;
    const tokens = line.match(/[A-Za-z0-9]{6,}/g) || [];
    for (const token of tokens) {
      const score = scoreReferenceToken(token) + 100; // labelled -> strong boost
      if (score > 0 && (!best || score > best.score)) best = { token, score };
    }
  }

  // 2. Fallback: any long alphanumeric token in the whole receipt.
  if (!best) {
    const tokens = text.match(/[A-Za-z0-9]{8,}/g) || [];
    for (const token of tokens) {
      const score = scoreReferenceToken(token);
      if (score > 0 && (!best || score > best.score)) best = { token, score };
    }
  }

  return best ? best.token : null;
}

/* ------------------------------------------------------------------ */
/* Date / time + parties                                               */
/* ------------------------------------------------------------------ */

const DATE_RE = /(\d{4}[/.-]\d{1,2}[/.-]\d{1,2})|(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/;
const TIME_RE = /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i;

function findDateTime(text: string): string | null {
  const date = text.match(DATE_RE)?.[0];
  const time = text.match(TIME_RE)?.[0];
  if (!date && !time) return null;
  return [date, time].filter(Boolean).join(' ').trim();
}

function findParty(lines: string[], labels: RegExp[]): string {
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(label);
      if (!match || match.index === undefined) continue;
      const rest = line.slice(match.index + match[0].length).replace(/^[\s:.-]+/, '');
      // Keep letters, spaces and a few name glyphs; stop at digits (phone/ids).
      const name = rest.match(/^[A-Za-z\u1200-\u137F][A-Za-z\u1200-\u137F\s.'-]{2,39}/);
      if (name) return name[0].trim();
    }
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

const RECEIPT_KEYWORDS = [
  /transfer/i,
  /transaction/i,
  /receipt/i,
  /successful/i,
  /payment/i,
  /ተላልፏል/,
  /የተላለፈ/,
  /ተሳክቷል/,
  /ክፍያ/,
];

export function parseReceiptText(rawText: string): ParsedReceipt {
  const text = rawText || '';
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const bank = detectBank(text) || '';
  const amount = findAmount(lines);
  const reference = findReference(text, lines);
  const dateTime = findDateTime(text);
  const senderName = findParty(lines, [/\bfrom\b/i, /\bsender\b/i, /\bpayer\b/i, /ከ/]);
  const receiverName = findParty(lines, [
    /\bto\b/i,
    /\breceiver\b/i,
    /\bpayee\b/i,
    /\bbeneficiary\b/i,
    /ወደ/,
  ]);

  const hasAmount = amount !== null && amount > 0;
  const hasReference = !!reference && reference.length >= 6;

  const looksLikeReceipt =
    (hasAmount && hasReference) || RECEIPT_KEYWORDS.some((re) => re.test(text));

  let confidence: ConfidenceLevel = 'low';
  if (hasAmount && hasReference) {
    confidence = bank ? 'high' : 'medium';
  }

  const fields: GeminiExtractionResponse = {
    is_receipt: looksLikeReceipt,
    bank,
    amount: amount ?? 0,
    sender_name: senderName,
    receiver_name: receiverName,
    date_time: dateTime || '',
    reference_no: reference || '',
    confidence,
  };

  return {
    fields,
    reliable: hasAmount && hasReference,
    matched: {
      bank: !!bank,
      amount: hasAmount,
      reference: hasReference,
      date: !!dateTime,
    },
  };
}
