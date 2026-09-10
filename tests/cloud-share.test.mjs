import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/src/worker.js';
import { fixture, testEnv, testToken } from './cloud-fixture.mjs';
import { shortShareLink } from '../js/cloud-share.js';

const req = (env, path, method = 'GET', body, token = '', headers = {}) => worker.fetch(new Request(`https://worker.example${path}`, {
  method, headers: { Origin: 'https://app.example', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
}), env);
const create = async (env, password = '', days = 30) => {
  const response = await req(env, '/v1/shares', 'POST', { report: fixture().report, days, password }, testToken);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};

test('short IDs have fixed length; creating and listing require a publisher key', async () => {
  const env = testEnv();
  try {
    assert.equal((await req(env, '/v1/shares')).status, 401);
    assert.equal((await req(env, '/v1/shares', 'POST', { report: fixture().report, days: 30 })).status, 401);
    const a = await create(env), b = await create(env);
    assert.match(a.id, /^[A-Za-z0-9_-]{22}$/); assert.notEqual(a.id, b.id);
    const link = shortShareLink(a.id, 'https://murajun620-crypto.github.io/BB_log/');
    assert.equal(link.length, 75); assert.match(link, /\/reader\/#s\//);
    const list = await (await req(env, '/v1/shares', 'GET', undefined, testToken)).json();
    assert.equal(list.shares.length, 2); assert.equal(JSON.stringify(list).includes('テスト選手'), false);
    assert.equal((await req(env, `/v1/shares/${a.id}`, 'GET')).status, 401);
    assert.equal((await req(env, `/v1/shares/${a.id}`, 'DELETE')).status, 401);
  } finally { env.DB.sqlite.close(); }
});

test('password protection never returns data before verification; management can inspect and delete a snapshot', async () => {
  const env = testEnv();
  try {
    const a = await create(env, 'test-password-123');
    const missing = await req(env, `/v1/shares/${a.id}/open`, 'POST', {});
    assert.equal(missing.status, 401); assert.equal((await missing.json()).code, 'password_required');
    const wrong = await req(env, `/v1/shares/${a.id}/open`, 'POST', { password: 'wrong' });
    assert.equal(wrong.status, 401); assert.equal((await wrong.json()).code, 'wrong_password');
    const ok = await req(env, `/v1/shares/${a.id}/open`, 'POST', { password: 'test-password-123' });
    assert.equal(ok.status, 200); assert.match(ok.headers.get('Cache-Control'), /no-store/);
    assert.equal((await ok.json()).report.team.PTS, 3);
    const stored = env.DB.sqlite.prepare('SELECT * FROM shares WHERE id = ?').get(a.id);
    assert.notEqual(stored.password_hash, 'test-password-123'); assert.equal(stored.report.includes('test-password-123'), false);
    const detail = await req(env, `/v1/shares/${a.id}`, 'GET', undefined, testToken);
    assert.equal(detail.status, 200);
    const detailBody = await detail.json();
    assert.equal(detailBody.report.players[0].name, 'テスト選手');
    assert.equal(JSON.stringify(detailBody).includes('internal-player-id'), false);
    assert.equal((await req(env, `/v1/shares/${a.id}`, 'DELETE', undefined, testToken)).status, 200);
    assert.equal((await req(env, `/v1/shares/${a.id}/open`, 'POST', { password: 'test-password-123' })).status, 404);
    assert.equal((await req(env, `/v1/shares/${a.id}`, 'GET', undefined, testToken)).status, 404);
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM shares WHERE id = ?').get(a.id).count, 0);
  } finally { env.DB.sqlite.close(); }
});

test('unprotected snapshots contain only allowlisted fields and expired links cannot be read', async () => {
  const env = testEnv();
  try {
    const report = fixture().report;
    report.report.tournamentName = '○○カップ';
    report.report.games = [{
      date: report.report.date, format: report.report.format, status: report.report.status, gameCount: 1,
      teamName: report.report.teamName, opponentName: 'TEST AWAY', opponentScore: report.report.opponentScore,
      periods: report.report.periods, team: report.report.team, players: report.report.players,
    }];
    report.report.events = ['private-event']; report.report.players[0].privateId = 'private-id';
    const response = await req(env, '/v1/shares', 'POST', { report, days: 7 }, testToken);
    const a = await response.json();
    const open = await req(env, `/v1/shares/${a.id}/open`, 'POST', {});
    assert.equal(open.status, 200);
    const text = await open.text();
    assert.equal(text.includes('private-'), false); assert.equal(text.includes('internal-player-id'), false);
    assert.equal(JSON.parse(text).report.tournamentName, '○○カップ');
    assert.equal(JSON.parse(text).report.games[0].opponentName, 'TEST AWAY');
    env.DB.sqlite.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(Date.now() - 1, a.id);
    assert.equal((await req(env, `/v1/shares/${a.id}/open`, 'POST', {})).status, 404);
    await worker.scheduled({}, env);
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM shares').get().count, 0);
  } finally { env.DB.sqlite.close(); }
});
test('unlimited shares remain readable and visible in management', async () => {
  const env = testEnv();
  try {
    const share = await create(env, '', null);
    assert.equal(share.expiresAt, null);
    const open = await req(env, `/v1/shares/${share.id}/open`, 'POST', {});
    assert.equal(open.status, 200); assert.equal((await open.json()).expiresAt, null);
    const list = await (await req(env, '/v1/shares', 'GET', undefined, testToken)).json();
    assert.equal(list.shares[0].expiresAt, null);
    await worker.scheduled({}, env);
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM shares').get().count, 1);
  } finally { env.DB.sqlite.close(); }
});

test('malformed data, oversize bodies, unauthorized origins, and short passwords fail closed', async () => {
  const env = testEnv();
  try {
    for (const body of [null, {}, { report: {}, days: 30 }, { report: fixture().report, days: 0 }, { report: fixture().report, days: 30, password: '1234' }]) {
      assert.equal((await req(env, '/v1/shares', 'POST', body, testToken)).status, 400);
    }
    assert.equal((await req(env, '/v1/shares', 'POST', { junk: 'x'.repeat(128 * 1024) }, testToken)).status, 413);
    assert.equal((await req(env, '/v1/shares', 'GET', undefined, testToken, { Origin: 'https://attacker.example' })).status, 403);
    const preflight = await req(env, '/v1/shares', 'OPTIONS');
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
    const a = await create(env);
    assert.equal((await req(env, `/v1/shares/${a.id}`)).status, 401);
    assert.equal((await req({ ...env, PUBLISHER_TOKEN: '' }, '/health')).status, 503);
  } finally { env.DB.sqlite.close(); }
});

test('repeated password attempts are limited per link and client', async () => {
  const env = testEnv();
  try {
    const a = await create(env, 'test-password-123');
    for (let i = 0; i < 10; i++) assert.equal((await req(env, `/v1/shares/${a.id}/open`, 'POST', { password: 'incorrect' })).status, 401);
    const limited = await req(env, `/v1/shares/${a.id}/open`, 'POST', { password: 'test-password-123' });
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '900');
  } finally { env.DB.sqlite.close(); }
});
