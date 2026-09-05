import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { startTestServer } from './test-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_PATH ? require(process.env.PLAYWRIGHT_PATH) : require('playwright');
const profile = `test-results/persistent-${Date.now()}`;
await mkdir(profile, { recursive: true });
const server = await startTestServer('/BB_log/');
let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 } });
  let page = context.pages()[0];
  await page.goto(server.url); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const seed = await page.evaluate(async () => {
    const db = await import('./js/db.js'); const d = await import('./js/domain.js');
    const team = { id: d.uid(), name: '再起動テスト', revision: 0, players: [{ id: d.uid(), number: '12', name: '保存された選手' }] };
    await db.saveTeam(team);
    const periods = d.makePeriods('custom', 3, 7); const now = new Date().toISOString();
    const game = { id: d.uid(), teamId: team.id, teamName: team.name, opponentName: 'OFFLINE', date: '2026-09-05', format: 'custom', regulationCount: 3, minutes: 7, periods, currentPeriodId: periods[1].id, roster: team.players, starters: [], status: 'live', nextSeq: 1, revision: 0, createdAt: now, updatedAt: now };
    d.validateGame(game, []); await db.createGame(game);
    const event = { id: d.uid(), gameId: game.id, eventType: '3PM', playerId: team.players[0].id, periodId: game.currentPeriodId, points: 3, seq: 1, timestamp: now };
    await db.commitGame({ ...game, nextSeq: 2 }, event);
    return { gameId: game.id, eventId: event.id };
  });
  await context.close(); context = null;
  server.setAvailable(false);
  context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 }, offline: true });
  page = context.pages()[0]; await page.goto(`${server.url}#live/${seed.gameId}`);
  await page.locator('.stat-grid').waitFor();
  assert.deepEqual((await page.locator('.score-numbers b').allTextContents()).map(Number), [3, 0]);
  assert.ok((await page.locator('.period-row').textContent()).includes('P2'));
  await page.getByRole('button', { name: '相手に2点追加' }).click();
  await page.waitForFunction(() => !document.body.classList.contains('saving'));
  assert.deepEqual((await page.locator('.score-numbers b').allTextContents()).map(Number), [3, 2]);
  console.log('PASS: full browser shutdown/restart, persistent IndexedDB, offline startup and /BB_log/ scope');
  server.setAvailable(true); await context.setOffline(false);
  const second = await context.newPage(); await second.goto(`${server.url}#live/${seed.gameId}`); await second.locator('.stat-grid').waitFor();
  const rollback = await page.evaluate(async () => {
    const db = await import('./js/db.js'); const t = await import('./js/transfer.js');
    const before = await db.readAll(); const restore = t.parseBackup(JSON.stringify(t.backupObject(before)));
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) { if (this.name === 'events') throw new DOMException('復元失敗テスト', 'QuotaExceededError'); return add.apply(this, args); };
    let rejected = false;
    try { await db.replaceAll(restore); } catch { rejected = true; }
    finally { IDBObjectStore.prototype.add = add; }
    const after = await db.readAll();
    return { rejected, same: JSON.stringify(before) === JSON.stringify(after) };
  });
  assert.deepEqual(rollback, { rejected: true, same: true });
  await page.evaluate(async () => { const db = await import('./js/db.js'); const t = await import('./js/transfer.js'); await db.replaceAll(t.parseBackup(JSON.stringify(t.backupObject(await db.readAll())))); });
  await second.getByRole('button', { name: '相手に3点追加' }).click();
  await second.waitForFunction(() => document.querySelector('#toast').textContent.includes('別の画面'));
  assert.deepEqual((await second.locator('.score-numbers b').allTextContents()).map(Number), [3, 2]);
  await second.close();
  console.log('PASS: failed full restore rolls back every store; restored epoch blocks stale clients');
  server.setVersion('v-update-test');
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
  assert.ok(page.url().endsWith(`#live/${seed.gameId}`));
  const names = await page.evaluate(() => caches.keys()); assert.equal(names.length, 2);
  await context.close(); context = null;
  context = await chromium.launchPersistentContext(profile, { headless: true });
  page = context.pages()[0]; await page.goto(server.url);
  await page.waitForFunction(async () => { const keys = await caches.keys(); return keys.length === 1 && keys[0].endsWith('v-update-test'); });
  assert.equal((await page.evaluate(async () => (await (await import('./js/db.js')).readAll()).games.length)), 1);
  console.log('PASS: update waits during game, activates after closing clients and removes only old scoped cache');
} finally { await context?.close(); await server.close(); }
