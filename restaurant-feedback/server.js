// Smart QR Feedback — server (zero dependencies, Node 22.13+).
// Run:  node server.js     then open  http://localhost:3000/?table=5  and  http://localhost:3000/admin

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Load .env if present (built into Node — no dotenv needed).
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env file: use defaults */ }

const db = require('./db');
const ai = require('./ai');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const PUBLIC_DIR = path.join(__dirname, 'public');

const CONFIG = {
  restaurantName: process.env.RESTAURANT_NAME || 'Our Restaurant',
  googleReviewUrl: process.env.GOOGLE_REVIEW_URL || '',
  publicUrl: process.env.PUBLIC_URL || '',
  aspects: ai.ASPECTS,
};

// ---------- tiny helpers ----------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readJson(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

// Simple in-memory rate limiter: `max` hits per `windowMs` per IP per bucket.
const hits = new Map();
function rateLimited(req, bucket, max, windowMs) {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}
setInterval(() => { if (hits.size > 5000) hits.clear(); }, 10 * 60 * 1000).unref();

function isAdmin(req) {
  const given = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const want = Buffer.from(ADMIN_PASSWORD);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

const clean = (v, max) => (v == null ? '' : String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max));

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 404, 'Not found');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);

  // Pages
  if (req.method === 'GET' && (p === '/' || p === '/feedback')) return serveStatic(res, 'index.html');
  if (req.method === 'GET' && p === '/admin') return serveStatic(res, 'admin.html');
  if (req.method === 'GET' && p === '/healthz') return send(res, 200, { ok: true });

  // Public API
  if (req.method === 'GET' && p === '/api/config') return send(res, 200, CONFIG);

  if (req.method === 'GET' && p === '/api/suggestions') {
    if (rateLimited(req, 'sug', 40, 10 * 60 * 1000)) return send(res, 429, { error: 'Too many requests, please wait a moment.' });
    const rating = Number(q.rating);
    if (!(rating >= 1 && rating <= 5)) return send(res, 400, { error: 'rating must be 1–5' });
    const aspects = (q.aspects || '').split(',').map((s) => s.trim()).filter(Boolean);
    return send(res, 200, await ai.getSuggestions({ rating, lang: q.lang, aspects }));
  }

  if (req.method === 'POST' && p === '/api/feedback') {
    if (rateLimited(req, 'post', 8, 10 * 60 * 1000)) return send(res, 429, { error: 'Too many submissions from this device. Please try again later.' });
    const b = await readJson(req);
    const rating = Number(b.rating);
    const text = clean(b.text, 1000);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return send(res, 400, { error: 'Please choose a star rating.' });
    if (text.length < 3) return send(res, 400, { error: 'Please write or pick some feedback.' });
    const source = ['ai', 'ai_edited', 'custom'].includes(b.source) ? b.source : 'custom';
    const saved = db.addFeedback({
      rating, text, source,
      tableNo: clean(b.table, 20),
      orderId: clean(b.orderId, 40),
    });
    return send(res, 201, { ok: true, ...saved });
  }

  // Admin API (password in the X-Admin-Key header)
  if (p.startsWith('/api/admin/')) {
    // Brute-force guard: after 10 wrong passwords, that IP is locked out for 15 minutes.
    const failKey = `adminfail:${clientIp(req)}`;
    const recentFails = (hits.get(failKey) || []).filter((t) => Date.now() - t < 15 * 60 * 1000);
    if (recentFails.length >= 10) return send(res, 429, { error: 'Too many wrong passwords. Try again in 15 minutes.' });
    if (!isAdmin(req)) {
      hits.set(failKey, [...recentFails, Date.now()]);
      return send(res, 401, { error: 'Wrong password' });
    }
    const filters = { rating: q.rating, table: q.table, days: q.days };
    if (p === '/api/admin/stats') return send(res, 200, { ...db.getStats(filters), aiEnabled: ai.aiEnabled() });
    if (p === '/api/admin/feedback') return send(res, 200, db.listFeedback({ ...filters, limit: q.limit, offset: q.offset }));
    if (p === '/api/admin/export.csv') {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = db.allFeedback(filters);
      const csv = ['id,rating,feedback_text,created_at_utc,table_no,order_id,source']
        .concat(rows.map((r) => [r.id, r.rating, esc(r.feedback_text), r.created_at, esc(r.table_no), esc(r.order_id), r.source].join(',')))
        .join('\n');
      return send(res, 200, '﻿' + csv, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="feedback-${new Date().toISOString().slice(0, 10)}.csv"`,
      });
    }
    return send(res, 404, { error: 'Not found' });
  }

  // Other static assets (favicon etc.)
  if (req.method === 'GET' && /^\/[\w.-]+$/.test(p)) return serveStatic(res, p.slice(1));
  return send(res, 404, 'Not found');
}

http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
  });
}).listen(PORT, () => {
  console.log(`\n  ${CONFIG.restaurantName} — feedback system running`);
  console.log(`  Customer page : http://localhost:${PORT}/?table=1`);
  console.log(`  Admin         : http://localhost:${PORT}/admin`);
  console.log(`  AI            : ${ai.aiEnabled() ? 'on (' + ai.MODEL + ')' : 'off — using built-in templates (set OPENAI_API_KEY to enable)'}`);
  console.log(`  Database      : ${db.DB_PATH}`);
  if (ADMIN_PASSWORD === 'change-me') console.log('  ⚠  Set ADMIN_PASSWORD in .env before going live.');
  console.log('');
});
