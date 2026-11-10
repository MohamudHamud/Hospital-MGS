const crypto = require('crypto');
const express = require('express');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const notFound = (m = 'Not found') => new HttpError(404, m);

function need(obj, fields) {
  for (const f of fields) {
    const v = obj[f];
    if (v === undefined || v === null || String(v).trim() === '') throw bad(`${f.replace(/_/g, ' ')} is required`);
  }
}

const pad = (n, w = 5) => String(n).padStart(w, '0');
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Give a row a readable number like INV-261109-00042 based on its id.
async function assignNo(c, table, col, prefix, id) {
  const no = `${prefix}${today().replace(/-/g, '').slice(2)}-${pad(id)}`;
  await c.query(`UPDATE \`${table}\` SET \`${col}\`=? WHERE id=?`, [no, id]);
  return no;
}

function randomRef(prefix = 'APT-', len = 7) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(len)) s += A[b % A.length];
  return prefix + s;
}

async function audit(c, user, action, entity, entityId, details) {
  try {
    const d = details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 2000);
    await c.query('INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)',
      [user ? user.id : null, action, entity, entityId || null, d]);
  } catch (e) { console.error('audit failed:', e.message); }
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const nz = (v) => (v === '' || v === undefined ? null : v);
function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = nz(obj[k]);
  return o;
}
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Express 4 router that forwards rejected promises to the error handler.
function Router() {
  const r = express.Router();
  for (const m of ['get', 'post', 'put', 'delete', 'patch']) {
    const orig = r[m].bind(r);
    r[m] = (path, ...handlers) => orig(path, ...handlers.map((h) =>
      (req, res, next) => { try { const p = h(req, res, next); if (p && p.catch) p.catch(next); } catch (e) { next(e); } }));
  }
  return r;
}

module.exports = { HttpError, bad, notFound, need, pad, today, assignNo, randomRef, audit, round2, nz, pick, int, isDate, Router };
