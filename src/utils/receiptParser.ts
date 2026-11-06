import type { ConfidenceLevel, GeminiExtractionResponse } from '@/types/transfer';

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
  // Prefer the printed issuer over a product mention such as "CBE Birr
  // wallet" in the transaction description.
  if (/commercial bank of ethiopia|የኢትዮጵያ\s*ንግድ\s*ባንክ/i.test(text)) {
    return 'Commercial Bank of Ethiopia (CBE)';
  }
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

// The transferred amount is what the ledger needs — never the fee or the
// balance. Labels are graded so "Transferred Amount" beats "Amount", which
// beats "Total", which beats a bare currency figure.
const AMOUNT_LABEL_TRANSFERRED = [/transferred/i, /የተላለፈ/, /ተላልፏል/];
const AMOUNT_LABEL_AMOUNT = [/\bamount\b/i, /መጠን/];
const AMOUNT_LABEL_TOTAL = [/\btotal\b/i, /ጠቅላላ/, /ገንዘብ/];
const CURRENCY_TOKENS = [/\betb(?![a-z])/i, /\bbr(?![a-z])/i, /ብር/];

// Lines that mention a figure but are NOT the transfer amount. Kept fee/VAT/
// balance-focused so we never add a service charge to the day's total.
const AMOUNT_EXCLUDE = [
  /fee/i,
  /vat/i,
  /\btax\b/i,
  /service/i,
  /charge/i,
  /commission/i,
  /balance/i,
  /remaining/i,
  /available/i,
  /ክፍያ/,
  /ተቀማጭ/,
  /አገልግሎት/,
  /account\s*(?:no|number)/i,
  /phone\s*(?:no|number)?/i,
  /\bmobile\b/i,
];

const FEE_LABEL = /\b(?:fee|service\s+charge|charge|commission)\b|ክፍያ|አገልግሎት/i;
const INCLUSIVE_TOTAL_LABEL =
  /(?:\b(?:total|amount)\b.{0,32}\b(?:including|incl\.?|with)\b.{0,16}\b(?:fee|charge|commission)\b|\b(?:fee|charge|commission)\b.{0,16}\b(?:included|inclusive)\b)/i;
const AMOUNT_METADATA_LABEL = /\b(?:date|time|transaction\s*(?:date|time|id|no|number)|reference|ref(?:erence)?|txn|receipt\s*(?:no|number))\b/i;
const DATE_OR_TIME_VALUE =
  /\b\d{4}[/. -]\d{1,2}[/. -]\d{1,2}\b|\b\d{1,2}[/. -]\d{1,2}[/. -]\d{4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/;

function extractNumbers(line: string): number[] {
  const amountText = line
    // Tesseract can split the thousands group from the final digit, e.g.
    // "1,00 4.00" for "1,004.00". Rejoin only this recognizable pattern.
    .replace(/\b(\d{1,3},\d{2})\s+(\d{1,3}\.\d{2})\b/g, '$1$2')
    .replace(
      /\b(?:transaction\s*(?:id|no|number)|reference(?:\s*(?:no|number|id))?|ref(?:\s*(?:no|number|id))?|txn|receipt\s*(?:no|number))\s*[:#]?\s*[A-Z0-9-]+/gi,
      ' '
    )
    .replace(/\b(?:TB[0-9A-Z]{6,}|FT[0-9A-Z]{6,}|[A-Z]{2,4}\d{6,}[A-Z0-9]*)\b/gi, ' ')
    .replace(/\b(?:account|phone|mobile)\s*(?:no|number)?\s*[:#]?\s*\+?[\d*().\s-]{5,}/gi, ' ')
    .replace(/\b[A-Z]{2,4}-\d\*+\d+\b/gi, ' ')
    .replace(/\b[A-Za-z][A-Za-z-]*-\d{4,}\b/g, ' ')
    .replace(/\b\d{4}[/. -]\d{1,2}[/. -]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[/. -]\d{1,2}[/. -]\d{4}\b/g, ' ')
    .replace(
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi,
      ' '
    )
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ');
  const raw = amountText.match(NUMBER_RE) || [];
  const out: number[] = [];
  for (const t of raw) {
    const v = toNumber(t);
    // Reject implausible transfer amounts (phone/account/year fragments).
    if (v !== null && v > 0 && v <= 5_000_000) out.push(v);
  }
  return out;
}

function amountLabelPriority(line: string): number {
  if (AMOUNT_LABEL_TRANSFERRED.some((re) => re.test(line))) return 5;
  // Checked before the generic "amount" so a fee-inclusive "Total Amount" line
  // is down-ranked below a plain "Amount" line.
  if (AMOUNT_LABEL_TOTAL.some((re) => re.test(line))) return 3;
  if (AMOUNT_LABEL_AMOUNT.some((re) => re.test(line))) return 4;
  if (CURRENCY_TOKENS.some((re) => re.test(line))) return 2;
  return 0;
}

interface FoundAmount {
  value: number;
  priority: number;
}

function findAmount(lines: string[]): FoundAmount | null {
  const candidates: Array<{ value: number; priority: number; includesFee: boolean }> = [];
  let explicitFeeTotal = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (INCLUSIVE_TOTAL_LABEL.test(line)) continue;
    const feeMatch = line.match(FEE_LABEL);
    if (!feeMatch || feeMatch.index === undefined) continue;

    const feeText = line.slice(feeMatch.index + feeMatch[0].length);
    let feeValues = extractNumbers(feeText);
    if (feeValues.length === 0) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        if (
          AMOUNT_LABEL_TRANSFERRED.some((re) => re.test(lines[j])) ||
          AMOUNT_LABEL_AMOUNT.some((re) => re.test(lines[j])) ||
          AMOUNT_LABEL_TOTAL.some((re) => re.test(lines[j])) ||
          FEE_LABEL.test(lines[j]) ||
          AMOUNT_METADATA_LABEL.test(lines[j]) ||
          DATE_OR_TIME_VALUE.test(lines[j])
        ) {
          break;
        }
        feeValues = extractNumbers(lines[j]);
        if (feeValues.length > 0) break;
      }
    }
    if (feeValues.length > 0) explicitFeeTotal += feeValues[0];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let priority = amountLabelPriority(line);
    const feeMatch = line.match(FEE_LABEL);
    const includesFee = INCLUSIVE_TOTAL_LABEL.test(line);

    // Fee rows are never transfer amounts. An explicitly labeled amount that
    // shares a line with its fee may still contribute the number before it.
    if (feeMatch && !includesFee) {
      if (feeMatch.index === undefined || priority === 0) continue;
    }

    // Dates, times, and transaction identifiers are metadata, not amounts.
    // Do not let their numeric parts enter the unlabeled fallback candidates.
    if (
      priority === 0 &&
      (AMOUNT_METADATA_LABEL.test(line) || DATE_OR_TIME_VALUE.test(line))
    ) {
      continue;
    }
    let numbers = extractNumbers(line);
    let hasNumberBeforeFee = false;

    // Label on this line, value on one of the next two lines (common layout).
    if (numbers.length === 0 && priority > 0) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        if (FEE_LABEL.test(lines[j]) || AMOUNT_EXCLUDE.some((re) => re.test(lines[j]))) {
          break;
        }
        const nextNumbers = extractNumbers(lines[j]);
        if (nextNumbers.length > 0) {
          numbers = nextNumbers;
          break;
        }
        // Stop if the next line is itself a different labelled figure.
        if (amountLabelPriority(lines[j]) > 0) {
          break;
        }
      }
    }

    if (feeMatch && !includesFee && feeMatch.index !== undefined) {
      const amountBeforeFee = extractNumbers(line.slice(0, feeMatch.index));
      if (amountBeforeFee.length > 0) {
        numbers = amountBeforeFee;
        hasNumberBeforeFee = true;
      }
    }

    if (numbers.length === 0) continue;
    // Fee rows stay excluded; other fee-related figures (VAT, balance, etc.)
    // are also ignored unless the line has a strong amount label.
    if (feeMatch && !includesFee && !hasNumberBeforeFee) continue;
    if (AMOUNT_EXCLUDE.some((re) => re.test(line)) && priority < 4 && !includesFee) continue;
    if (priority === 0) priority = 1; // bare number with no label at all

    for (const value of numbers) candidates.push({ value, priority, includesFee });
  }

  if (candidates.length === 0) return null;

  // Highest-priority label wins; ties broken by the largest amount.
  candidates.sort((a, b) => b.priority - a.priority || b.value - a.value);
  const selected = candidates[0];
  if (
    selected.priority === 1 &&
    new Set(candidates.filter((candidate) => candidate.priority === 1).map((candidate) => candidate.value))
      .size > 1
  ) {
    // Several unlabeled numbers (for example, keyboard digits) are not enough
    // evidence to safely choose a transfer amount.
    return null;
  }
  if (!selected.includesFee) {
    return { value: selected.value, priority: selected.priority };
  }
  // Subtract only a separately recognized fee from a total explicitly marked
  // as fee-inclusive. Without both signals, leave the value for manual review.
  return explicitFeeTotal > 0
    ? { value: Math.max(0, selected.value - explicitFeeTotal), priority: selected.priority }
    : null;
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

// Well-known transaction-reference shapes used by the common banks/apps. These
// are the strongest possible signal for the duplicate-check field.
const BANK_REF_PATTERNS = [
  /\bTB[0-9A-Z]{6,}\b/i, // Telebirr
  /\bFT[0-9A-Z]{6,}\b/i, // CBE / interbank transfers
  /\b[A-Z]{2,4}\d{6,}[A-Z0-9]*\b/i, // generic letter-prefixed ref
];

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

function findReference(text: string, lines: string[], amount: number | null): string | null {
  const candidates: Array<{ token: string; score: number }> = [];
  const consider = (token: string, bonus: number): void => {
    const base = scoreReferenceToken(token);
    if (base <= 0) return;
    // Never mistake the transfer amount itself for the reference.
    if (amount !== null && toNumber(token) === amount) return;
    candidates.push({ token, score: base + bonus });
  };

  // 1. Bank-specific reference formats anywhere in the receipt.
  for (const re of BANK_REF_PATTERNS) {
    const match = text.match(re);
    if (match) consider(match[0], 150);
  }

  // 2. Tokens right after a "Transaction ID / Ref No" label, checking both the
  //    label line and the line below it (values often sit on the next line).
  for (let i = 0; i < lines.length; i++) {
    if (!REF_LABELS.some((re) => re.test(lines[i]))) continue;
    for (const line of [lines[i], lines[i + 1]]) {
      if (!line) continue;
      for (const token of line.match(/[A-Za-z0-9]{6,}/g) || []) {
        consider(token, 200);
      }
    }
  }

  // 3. Fallback: any long alphanumeric token in the whole receipt.
  for (const token of text.match(/[A-Za-z0-9]{8,}/g) || []) {
    consider(token, 0);
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].token;
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
  const amountResult = findAmount(lines);
  const amount = amountResult?.value ?? null;
  const reference = findReference(text, lines, amount);
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
  const hasStrongAmount = amountResult !== null && amountResult.priority >= 2;
  const hasReference = !!reference && reference.length >= 6;

  const looksLikeReceipt =
    (hasAmount && hasReference) || RECEIPT_KEYWORDS.some((re) => re.test(text));

  let confidence: ConfidenceLevel = 'low';
  if (hasStrongAmount && hasReference) {
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
    reliable: hasStrongAmount && hasReference,
    matched: {
      bank: !!bank,
      amount: hasAmount,
      reference: hasReference,
      date: !!dateTime,
    },
  };
}
