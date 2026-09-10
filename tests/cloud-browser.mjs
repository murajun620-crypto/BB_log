import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { startTestServer } from './test-server.mjs';
import { testEnv, testToken, fixture } from './cloud-fixture.mjs';
import worker from '../cloudflare/src/worker.js';
import { createSharePayload } from '../js/shared-report.js';

const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_PATH ? require(process.env.PLAYWRIGHT_PATH) : require('playwright');
const env = testEnv();
let failNetwork = false, uploadCount = 0;
const api = http.createServer(async (req, res) => {
  if (failNetwork) { req.socket.destroy(); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.url === '/v1/shares' && req.method === 'POST') uploadCount++;
  const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${api.address().port}`;
const server = await startTestServer('/BB_log/', { cloudAPI: endpoint });
env.ALLOWED_ORIGINS = new URL(server.url).origin;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
const page = await context.newPage();
const output = `test-results/cloud-${Date.now()}`;
await mkdir(output, { recursive: true });
const errors = [];
context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(server.url);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const f = fixture();
  await page.evaluate(async f => {
    const db = await import('./js/db.js');
    await db.replaceAll({ teams: [f.team], games: [f.game], events: f.events, settings: [] });
  }, f);
  await page.reload();
  await page.evaluate(() => { location.hash = '#settings'; });
  await page.getByRole('button', { name: '共有用管理キーを設定', exact: true }).click();
  await page.locator('[name=key]').fill(testToken);
  await page.getByRole('button', { name: '接続を確認して保存', exact: true }).click();
  await page.getByRole('button', { name: '共有用管理キーを変更', exact: true }).waitFor();
  await page.evaluate(() => {
    window.sharedCloud = null;
    Object.defineProperty(navigator, 'share', { configurable: true, value: async value => { window.sharedCloud = { ...value, active: navigator.userActivation.isActive }; } });
    location.hash = '#box/test-game';
  });
  await page.getByRole('button', { name: '共有', exact: true }).click();
  await page.getByRole('button', { name: 'LINEへ共有', exact: true }).click();
  assert.equal(uploadCount, 0);
  await page.locator('#cloud-create-form [name=password]').fill('test-password-123');
  await page.getByRole('button', { name: 'リンクを作成', exact: true }).click();
  await page.getByRole('heading', { name: '共有リンクができました', exact: true }).waitFor();
  assert.equal(uploadCount, 1);
  await page.screenshot({ path: `${output}/created.png`, fullPage: true });
  await page.getByRole('button', { name: 'LINEへ共有', exact: true }).click();
  await page.waitForFunction(() => !!window.sharedCloud);
  const shared = await page.evaluate(() => window.sharedCloud);
  assert.match(shared.url, /\/reader\/#s\/[A-Za-z0-9_-]{22}$/); assert.equal(shared.active, true);
  assert.equal(JSON.stringify(shared).includes('test-password-123'), false);
  assert.equal(JSON.stringify(shared).includes(testToken), false);
  const reader = await context.newPage();
  await reader.goto(shared.url);
  await reader.getByRole('heading', { name: '閲覧パスワード', exact: true }).waitFor();
  assert.equal(await reader.getByText('テスト選手', { exact: true }).count(), 0);
  await reader.locator('#share-password').fill('wrong-password');
  await reader.getByRole('button', { name: 'BOX SCOREを開く', exact: true }).click();
  await reader.getByRole('alert').filter({ hasText: 'パスワードが違います。' }).waitFor();
  await reader.locator('#share-password').fill('test-password-123');
  await reader.getByRole('button', { name: 'BOX SCOREを開く', exact: true }).click();
  await reader.locator('.report-card').waitFor();
  assert.equal(await reader.locator('.report-score > strong').first().textContent(), '3–0');
  await reader.locator('[data-player-id]').first().click();
  await reader.getByRole('heading', { name: 'テスト選手', exact: true }).waitFor();
  await reader.screenshot({ path: `${output}/reader.png`, fullPage: true });
  const cacheUrls = await reader.evaluate(async () => {
    const names = await caches.keys();
    return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(r => r.url)))).flat();
  });
  assert.equal(cacheUrls.some(url => url.includes('/v1/shares')), false);
  await reader.reload();
  await reader.getByRole('heading', { name: '閲覧パスワード', exact: true }).waitFor();
  console.log('Short link, password gating, native-share gesture and no report cache pass');
  // Another device uses the same publisher key; management does not depend on local game IDs.
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await secondContext.newPage();
  await admin.goto(server.url + '#settings');
  await admin.getByRole('button', { name: '共有用管理キーを設定', exact: true }).click();
  await admin.locator('[name=key]').fill(testToken);
  await admin.getByRole('button', { name: '接続を確認して保存', exact: true }).click();
  await admin.getByRole('button', { name: '共有したリンクを管理', exact: true }).click();
  await admin.getByRole('button', { name: '共有を停止', exact: true }).click();
  await admin.getByRole('button', { name: 'このリンクの共有を停止', exact: true }).click();
  await admin.getByText('有効な共有はありません。', { exact: true }).waitFor();
  await reader.reload(); await reader.getByText(/共有が停止されたか、有効期限が切れています/).waitFor();
  await secondContext.close();
  // Old self-contained links still render on Reader without cloud or a publisher key.
  const legacy = createSharePayload(f.game, f.events);
  await reader.goto(`${server.url}reader/#share/${legacy}`);
  await reader.locator('.report-card').waitFor();
  failNetwork = true;
  await page.getByRole('button', { name: '共有', exact: true }).click();
  await page.getByRole('button', { name: 'LINEへ共有', exact: true }).click();
  await page.evaluate(() => { window.sharedCloud = null; });
  await page.getByRole('button', { name: 'リンクを作成', exact: true }).click();
  await page.locator('#toast').filter({ hasText: '接続できません' }).waitFor();
  assert.equal(await page.evaluate(() => window.sharedCloud), null);
  assert.equal(await page.locator('#cloud-create-form').count(), 1);
  assert.equal(uploadCount, 1);
  console.log('Other-device revocation, old links and network-failure without unsafe fallback pass');
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  console.error(await page.locator('body').innerText()); throw error;
} finally {
  await browser.close(); await server.close();
  api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); env.DB.sqlite.close();
}
