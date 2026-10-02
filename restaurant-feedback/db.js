// Database layer — uses Node's built-in SQLite (no install needed).
// All feedback lives in a single file (data/feedback.db by default).
// To move to MongoDB/Firebase later, re-implement these 5 functions; nothing else changes.

const fs = require('node:fs');
const path = require('node:path');

// Silence the one-time "SQLite is experimental" warning so logs stay clean.
const origEmit = process.emitWarning;
process.emitWarning = (w, ...a) =>
  String(w).includes('SQLite') ? undefined : origEmit.call(process, w, ...a);
const { DatabaseSync } = require('node:sqlite');

// Restaurant's UTC offset in minutes (India = 330), used to group reviews by local day.
const TZ_OFFSET_MIN = Number(process.env.TZ_OFFSET_MINUTES || 0);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'feedback.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS feedback (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback_text TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,              -- ISO 8601, UTC
    table_no      TEXT,                          -- from the QR code (optional)
    order_id      TEXT,                          -- typed by customer (optional)
    source        TEXT    NOT NULL DEFAULT 'custom' -- 'ai' | 'ai_edited' | 'custom'
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
  CREATE INDEX IF NOT EXISTS idx_feedback_rating  ON feedback(rating);
`);

const insertStmt = db.prepare(`
  INSERT INTO feedback (rating, feedback_text, created_at, table_no, order_id, source)
  VALUES (?, ?, ?, ?, ?, ?)
`);

function addFeedback({ rating, text, tableNo, orderId, source }) {
  const createdAt = new Date().toISOString();
  const r = insertStmt.run(rating, text, createdAt, tableNo || null, orderId || null, source);
  return { id: Number(r.lastInsertRowid), createdAt };
}

// Builds a WHERE clause from optional filters: rating, table, days (look-back window).
function where({ rating, table, days } = {}) {
  const clauses = [];
  const params = [];
  if (rating) { clauses.push('rating = ?'); params.push(Number(rating)); }
  if (table) { clauses.push('table_no = ?'); params.push(String(table)); }
  if (days) {
    clauses.push('created_at >= ?');
    params.push(new Date(Date.now() - Number(days) * 864e5).toISOString());
  }
  return { sql: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

function getStats(filters = {}) {
  const w = where({ table: filters.table, days: filters.days });
  const s = db.prepare(`
    SELECT COUNT(*)                                        AS total,
           ROUND(AVG(rating), 2)                           AS average,
           SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END)    AS positive,
           SUM(CASE WHEN rating  = 3 THEN 1 ELSE 0 END)    AS neutral,
           SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END)    AS negative,
           SUM(CASE WHEN source  = 'ai'        THEN 1 ELSE 0 END) AS src_ai,
           SUM(CASE WHEN source  = 'ai_edited' THEN 1 ELSE 0 END) AS src_ai_edited,
           SUM(CASE WHEN source  = 'custom'    THEN 1 ELSE 0 END) AS src_custom
    FROM feedback ${w.sql}
  `).get(...w.params);

  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of db.prepare(
    `SELECT rating, COUNT(*) AS n FROM feedback ${w.sql} GROUP BY rating`
  ).all(...w.params)) dist[row.rating] = row.n;

  // Daily average + count for the last 14 days, grouped by the restaurant's local date.
  const tw = where({ table: filters.table, days: 14 });
  const trend = db.prepare(`
    SELECT substr(datetime(created_at, '${TZ_OFFSET_MIN >= 0 ? '+' : ''}${TZ_OFFSET_MIN} minutes'), 1, 10) AS day, COUNT(*) AS count, ROUND(AVG(rating), 2) AS average
    FROM feedback ${tw.sql} GROUP BY day ORDER BY day
  `).all(...tw.params);

  const tables = db.prepare(`
    SELECT table_no, COUNT(*) AS count, ROUND(AVG(rating), 2) AS average
    FROM feedback WHERE table_no IS NOT NULL GROUP BY table_no ORDER BY count DESC LIMIT 30
  `).all();

  const total = s.total || 0;
  return {
    total,
    average: s.average || 0,
    positive: s.positive || 0,
    neutral: s.neutral || 0,
    negative: s.negative || 0,
    positivePct: total ? Math.round((s.positive / total) * 100) : 0,
    negativePct: total ? Math.round((s.negative / total) * 100) : 0,
    sources: { ai: s.src_ai || 0, aiEdited: s.src_ai_edited || 0, custom: s.src_custom || 0 },
    distribution: dist,
    trend,
    tzOffsetMinutes: TZ_OFFSET_MIN,
    tables,
  };
}

function listFeedback({ limit = 20, offset = 0, ...filters } = {}) {
  const w = where(filters);
  const rows = db.prepare(
    `SELECT * FROM feedback ${w.sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...w.params, Math.min(Number(limit) || 20, 200), Number(offset) || 0);
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM feedback ${w.sql}`).get(...w.params);
  return { rows, total: n };
}

function allFeedback(filters = {}) {
  const w = where(filters);
  return db.prepare(`SELECT * FROM feedback ${w.sql} ORDER BY created_at DESC`).all(...w.params);
}

module.exports = { addFeedback, getStats, listFeedback, allFeedback, DB_PATH };
