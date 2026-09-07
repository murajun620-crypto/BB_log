import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { startTestServer } from './test-server.mjs';
const require = createRequire(import.meta.url);
const playwright = process.env.PLAYWRIGHT_PATH ? require(process.env.PLAYWRIGHT_PATH) : require('playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const browser = await playwright[engine].launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const server = process.env.APP_URL ? null : await startTestServer();
const base = process.env.APP_URL || server.url;
const output = `test-results/${engine}-${Date.now()}`;
await mkdir(output, { recursive: true });
const ready = () => page.waitForFunction(() => !document.body.classList.contains('saving'));
const route = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(80); await ready(); };
const snapshot = () => page.evaluate(async () => (await import('./js/db.js')).readAll());
const score = async () => (await page.locator('.score-numbers b').allTextContents()).map(Number);
const choose = async (stat, number = 4) => {
  await page.locator(`[data-action=stat][data-type="${stat}"]`).click();
  await page.locator('#sheet [data-action=pick-player]').filter({ has: page.locator('strong', { hasText: new RegExp(`^#${number}$`) }) }).click();
  await ready();
};
const dismiss = async () => { if (await page.locator('#sheet').isVisible()) await page.getByRole('button', { name: '閉じる', exact: true }).click(); };
const step = text => console.log(`[${engine}] ${text}`);
try {
  await page.goto(base); await page.getByRole('heading', { name: 'コートサイドから。' }).waitFor();
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active && !!navigator.serviceWorker.controller);
  await page.screenshot({ path: `${output}/home.png`, fullPage: true });
  const cache = await page.evaluate(async () => { const names = await caches.keys(); return (await (await caches.open(names[0])).keys()).map(r => r.url); });
  assert.equal(cache.length, 17); step('app shell and all 17 offline assets cached');
  await route('#team/new');
  await page.locator('[name=name]').fill('TOKYO HOOPS');
  const numbers = ['4', '5', '7', '8', '12', '23', '30']; const names = ['山田', '田中', '鈴木', '佐藤', '高橋', '伊藤', '中村'];
  for (let i = 0; i < 5; i++) { await page.locator('[name=number]').nth(i).fill(numbers[i]); await page.locator('[name=playerName]').nth(i).fill(names[i]); }
  await page.getByRole('button', { name: '選手を追加', exact: true }).click();
  await page.locator('[name=number]').nth(5).fill(numbers[5]); await page.locator('[name=playerName]').nth(5).fill(names[5]);
  await page.getByRole('button', { name: '選手を追加', exact: true }).click();
  await page.locator('[name=number]').nth(6).fill(numbers[6]); await page.locator('[name=playerName]').nth(6).fill(names[6]);
  await page.waitForFunction(() => document.querySelector('.draft-status')?.textContent === '下書き保存済み');
  await page.reload(); assert.equal(await page.locator('[name=name]').inputValue(), 'TOKYO HOOPS'); assert.equal(await page.locator('[name=playerName]').nth(6).inputValue(), '中村');
  await page.getByRole('button', { name: 'チームを保存' }).click(); await page.waitForURL('**/#teams');
  await route('#new'); await page.locator('[name=opponentName]').fill('EAST SIDE');
  await page.waitForFunction(() => document.querySelector('.draft-status')?.textContent === '下書き保存済み');
  await page.reload(); assert.equal(await page.locator('[name=opponentName]').inputValue(), 'EAST SIDE');
  await page.locator('[name=participants]').nth(6).uncheck();
  while (await page.locator('[name=starters]:checked').count()) await page.locator('[name=starters]:checked').first().uncheck();
  await page.getByRole('button', { name: '試合を開始' }).click(); await page.waitForURL('**/#live/*'); await ready();
  const liveHash = new URL(page.url()).hash;
  step('team/game drafts survive reload; team and seven players created without starters');
  await page.getByRole('button', { name: '試合メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'メンバーを追加', exact: true }).click();
  await page.locator('#sheet [data-action=prepare-member]').filter({ hasText: '#30中村' }).click();
  await page.locator('#live-member-form [name=number]').fill('31');
  await page.getByRole('button', { name: 'チームと試合に追加', exact: true }).click(); await ready();
  let added = await snapshot();
  assert.equal(added.games.find(g => g.id === liveHash.split('/')[1]).roster.find(p => p.name === '中村').number, '31');
  assert.equal(added.teams[0].players.find(p => p.name === '中村').number, '31');
  await page.getByRole('button', { name: '試合メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'メンバーを追加', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新しい選手を登録して追加', exact: true }).click();
  await page.locator('#live-member-form [name=number]').fill('44');
  await page.locator('#live-member-form [name=name]').fill('渡辺');
  await page.getByRole('button', { name: 'チームと試合に追加', exact: true }).click(); await ready();
  added = await snapshot();
  assert.equal(added.games.find(g => g.id === liveHash.split('/')[1]).roster.length, 8);
  assert.equal(added.teams[0].players.length, 8);
  step('live member addition updates both team and game; jersey changes keep player identity');
  for (const type of ['2PM', '2PX', '3PM', '3PX', 'FTM', 'FTX', 'OREB', 'DREB', 'AST', 'STL', 'BLK', 'TO', 'PF']) await choose(type);
  assert.deepEqual(await score(), [6, 0]);
  assert.equal((await snapshot()).events.length, 13);
  await page.getByRole('button', { name: /UNDO/ }).click(); await ready();
  await page.getByRole('button', { name: '相手に3点追加' }).click(); await ready();
  await page.getByRole('button', { name: /UNDO/ }).click(); await ready();
  await page.getByRole('button', { name: '相手に2点追加' }).click(); await ready(); assert.deepEqual(await score(), [6, 2]);
  await page.getByRole('button', { name: '選手交代', exact: true }).click();
  await page.getByRole('heading', { name: 'コート上の5人を設定' }).waitFor();
  for (let i = 0; i < 5; i++) await page.locator('#live-lineup-form [name=lineup]').nth(i).check();
  await page.getByRole('button', { name: '5人を設定して交代へ', exact: true }).click(); await ready();
  await page.locator('#sheet [data-action=pick-player]').filter({ hasText: '#4山田' }).click();
  await page.locator('#sheet [data-action=pick-player]').filter({ hasText: '#23伊藤' }).click(); await ready();
  let data = await snapshot(); assert.equal(data.events.sort((a, b) => a.seq - b.seq).at(-1).eventType, 'SUB');
  await page.getByRole('button', { name: /UNDO/ }).click(); await ready();
  step('all 13 stats, automatic score, opponent scoring and substitution UNDO work');
  await page.getByRole('button', { name: 'ピリオド操作', exact: true }).click();
  await page.getByRole('button', { name: /次のピリオドへ/ }).click(); await page.getByRole('button', { name: '移動する', exact: true }).click(); await ready();
  await choose('3PM', 5);
  await page.getByRole('button', { name: 'ピリオド操作', exact: true }).click(); await page.getByRole('button', { name: '＋ OTを追加', exact: true }).click();
  await page.getByRole('button', { name: 'OT1を追加して移動' }).click(); await ready();
  await page.getByRole('button', { name: '相手に3点追加' }).click(); await ready(); assert.deepEqual(await score(), [9, 5]);
  await page.screenshot({ path: `${output}/live.png` });
  for (const [width, height] of [[375, 667], [320, 568], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewWidth: innerWidth, bodyHeight: document.documentElement.scrollHeight, viewHeight: innerHeight, undo: document.querySelector('.live-footer').getBoundingClientRect().bottom, minButton: Math.min(...[...document.querySelectorAll('.stat-button')].map(b => b.getBoundingClientRect().height)) }));
    assert.ok(layout.width <= width, JSON.stringify(layout)); assert.ok(layout.undo <= height + 1, JSON.stringify(layout)); assert.ok(layout.minButton >= 44, JSON.stringify(layout));
  }
  step('period changes/OT and 390, 375, 320px layouts checked; UNDO remains visible');
  // Abort a real IDB write. The score/event count must not show an uncommitted success.
  data = await snapshot(); const beforeFailure = data.events.length;
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (window.failSave && this.name === 'events') throw new DOMException('テスト保存失敗', 'QuotaExceededError'); return put.apply(this, args); }; window.failSave = true; });
  await choose('2PM'); assert.deepEqual(await score(), [9, 5]); assert.equal((await snapshot()).events.length, beforeFailure); assert.ok(await page.locator('.inline-error').isVisible());
  await page.evaluate(() => { window.failSave = false; });
  await page.locator('#sheet [data-action=pick-player]').filter({ hasText: '#4山田' }).click(); await ready(); assert.deepEqual(await score(), [11, 5]);
  step('transaction failure leaves picker open and no phantom stats; retry succeeds');
  // Two clients read the same revision. Only the first writer may commit.
  const second = await context.newPage(); await second.goto(base + liveHash); await second.locator('.stat-grid').waitFor();
  await page.getByRole('button', { name: '相手に1点追加' }).click(); await ready();
  await second.getByRole('button', { name: '相手に3点追加' }).click();
  await second.waitForFunction(() => document.querySelector('#toast').textContent.includes('別の画面'));
  assert.deepEqual((await second.locator('.score-numbers b').allTextContents()).map(Number), [11, 6]); await second.close();
  step('concurrent-tab stale writes rejected without overwriting score');
  await route('#settings'); await page.locator('#continuous').check(); await ready();
  await page.locator('#theme').selectOption('dark'); await ready();
  await page.locator('#line-liff-id').fill('1234567890-AbCdEfgh');
  await page.getByRole('button', { name: 'LINEカード共有を保存', exact: true }).click(); await ready();
  await route(liveHash); await choose('2PM'); await page.getByRole('heading', { name: 'ASTあり？' }).waitFor();
  assert.equal(await page.locator('#sheet [data-action=pick-player]').filter({ hasText: '#4山田' }).count(), 0);
  await page.locator('#sheet [data-action=pick-player]').filter({ hasText: '#5田中' }).click(); await ready();
  await choose('3PX'); await page.getByRole('heading', { name: 'REBあり？' }).waitFor();
  await page.getByRole('button', { name: 'OR', exact: true }).click(); await page.locator('#sheet [data-action=pick-player]').filter({ hasText: '#4山田' }).click(); await ready();
  await page.screenshot({ path: `${output}/dark.png` });
  step('optional AST/REB follow-ups, shooter exclusion and dark mode checked');
  if (engine === 'webkit' && server) {
    // WebKit's Windows automation transport fails navigation before dispatching SW
    // when setOffline is used. Remove the origin instead to test cache-only loading.
    server.setAvailable(false);
  } else await context.setOffline(true);
  await page.reload(); await page.locator('.stat-grid').waitFor();
  assert.deepEqual(await score(), [13, 6]);
  await choose('FTM'); assert.deepEqual(await score(), [14, 6]);
  await page.getByRole('button', { name: '履歴・編集', exact: true }).click(); await page.locator('#sheet .event-row').first().click();
  await page.locator('#event-form [name=eventType]').selectOption('FTX'); await page.getByRole('button', { name: '変更を保存' }).click(); await ready(); assert.deepEqual(await score(), [13, 6]);
  await page.getByRole('link', { name: 'BOX SCORE', exact: true }).click(); await page.locator('.box-table').waitFor();
  assert.equal(await page.locator('.total-row .pts-cell').textContent(), '13');
  await page.evaluate(() => {
    window.sharedShare = null;
    window.sharedFile = null;
    window.lineCard = null;
    window.liffInit = null;
    window.liff = {
      init: async config => { window.liffInit = config; },
      isLoggedIn: () => true,
      isApiAvailable: name => name === 'shareTargetPicker',
      shareTargetPicker: async messages => { window.lineCard = messages; return { status: 'success' }; },
    };
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => ['image/png', 'application/json'].includes(data.files?.[0]?.type) });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { const file = data.files?.[0]; window.sharedShare = { url: data.url || '', message: data.text || '' }; if (file) window.sharedFile = { name: file.name, size: file.size, type: file.type, text: file.type === 'application/json' ? await file.text() : null, message: data.text || '' }; } });
  });
  await page.getByRole('button', { name: '共有', exact: true }).click();
  await page.getByRole('button', { name: 'LINEカードで共有', exact: true }).click();
  await page.waitForFunction(() => window.lineCard?.[0]?.type === 'flex');
  const lineCard = await page.evaluate(() => ({ card: window.lineCard[0], init: window.liffInit }));
  assert.equal(lineCard.init.liffId, '1234567890-AbCdEfgh'); assert.match(lineCard.card.altText, /TOKYO HOOPS 13 - 6 EAST SIDE/); assert.ok(lineCard.card.contents.footer.contents[0].action.uri.includes('#share/v3.'));
  await page.evaluate(() => {
    window.liffLogin = null;
    window.liff = {
      init: async () => {},
      isLoggedIn: () => false,
      login: config => { window.liffLogin = config; },
      isApiAvailable: name => name === 'shareTargetPicker',
    };
  });
  await page.getByRole('button', { name: '共有', exact: true }).click();
  await page.getByRole('button', { name: 'LINEカードで共有', exact: true }).click();
  await page.waitForFunction(() => window.liffLogin?.redirectUri?.includes('#line-share/'));
  const loginRedirect = await page.evaluate(() => window.liffLogin.redirectUri);
  assert.match(loginRedirect, /#line-share\/1234567890-AbCdEfgh\/v3\./);
  await dismiss();
  const externalContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await externalContext.addInitScript(() => {
    window.lineCard = null;
    window.liff = {
      init: async () => {},
      isLoggedIn: () => true,
      isApiAvailable: name => name === 'shareTargetPicker',
      shareTargetPicker: async messages => { window.lineCard = messages; return { status: 'success' }; },
    };
  });
  const externalPage = await externalContext.newPage();
  await externalPage.goto(loginRedirect);
  await externalPage.waitForFunction(() => window.lineCard?.[0]?.type === 'flex');
  assert.match((await externalPage.evaluate(() => window.lineCard[0].altText)), /TOKYO HOOPS 13 - 6 EAST SIDE/);
  await externalPage.getByRole('heading', { name: 'LINEカードを共有しました', exact: true }).waitFor();
  await externalContext.close();
  step('LINE login redirect restores the card from its URL payload in an empty browser context');
  await page.getByRole('button', { name: '共有', exact: true }).click();
  await page.getByRole('button', { name: 'LINEへ共有', exact: true }).click();
  await page.waitForFunction(() => window.sharedShare?.url.includes('#share/v'));
  const sharedLink = await page.evaluate(() => window.sharedShare);
  assert.match(sharedLink.message, /\d{4}\/\d{2}\/\d{2}/); assert.ok(sharedLink.message.includes('TOKYO HOOPS')); assert.ok(sharedLink.message.includes('EAST SIDE')); assert.ok(sharedLink.url.length < 16000);
  const dataBeforeSharedView = await snapshot();
  await route(new URL(sharedLink.url).hash);
  await page.getByRole('heading', { name: '共有レポート', exact: true }).waitFor();
  assert.equal(await page.locator('.total-row .pts-cell').textContent(), '13');
  await page.locator('.box-table button').first().click(); await page.locator('.detail-stats').waitFor(); assert.ok((await page.locator('.sheet-content').textContent()).includes('山田')); await dismiss();
  const dataAfterSharedView = await snapshot(); assert.equal(dataAfterSharedView.games.length, dataBeforeSharedView.games.length); assert.equal(dataAfterSharedView.events.length, dataBeforeSharedView.events.length);
  await route(`#box/${liveHash.split('/')[1]}`);
  await page.evaluate(() => { window.sharedFile = null; });
  await page.getByRole('button', { name: '共有', exact: true }).click();
  await page.getByRole('button', { name: 'ファイルで共有', exact: true }).click();
  await page.waitForFunction(() => window.sharedFile?.type === 'application/json');
  const sharedFile = await page.evaluate(() => window.sharedFile);
  assert.equal(JSON.parse(sharedFile.text).app, 'courtside-report'); assert.ok(sharedFile.message.includes('共有レポートを開く'));
  await route('#settings');
  await page.locator('#shared-report-file').setInputFiles({ name: sharedFile.name, mimeType: sharedFile.type, buffer: Buffer.from(sharedFile.text) }); await ready();
  await page.getByRole('heading', { name: '共有レポート', exact: true }).waitFor();
  assert.equal(await page.locator('.total-row .pts-cell').textContent(), '13');
  await page.screenshot({ path: `${output}/shared-report.png`, fullPage: true });
  await route(`#box/${liveHash.split('/')[1]}`);
  await page.evaluate(() => { window.sharedFile = null; });
  await page.getByRole('button', { name: '共有', exact: true }).click();
  await page.getByRole('button', { name: '画像で共有', exact: true }).click();
  await page.waitForFunction(() => window.sharedFile?.size > 10000);
  assert.equal((await page.evaluate(() => window.sharedFile)).type, 'image/png');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  await page.locator('.box-table button').first().click(); await page.locator('.detail-stats').waitFor();
  const [playerImage] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'この選手を画像で共有', exact: true }).click()]);
  const playerPNG = await readFile(await playerImage.path()); assert.equal(playerPNG.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.ok(playerPNG.length > 10000); await playerImage.saveAs(`${output}/share-player.png`); await dismiss();
  step('private report opens read-only with player details; PNG sharing also works offline');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV', exact: true }).click()]);
  assert.ok((await readFile(await csv.path(), 'utf8')).includes('TEAM TOTAL'));
  await page.getByRole('button', { name: '試合を終了する', exact: true }).click(); await page.getByRole('button', { name: '試合を終了', exact: true }).click(); await ready();
  await page.screenshot({ path: `${output}/box.png`, fullPage: true });
  await route('#new'); await page.locator('[name=opponentName]').fill('OFFLINE TEAM');
  await page.locator('[name=format][value=halves]').check(); await page.locator('[name=minutes]').fill('20');
  await page.getByRole('button', { name: '試合を開始' }).click(); await page.waitForURL('**/#live/*'); await ready();
  assert.ok((await page.locator('.period-row').textContent()).includes('1H'));
  step('offline reload, recording, edit, box score, CSV, finish and new 2H × 20min game pass');
  await route('#settings');
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '全データを書き出す' }).click()]); await ready();
  const backup = await readFile(await json.path()); const original = JSON.parse(backup);
  assert.equal(original.games.length, 2);
  await page.locator('#restore-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"bad"}') }); await ready();
  assert.equal((await snapshot()).games.length, 2);
  await page.locator('#restore-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await page.getByRole('heading', { name: '全データを復元しますか？' }).waitFor();
  await page.getByRole('button', { name: '置き換えて復元' }).click(); await ready();
  const restored = await snapshot(); assert.deepEqual(restored.games, original.games); assert.deepEqual(restored.events, original.events);
  await route('#history'); assert.equal(await page.locator('.game-card').count(), 2);
  await page.reload(); await page.getByRole('heading', { name: '試合履歴', exact: true }).waitFor(); assert.equal(await page.locator('.game-card').count(), 2);
  await page.locator('.history-game-card').filter({ hasText: 'EAST SIDE' }).locator('[data-action=delete-game]').click();
  await page.getByRole('heading', { name: 'この試合を削除しますか？' }).waitFor();
  await page.getByRole('button', { name: '試合を削除', exact: true }).click(); await ready();
  assert.equal(await page.locator('.game-card').count(), 1); assert.equal((await snapshot()).games.length, 1);
  assert.ok((await snapshot()).events.every(event => event.gameId !== original.games.find(g => g.opponentName === 'EAST SIDE').id));
  step('offline JSON export, invalid-file rejection, restore and permanent game-history deletion pass');
  assert.deepEqual(errors, []); step(`no JavaScript or console errors; screenshots: ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  console.error(await page.locator('body').innerText().catch(() => 'Page unavailable'));
  console.error('JavaScript errors:', errors);
  throw error;
} finally { await context.close(); await browser.close(); await server?.close(); }
