import { parseSharedReport } from '../../js/shared-report.js';
import { blankStats } from '../../js/domain.js';

const ID = /^[A-Za-z0-9_-]{22}$/;
const MAX_BODY = 128 * 1024;
const DAY = 86400000;
const encoder = new TextEncoder();
const statKeys = Object.keys(blankStats());
const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const random = () => base64(crypto.getRandomValues(new Uint8Array(16)));
const sha = async text => base64(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new HttpError(status, code, message); };

async function equal(a, b) {
  const aa = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(a)));
  const bb = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(b)));
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function passwordHash(password, salt, pepper) {
  // A database-only leak does not allow password guessing without the Worker secret.
  const key = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', key, encoder.encode(password));
  const material = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveBits']);
  return base64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, material, 256));
}

async function readJSON(request, max = MAX_BODY) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) fail(415, 'json_required', 'JSON形式で送信してください。');
  if (Number(request.headers.get('Content-Length')) > max) fail(413, 'too_large', '共有データが大きすぎます。');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_data', '共有データがありません。');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); fail(413, 'too_large', '共有データが大きすぎます。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { fail(400, 'invalid_data', '共有データを読み取れません。'); }
}

function canonicalReport(data) {
  let report;
  try { report = parseSharedReport(JSON.stringify(data)); }
  catch { fail(400, 'invalid_report', '共有レポートの形式が不正です。'); }
  const stats = value => Object.fromEntries(statKeys.map(key => [key, value[key]]));
  // Allowlist fields: never store injected settings, internal IDs, or event logs.
  return { app: 'courtside-report', schemaVersion: 1, report: {
    date: report.date, format: report.format, status: report.status,
    gameCount: report.gameCount || 1,
    tournamentName: report.tournamentName || '',
    games: Array.isArray(report.games) ? report.games.map(game => ({
      date: game.date, format: game.format, status: game.status,
      gameCount: 1, teamName: game.teamName, opponentName: game.opponentName, opponentScore: game.opponentScore,
      periods: game.periods.map(p => ({ label: p.label, home: p.home, away: p.away })),
      team: stats(game.team),
      shots: game.shots,
      players: game.players.map(p => ({ id: p.id, number: p.number, name: p.name, stats: stats(p.stats) })),
    })) : undefined,
    teamName: report.teamName, opponentName: report.opponentName, opponentScore: report.opponentScore,
    periods: report.periods.map(p => ({ label: p.label, home: p.home, away: p.away })),
    team: stats(report.team),
    shots: report.shots,
    players: report.players.map(p => ({ id: p.id, number: p.number, name: p.name, stats: stats(p.stats) })),
  } };
}

async function limit(db, key, maximum, windowMs, now) {
  const bucket = Math.floor(now / windowMs);
  const row = await db.prepare('INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count')
    .bind(`${key}:${bucket}`, (bucket + 1) * windowMs).first();
  if (row.count > maximum) fail(429, 'rate_limited', '操作が多すぎます。しばらく待ってから再試行してください。');
}

async function route(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method, now = Date.now();
  if (!env.DB || !/^[A-Za-z0-9_-]{43,128}$/.test(env.PUBLISHER_TOKEN || '') || (env.PASSWORD_PEPPER || '').length < 32) fail(503, 'not_configured', '共有サービスの初期設定が完了していません。');
  // Use the primary for immediate creation/revocation visibility, also if replicas are enabled later.
  const db = env.DB.withSession ? env.DB.withSession('first-primary') : env.DB;
  if (path === '/health' && method === 'GET') {
    await db.prepare('SELECT id FROM shares LIMIT 1').first();
    return { service: 'courtside-share', schemaVersion: 1 };
  }
  const ip = await sha(`ip:${request.headers.get('CF-Connecting-IP') || 'local'}`);
  await limit(db, `request:${ip}`, 120, 60000, now);
  const management = path === '/v1/shares' || (method !== 'POST' && /^\/v1\/shares\/[A-Za-z0-9_-]{22}$/.test(path));
  if (management) {
    const authorization = request.headers.get('Authorization') || '';
    if (authorization.length > 160 || !await equal(authorization, `Bearer ${env.PUBLISHER_TOKEN}`)) fail(401, 'unauthorized', '共有用管理キーを確認してください。');
  }
  if (path === '/v1/shares' && method === 'POST') {
    await limit(db, 'publish', 100, DAY, now);
    const data = await readJSON(request);
    if (!data || (data.days !== null && ![7, 30, 90, 365].includes(data.days))) fail(400, 'invalid_expiry', '有効期限を選んでください。');
    const password = data.password ?? '';
    if (typeof password !== 'string' || (password && (password.length < 8 || password.length > 128))) fail(400, 'invalid_password', 'パスワードは8〜128文字で設定してください。');
    const report = canonicalReport(data.report);
    const count = await db.prepare('SELECT COUNT(*) AS total FROM shares WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)').bind(now).first();
    if (count.total >= 1000) fail(409, 'storage_limit', '共有の上限に達しました。不要な共有を停止してください。');
    const id = random(), salt = password ? random() : null;
    const hash = password ? await passwordHash(password, salt, env.PASSWORD_PEPPER) : null;
    const expiresAt = data.days === null ? null : now + data.days * DAY;
    const title = `${report.report.tournamentName ? `${report.report.tournamentName} · ` : ''}${report.report.date} ${report.report.teamName} vs ${report.report.opponentName}`;
    await db.prepare('INSERT INTO shares (id, report, title, created_at, expires_at, password_salt, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, JSON.stringify(report), title, now, expiresAt, salt, hash).run();
    return { id, title, createdAt: now, expiresAt, passwordRequired: !!password };
  }
  if (path === '/v1/shares' && method === 'GET') {
    const { results } = await db.prepare('SELECT id, title, created_at, expires_at, password_hash IS NOT NULL AS protected FROM shares WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1000').bind(now).all();
    return { shares: results.map(row => ({ id: row.id, title: row.title, createdAt: row.created_at, expiresAt: row.expires_at, passwordRequired: !!row.protected })) };
  }
  const detailMatch = path.match(/^\/v1\/shares\/([A-Za-z0-9_-]{22})$/);
  if (detailMatch && method === 'GET') {
    const row = await db.prepare('SELECT id, report, title, created_at, expires_at, password_hash FROM shares WHERE id = ?').bind(detailMatch[1]).first();
    if (!row || !row.report || (row.expires_at !== null && row.expires_at <= now)) fail(404, 'unavailable', '共有が停止されたか、有効期限が切れています。');
    return { id: row.id, title: row.title, createdAt: row.created_at, expiresAt: row.expires_at, passwordRequired: !!row.password_hash, report: JSON.parse(row.report).report };
  }
  const match = path.match(/^\/v1\/shares\/([A-Za-z0-9_-]{22})(\/open)?$/);
  if (!match || !ID.test(match[1])) fail(404, 'not_found', '共有が見つかりません。');
  const id = match[1];
  if (method === 'DELETE' && !match[2]) {
    // Delete the server-side snapshot immediately; copies already received by others cannot be erased.
    await db.prepare('DELETE FROM shares WHERE id = ?').bind(id).run();
    return { deleted: true, stopped: true };
  }
  if (method !== 'POST' || !match[2]) fail(405, 'method_not_allowed', 'この操作には対応していません。');
  const data = await readJSON(request, 2048);
  const row = await db.prepare('SELECT report, expires_at, revoked_at, password_salt, password_hash FROM shares WHERE id = ?').bind(id).first();
  if (!row || row.revoked_at || (row.expires_at !== null && row.expires_at <= now)) fail(404, 'unavailable', '共有が停止されたか、有効期限が切れています。リンクも確認してください。');
  if (row.password_hash) {
    if (!data?.password) fail(401, 'password_required', 'パスワードを入力してください。');
    if (typeof data.password !== 'string' || data.password.length > 128) fail(400, 'invalid_password', 'パスワードを確認してください。');
    await limit(db, `password:${ip}:${id}`, 10, 15 * 60000, now);
    const hash = await passwordHash(data.password, row.password_salt, env.PASSWORD_PEPPER);
    if (!await equal(hash, row.password_hash)) fail(401, 'wrong_password', 'パスワードが違います。');
  }
  return { ...JSON.parse(row.report), expiresAt: row.expires_at };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const headers = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer', 'Vary': 'Origin',
    };
    if (origin && !allowed.includes(origin)) return new Response(JSON.stringify({ code: 'origin_denied', message: '許可されていない接続元です。' }), { status: 403, headers });
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } });
    try { return new Response(JSON.stringify(await route(request, env)), { headers }); }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      if (status === 429) headers['Retry-After'] = '900';
      return new Response(JSON.stringify({ code: error instanceof HttpError ? error.code : 'unavailable', message: error instanceof HttpError ? error.message : '共有サービスへ接続できません。時間をおいて再試行してください。' }), { status, headers });
    }
  },
  async scheduled(_event, env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM shares WHERE (expires_at IS NOT NULL AND expires_at <= ?) OR revoked_at IS NOT NULL').bind(now),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(now),
    ]);
  },
};
