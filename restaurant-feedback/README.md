# Smart QR Feedback

A QR-code customer feedback system for restaurants. Customers scan, tap a star rating, pick an AI-written review (or edit it, or write their own), and submit. The owner sees everything on a live dashboard.

**Zero dependencies** — no `npm install`. It needs only Node.js 22.13 or newer.

## Quick start

```bash
cp .env.example .env      # then edit: restaurant name, admin password, (optional) OpenAI key
node server.js
```

- Customer page: http://localhost:3000/?table=1
- Admin dashboard: http://localhost:3000/admin

## What's included

| File | What it does |
|---|---|
| `server.js` | Web server and API (built-in `http` module) |
| `db.js` | SQLite database (built-in `node:sqlite`), stored in `data/feedback.db` |
| `ai.js` | AI suggestions via OpenAI or any OpenAI-compatible API, with instant template fallback |
| `public/index.html` | Customer feedback page (mobile-first, English / Hindi / Marathi) |
| `public/admin.html` | Owner dashboard + printable QR codes |
| `public/qr.js` | QR code generator (no external library) |

## How it works

**Customer flow.** Scan QR → tap 1–5 stars → (optional) tap what stood out: food, service, ambiance, value, speed, cleanliness → pick one of 3 suggestions, edit it or write their own → optional order/bill number → submit. No login. The page is a single ~20 KB file with no fonts or libraries to download, so it loads instantly on mobile data.

**AI suggestions.** The tone follows the rating: 5★ enthusiastic, 4★ positive with one small improvement, 3★ mixed, 2★ dissatisfied with a concrete suggestion, 1★ strongly negative. If the customer picks aspects, the suggestions focus on those. Suggestions are generated in the language the customer chose.

- Leave `OPENAI_API_KEY` empty and the system uses built-in templates (free, works offline).
- With a key, results are cached for 15 minutes per rating and language, so a busy night costs a few paise, not rupees.
- If the AI is slow (over `AI_TIMEOUT_MS`) or down, customers get template suggestions instantly. The page never hangs.
- Any OpenAI-compatible provider works: set `OPENAI_BASE_URL` and `OPENAI_MODEL` (examples in `.env.example`).

**Database.** Every submission stores: star rating, final feedback text, date and time (UTC), table/section from the QR code, optional order ID, and `source` — whether the customer used an AI suggestion as-is, edited it, or wrote their own.

**Dashboard.** Average rating, total reviews, positive (4–5★) vs negative (1–2★) percentages and ratio, rating breakdown, 14-day trend, per-table averages, latest feedback with rating filter (low ratings highlighted), CSV export (opens in Excel), and auto-refresh every 30 seconds. Filter by today / 7 days / 30 days / all time.

**QR codes.** In the dashboard, enter your site address and a list like `1-12, entrance, bill`, click Generate, then Print. Each code opens the feedback page tagged with its table or section.

## Google reviews

Set `GOOGLE_REVIEW_URL` and every customer sees an "Also share on Google" button after submitting, with their review already copied. It is deliberately shown for **all** ratings: Google's policy forbids "review gating" (only sending happy customers to Google), and doing so can get your listing's reviews removed.

## Going live

The customer page must be reachable from customers' phones, so it needs to run on the internet:

1. **Any Node host** (Render, Railway, Fly.io, a small VPS): upload the folder, set the `.env` values as environment variables, start with `node server.js`. Use a persistent disk for the `data/` folder so reviews survive restarts.
2. Set `PUBLIC_URL` to your final address, then print the QR codes from the dashboard.
3. Use a strong `ADMIN_PASSWORD` and serve over HTTPS (all the hosts above do this automatically).

**Testing on your Wi-Fi first:** run it on a laptop, find the laptop's local IP (e.g. `192.168.1.20`), put `http://192.168.1.20:3000` in the dashboard's QR address box, and scan with your phone.

**Backups:** the whole database is one file, `data/feedback.db`. Copy it, or export CSV from the dashboard.

## Switching to MongoDB or Firebase

All database access is in `db.js` (5 functions: `addFeedback`, `getStats`, `listFeedback`, `allFeedback`). Re-implement them against another database and nothing else needs to change. SQLite handles a single restaurant's volume easily — tens of thousands of reviews — so this is only worth doing if you need several branches sharing one database.

## Security notes

- Submissions are rate-limited per device (8 per 10 minutes) and suggestions (40 per 10 minutes) to stop spam and protect your AI bill.
- The admin API locks an IP out for 15 minutes after 10 wrong passwords.
- All customer text is escaped when displayed, so it can't inject code into the dashboard.
