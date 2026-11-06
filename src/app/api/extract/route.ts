import { NextRequest, NextResponse } from 'next/server';
import { GeminiExtractionResponse } from '@/types/transfer';

// A single extraction can legitimately take several seconds (image upload +
// Gemini vision inference), and the fallback chain may try up to 3 models on
// a 503 spike. Without this, serverless hosts (e.g. Vercel) kill the function
// on their plan default (as low as 10s) and the cashier sees a 504 mid-batch.
// 60s is the maximum allowed on Vercel's Hobby plan and matches the per-model
// AbortSignal timeout below.
export const maxDuration = 60;

const EXTRACTION_PROMPT = `Extract ONE transfer from this Ethiopian bank / mobile money receipt (English or Amharic). amount = money transferred in ETB as a plain number, NOT the service fee, VAT or remaining balance. reference_no = transaction ID exactly as printed. If the image is not a payment confirmation, set is_receipt false. Never invent values; use an empty string if a field is not visible. confidence = low if you had to guess the amount or reference number.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_receipt: { type: 'BOOLEAN' },
    bank: { type: 'STRING' },
    amount: { type: 'NUMBER' },
    sender_name: { type: 'STRING' },
    receiver_name: { type: 'STRING' },
    date_time: { type: 'STRING' },
    reference_no: { type: 'STRING' },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
  },
  required: [
    'is_receipt',
    'bank',
    'amount',
    'sender_name',
    'receiver_name',
    'date_time',
    'reference_no',
    'confidence',
  ],
};

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BASE64_BYTES = 4 * 1024 * 1024; // 4MB binary equivalent (~5.33MB in base64 characters)
const MAX_BASE64_CHARS = Math.ceil((MAX_BASE64_BYTES * 4) / 3);

/* ------------------------------------------------------------------ */
/* In-memory per-IP sliding-window rate limiter.                       */
/* Protects the Gemini API key from quota/bill exhaustion.             */
/* Note: per-instance only — behind multi-instance deployments put a   */
/* shared limiter at the edge (e.g. Vercel WAF rules or a proxy).      */
/* ------------------------------------------------------------------ */
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 20;
const RATE_WINDOW_MS = 60_000;

type Hit = { count: number; windowStart: number };
const rateMap = new Map<string, Hit>();
let lastSweep = Date.now();

function sweepStaleEntries(now: number): void {
  for (const [key, hit] of rateMap.entries()) {
    if (now - hit.windowStart > RATE_WINDOW_MS) {
      rateMap.delete(key);
    }
  }
  lastSweep = now;
}

/**
 * Returns remaining-seconds penalty if the client is over the rate limit, else null.
 */
function checkRateLimit(clientKey: string): number | null {
  const now = Date.now();
  if (now - lastSweep > RATE_WINDOW_MS) sweepStaleEntries(now);

  const hit = rateMap.get(clientKey);
  if (!hit || now - hit.windowStart > RATE_WINDOW_MS) {
    rateMap.set(clientKey, { count: 1, windowStart: now });
    return null;
  }

  hit.count += 1;
  if (hit.count > RATE_LIMIT_PER_MINUTE) {
    return Math.ceil((hit.windowStart + RATE_WINDOW_MS - now) / 1000);
  }
  return null;
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

function parseReceiptAmount(val: unknown): { amount: number; isInvalid: boolean } {
  if (typeof val === 'number') {
    if (Number.isFinite(val) && val >= 0) {
      return { amount: val, isInvalid: false };
    }
    return { amount: 0, isInvalid: true };
  }

  if (typeof val !== 'string') {
    return { amount: 0, isInvalid: true };
  }

  let str = val.trim();
  if (!str) return { amount: 0, isInvalid: true };

  // Negative amounts are invalid for transfers
  if (str.includes('-')) {
    return { amount: 0, isInvalid: true };
  }

  // Keep only digits, dots, and commas
  str = str.replace(/[^0-9.,]/g, '');
  if (!str) return { amount: 0, isInvalid: true };

  // Detect decimal separator vs thousand separators
  // E.g. "1.250.50" or "1.250,50" or "1,250.50"
  const lastDot = str.lastIndexOf('.');
  const lastComma = str.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);

  if (lastSep !== -1 && str.length - 1 - lastSep <= 2 && lastSep > 0) {
    const intPart = str.substring(0, lastSep).replace(/[.,]/g, '');
    const decPart = str.substring(lastSep + 1);
    str = `${intPart}.${decPart}`;
  } else {
    str = str.replace(/[.,]/g, '');
  }

  const num = Number(str);
  if (Number.isFinite(num) && num >= 0) {
    return { amount: num, isInvalid: false };
  }

  return { amount: 0, isInvalid: true };
}

export async function POST(req: NextRequest) {
  try {
    // 0. Rate limit (per-IP sliding window) before parsing any body
    const penalty = checkRateLimit(getClientIp(req));
    if (penalty !== null) {
      return NextResponse.json(
        {
          error: `Too many requests. Retry in ${penalty} seconds.`,
          retryAfterSeconds: penalty,
        },
        { status: 429, headers: { 'Retry-After': String(penalty) } }
      );
    }

    const body = await req.json();
    const { image, mimeType = 'image/jpeg' } = body;

    // 1. Validate image presence and type
    if (typeof image !== 'string' || !image.trim()) {
      return NextResponse.json(
        { error: 'Missing or invalid image data (base64 string expected).' },
        { status: 400 }
      );
    }

    // Strip data URL scheme prefix
    const cleanBase64 = image.replace(/^data:[^;]+;base64,/, '').trim();

    // 2. Validate base64 size (≤ ~4MB)
    if (cleanBase64.length > MAX_BASE64_CHARS) {
      return NextResponse.json(
        { error: 'Image exceeds maximum allowed upload size (4MB).' },
        { status: 413 }
      );
    }

    // 3. Validate mimeType against allowlist
    if (typeof mimeType !== 'string' || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        {
          error:
            'Unsupported image mimeType. Allowed formats: image/jpeg, image/png, image/webp.',
        },
        { status: 400 }
      );
    }

    // 4. Build the model chain: primary env model + fallbacks used ONLY on
    //    transient Google capacity errors (503 demand spikes). Quota (429),
    //    auth and validation errors are NOT chained — they would fail on every
    //    model the same way and the client already retries them.
    const rawModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const primary = /^[a-zA-Z0-9._-]+$/.test(rawModel) ? rawModel : 'gemini-3.8-flash';
    const sanitize = (m: string) => m.replace(/[^a-zA-Z0-9._-]/g, '');
    const fallbackEnv = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.6-flash,gemini-3.5-flash')
      .split(',')
      .map(sanitize)
      .filter((m) => m && /^[a-zA-Z0-9._-]+$/.test(m) && m !== primary);
    const modelChain = [primary, ...new Set(fallbackEnv)];

    // 5. Check API key
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'GEMINI_API_KEY is not configured in .env.local. Please add your free Gemini API key from aistudio.google.com/apikey to run live AI extractions on your screenshots.',
          missingApiKey: true,
        },
        { status: 500 }
      );
    }

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: EXTRACTION_PROMPT },
            {
              inline_data: {
                mime_type: mimeType,
                data: cleanBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    };

    // Try each model in the chain; only chain onward on 503 (capacity)
    // or network-level failures (timeout, DNS, connection reset).
    let response: Response | null = null;
    for (const candidateModel of modelChain) {
      const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent`;
      const res = await fetch(geminiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(payload),
        // Do not let a hung Gemini request block the cashier's batch forever.
        signal: AbortSignal.timeout(60_000),
      }).catch((netErr) => {
        console.warn(
          `Network failure calling Gemini model ${candidateModel}:`,
          netErr
        );
        return null;
      });

      if (!res) {
        // Transport-level failure (timeout/reset/DNS) -> next fallback model.
        continue;
      }

      response = res;

      if (response.ok) {
        // Preferred model succeeded
        console.log(`Gemini extraction OK via ${candidateModel}.`);
        break;
      }

      if (response.status === 429) {
        console.warn('Gemini 429 rate limit received.');
        return NextResponse.json(
          {
            error:
              'Gemini free-tier rate limit exceeded (429). Client should retry in 5 seconds.',
            isRateLimited: true,
          },
          { status: 429 }
        );
      }

      if (response.status === 503) {
        await response.text(); // consume body so the connection can be reused
        console.warn(
          `Gemini model ${candidateModel} busy (503). Trying next fallback (${modelChain.join(' → ')})...`
        );
        continue; // demand spike -> next model in chain
      }

      // Any other non-ok status (401/400/4xx/5xx): no point rotating models.
      const errText = await response.text();
      console.error('Gemini API error response:', response.status, errText);
      return NextResponse.json(
        { error: 'Failed to extract receipt with Gemini.' },
        { status: response.status }
      );
    }

    // Every model in the chain answered 503; the body was already consumed
    // while probing, so report a retryable 503 instead of touching it again.
    if (!response || !response.ok) {
      return NextResponse.json(
        {
          error:
            'Gemini models are temporarily overloaded (503 high demand). Please retry in a few seconds.',
        },
        { status: 503 }
      );
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      console.error('No extraction content returned by Gemini:', JSON.stringify(data));
      return NextResponse.json(
        { error: 'Extraction service returned an empty response.' },
        { status: 502 }
      );
    }

    let parsed: GeminiExtractionResponse;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('Failed to parse JSON from Gemini text:', rawText, parseErr);
      return NextResponse.json(
        { error: 'Could not parse extraction response.' },
        { status: 502 }
      );
    }

    // 6. Robust amount normalization without Math.abs sign folding
    const { amount, isInvalid } = parseReceiptAmount(parsed.amount);

    let confidence: GeminiExtractionResponse['confidence'] = [
      'high',
      'medium',
      'low',
    ].includes(parsed.confidence)
      ? parsed.confidence
      : 'low';

    // If amount is invalid or zero from unparseable input, force confidence to low
    if (isInvalid) {
      confidence = 'low';
    }

    const validatedResult: GeminiExtractionResponse = {
      is_receipt: Boolean(parsed.is_receipt),
      bank: (parsed.bank || '').trim(),
      amount,
      sender_name: (parsed.sender_name || '').trim(),
      receiver_name: (parsed.receiver_name || '').trim(),
      date_time: (parsed.date_time || '').trim(),
      reference_no: (parsed.reference_no || '').trim(),
      confidence,
    };

    return NextResponse.json(validatedResult);
  } catch (err: unknown) {
    console.error('Unhandled error in /api/extract:', err);
    return NextResponse.json(
      { error: 'Internal server error while processing receipt' },
      { status: 500 }
    );
  }
}
