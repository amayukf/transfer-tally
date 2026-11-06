# 🧾 Transfer Tally

**Mobile-First Progressive Web App (PWA)** for student-lounge and cafe cashiers in Ethiopia to scan money transfer screenshots (**Telebirr, CBE, Awash, Bank of Abyssinia, Dashen**, and more), extract transaction data with Google Gemini AI, automatically detect & exclude duplicate payments, and compute the day's true total.

Built with **Next.js (App Router)** + **TypeScript** + **Plain CSS**. Uses **only free services** with zero paid databases.

---

## ✨ Features

- **📱 Mobile-First PWA**: Installable on iPhone and Android (`standalone` display, theme color `#0f766e`, offline service worker shell).
- **📤 Share-to-App Import (Android)**: Once installed, Transfer Tally appears in the phone's Share sheet. The cashier selects the whole day's screenshots in the gallery, taps **Share → Transfer Tally**, and the scan starts automatically — no file picker, no tapping images one by one.
- **⚡ Client-Side Canvas Compression**: Automatically resizes screenshots on the device to max 1400px at JPEG 0.85 before uploading for ultra-fast transfers and minimal data usage.
- **🤖 Free-Tier Gemini AI Extraction**: Calls Google Gemini (`gemini-3.8-flash`) via REST API with strict JSON schema validation.
- **🔄 Resilient Extraction Retries**: Automatically retries when the extraction service is rate-limited (429) or temporarily unavailable, honouring the server's own cooldown hint (`Retry-After`). Requests that can never succeed (invalid image, missing API key) fail immediately with the exact reason shown to the cashier.
- **🔀 Automatic Model Fallback**: If Google's primary flash model answers 503 ("high demand"), the server transparently retries the same extraction on the configured fallback models (`gemini-3.6-flash` → `gemini-3.5-flash` by default, tunable via `GEMINI_FALLBACK_MODELS`) so the cashier's nightly close never stalls on a capacity blip.
- **🛡️ Duplicate Detection Engine**:
  - Automatically flags transfers with duplicate reference numbers (both within the current batch and across past days).
  - Dimmed visual styling with clear `⚠️ Duplicate` status badges.
  - **Duplicate amounts are strictly excluded from the total!**
- **🚫 Non-Receipt Shield**: Random gallery screenshots picked by accident are detected (`is_receipt: false`), badged `🚫 Not a Receipt (Excluded)`, counted nowhere, and can be re-classified by the cashier in the editor.
- **🌙 One-Tap Nightly Close**: Select the whole day's screenshots at once (50–100+ supported — they are scanned sequentially with a live progress bar), get the grand total, then a **pre-save review dialog** lists every exclusion (duplicates / non-receipts / missing refs / low-confidence) before the day is archived.
- **🧮 Strictly In-Code Total Calculation**: Sums are computed mathematically in code; AI is never asked to add numbers.
- **✏️ Cashier Field Editor & Lightbox**: Inspect original receipts side-by-side, quickly edit any field, or delete entries.
- **💾 Local Storage ("days")**: All past days are archived in browser `localStorage` wrapped in safe `try/catch`.
- **📥 CSV Export**: One-tap download of the daily ledger (`TransferTally_YYYY-MM-DD.csv`).
- **☀️ Daylight-Readable & Dark Mode**: High-contrast typography designed for bright outdoor sunlight and evening lounge shifts.

---

## 🔑 How to Get a Free Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey).
2. Sign in with any free Google account.
3. Click **"Create API key"** and copy your key.
4. (Optional) Note: Gemini Flash on the free tier provides generous daily limits at no cost.

---

## 🚀 Running Locally

### 1. Prerequisites
- **Node.js** v18 or higher (v20+ recommended)
- **npm** or **yarn** / **pnpm**

### 2. Clone and Install
```bash
git clone <your-repo-url>
cd transfer-tally
npm install
```

### 3. Setup Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Open `.env.local` and paste your Gemini API key:
```env
GEMINI_API_KEY=AIzaSy...YourKeyHere...
GEMINI_MODEL=gemini-3.8-flash
```

### 4. Start the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) on your phone or desktop browser.

---

## ☁️ Deploying for Free on Vercel

1. Push your code to a GitHub repository.
2. Go to [Vercel](https://vercel.com) and click **"Add New Project"**.
3. Import your GitHub repository.
4. Under **Environment Variables**, add:
   - `GEMINI_API_KEY`: *Your Google AI Studio key*
   - `GEMINI_MODEL`: `gemini-3.8-flash`
5. Click **"Deploy"**.
6. Your PWA will be live on an HTTPS URL (required for camera capture and PWA installation).

---

## 📲 How to Install as a PWA on Phones

### On iPhone (Safari)
1. Open your deployed Vercel URL in Safari.
2. Tap the **Share** button (box with an arrow pointing up) at the bottom.
3. Scroll down and tap **"Add to Home Screen"**.
4. Tap **Add**. Transfer Tally will appear on your home screen like a native app.

### On Android (Chrome)
1. Open the URL in Google Chrome.
2. Tap the three-dot menu `⋮` in the top-right corner.
3. Tap **"Install app"** or **"Add to Home screen"**.

---

## 📤 Sharing Screenshots Straight from the Gallery

The fastest nightly workflow on **Android** (requires the app to be installed as a PWA, and the site served over HTTPS):

1. Open the phone's **Gallery** and select every screenshot taken during the day.
2. Tap **Share** and choose **Transfer Tally**.
3. The app opens and starts scanning automatically; the day's total appears when it finishes.

Under the hood, the manifest registers a **Web Share Target** (`/share-target`, `POST`, `multipart/form-data`). The service worker receives the shared images, parks them in the Cache API under `transfer-tally-shared`, and redirects the app to `/?shared=1`, where the page picks them up and starts the batch. Nothing is uploaded until the cashier confirms the scan.

> **Platform note:** the Web Share Target API is supported by Chromium browsers on Android. **iOS Safari does not support it** — on iPhone, use the **📁 Pick Screenshots** button in the app instead. The share option only appears after the PWA is installed.

---

## 🛡️ How Duplicate Exclusion Works

Every reference number is normalized (trimmed, uppercased, and stripped of separators) before comparison, so `TLB 9842104` and `tlb9842104` are recognised as the same transaction.

A transfer is excluded from the day's total when:

- **Duplicate** — its reference number already appeared earlier in the current batch or in any previously saved day.
- **Missing reference** — no reference number could be read; the row is flagged for review until the cashier enters one.

Excluded rows stay visible, are visually dimmed, and are labelled in the receipt list and in the CSV export. The total is always summed in code — the AI is never asked to add numbers.

---

## 🔒 Security & Limitations

- **Client-Side Storage**: Daily transfer tallies and transaction records are archived locally in browser `localStorage`. To protect device storage quotas (~5MB browser ceiling), full-resolution image previews are automatically stripped from persistence if storage approaches capacity.
- **Open Extractor API**: The `/api/extract` route acts as a direct proxy to Gemini's vision endpoint. It enforces a 4MB size cap, MIME-type allowlists, suppression of upstream error traces, and per-IP rate limiting (**20 requests/min** default, tunable via `RATE_LIMIT_PER_MINUTE`). The limiter is in-memory per server instance — for multi-instance deployments, enforce limits at the edge (e.g. Vercel WAF) or add basic cashier session authentication.

---

## 🚦 Production Checklist

- [ ] `GEMINI_API_KEY` is set as a **deployment environment variable**, never committed to the repo (`.env*` is gitignored).
- [ ] App is served over **HTTPS** (PWA install + service worker require it).
- [ ] Share-to-app verified on an **installed Android PWA** — the service worker (which handles `/share-target`) is skipped on `localhost`, so this flow can only be tested on a deployed HTTPS origin.
- [ ] Rate limit reviewed: set `RATE_LIMIT_PER_MINUTE` per your Gemini tier (free tier ≈ 15 RPM — if you see frequent 429s, lower it). Large nightly batches are throttled by this cap and pace themselves automatically; raising it speeds up a big batch but risks upstream 429s.
- [ ] Data residency acknowledged: receipt images are sent to Google Gemini for extraction and receipts stay on the device in `localStorage` — make cashiers aware.
- [ ] `localStorage` is device-local by design: clearing browser data wipes records. Export CSVs regularly as backup.

---

## 📄 License
MIT License. Built for Ethiopian student lounge cashiers and small merchants.
