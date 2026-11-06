import { NextRequest, NextResponse } from 'next/server';
import { normalizeVerification, type LinksEtEnvelope } from '@/utils/linksEt';
import type { VerifiedReceipt } from '@/types/transfer';

// A screenshot read runs an AI detector and then a chained fetch against the
// bank, which can legitimately take tens of seconds. Without this, serverless
// hosts kill the function on their plan default and the cashier sees a 504.
export const maxDuration = 60;

const LINKS_ET_ENDPOINT = 'https://links.et/api/verify-image';

// links.et waits for a busy bank, then fetches, then retries on another egress
// address — an uncached receipt can hold the connection for over a minute. We
// abort below the platform limit and let the client retry; by then links.et has
// cached the receipt, so the retry returns instantly.
const UPSTREAM_TIMEOUT_MS = 55_000;

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// links.et accepts 5MB of base64 per image.
const MAX_BASE64_CHARS = Math.ceil((5 * 1024 * 1024 * 4) / 3);

/* ------------------------------------------------------------------ */
/* In-memory per-IP sliding-window rate limiter.                       */
/* This endpoint spends a paid, metered screenshot allowance, so it is */
/* throttled before any upstream call. Note: per-instance only — put a */
/* shared limiter at the edge for multi-instance deployments.          */
/* ------------------------------------------------------------------ */
const RATE_LIMIT_PER_MINUTE = Number(process.env.VERIFY_RATE_LIMIT_PER_MINUTE) || 20;
const RATE_WINDOW_MS = 60_000;

type Hit = { count: number; windowStart: number };
const rateMap = new Map<string, Hit>();
let lastSweep = Date.now();

function sweepStaleEntries(now: number): void {
  for (const [key, hit] of rateMap.entries()) {
    if (now - hit.windowStart > RATE_WINDOW_MS) rateMap.delete(key);
  }
  lastSweep = now;
}

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

function retryAfterSeconds(res: Response): number | undefined {
  const header = Number(res.headers.get('Retry-After'));
  return Number.isFinite(header) && header > 0 ? header : undefined;
}

export type VerifyApiResponse =
  | { ok: true; status: 'verified'; receipt: VerifiedReceipt }
  | {
      ok: true;
      status: 'unverified';
      reason: string;
      provider?: string;
      reference?: string;
    };

export async function POST(req: NextRequest) {
  try {
    // 0. Rate limit before parsing any body or spending a metered read.
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

    const body = await req.json().catch(() => null);
    const image = body?.image;
    const mimeType = body?.mimeType ?? 'image/jpeg';

    if (typeof image !== 'string' || !image.trim()) {
      return NextResponse.json(
        { error: 'Missing or invalid image data (base64 string expected).' },
        { status: 400 }
      );
    }

    if (typeof mimeType !== 'string' || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        {
          error:
            'Unsupported image mimeType. Allowed formats: image/jpeg, image/png, image/webp.',
        },
        { status: 400 }
      );
    }

    const cleanBase64 = image.replace(/^data:[^;]+;base64,/, '').trim();
    if (cleanBase64.length > MAX_BASE64_CHARS) {
      return NextResponse.json(
        { error: 'Image exceeds the maximum allowed size (5MB).' },
        { status: 413 }
      );
    }

    // The key is a server-side credential and must never reach the browser.
    const apiKey = process.env.LINKS_ET_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'LINKS_ET_API_KEY is not configured. Add your links.et API key to .env.local to verify receipts with the bank.',
          missingApiKey: true,
        },
        { status: 500 }
      );
    }

    const upstream = await fetch(LINKS_ET_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageBase64: cleanBase64 }),
      // A hung request must not block the cashier's batch forever.
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    }).catch((netErr) => {
      console.warn('Network failure calling links.et verify-image:', netErr);
      return null;
    });

    if (!upstream) {
      // Transport-level failure: the receipt may still be resolving upstream,
      // and a retry will hit their cache, so this is worth retrying.
      return NextResponse.json(
        {
          error:
            'links.et did not respond in time. Retrying usually succeeds because the receipt is cached upstream.',
        },
        { status: 503 }
      );
    }

    const envelope = (await upstream.json().catch(() => null)) as LinksEtEnvelope | null;

    if (!upstream.ok || !envelope) {
      const code = envelope?.error?.code || '';
      const wait = retryAfterSeconds(upstream);

      // Quota problems have no useful retry timer: the monthly screenshot
      // allowance is spent, so stop the batch instead of hammering the endpoint.
      if (code === 'image_cap_reached') {
        return NextResponse.json(
          {
            error:
              'The monthly screenshot allowance for links.et is used up. Verify again from a receipt link, or upgrade the plan.',
            quotaExceeded: true,
          },
          { status: 429 }
        );
      }
      if (code === 'quota_exceeded') {
        return NextResponse.json(
          {
            error:
              'The links.et verification quota for this period is used up. Cached receipts still verify for free.',
            quotaExceeded: true,
          },
          { status: 429 }
        );
      }

      // Anything else (rate_limited, busy bank, transient 502/503) is retryable.
      const status = upstream.status >= 500 ? 503 : upstream.status;
      return NextResponse.json(
        {
          error: envelope?.error?.message || 'Verification failed at links.et.',
          retryAfterSeconds: wait,
        },
        {
          status,
          headers: wait ? { 'Retry-After': String(wait) } : undefined,
        }
      );
    }

    const outcome = normalizeVerification(envelope);

    if (outcome.status === 'verified') {
      return NextResponse.json({
        ok: true,
        status: 'verified',
        receipt: outcome.receipt,
      } satisfies VerifyApiResponse);
    }

    return NextResponse.json({
      ok: true,
      status: 'unverified',
      reason: outcome.reason,
      provider: outcome.detected?.provider,
      reference: outcome.detected?.reference ?? undefined,
    } satisfies VerifyApiResponse);
  } catch (err: unknown) {
    console.error('Unhandled error in /api/verify:', err);
    return NextResponse.json(
      { error: 'Internal server error while verifying receipt' },
      { status: 500 }
    );
  }
}
