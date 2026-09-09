import { parseSharePayload } from '../../js/shared-report.js';
import { openCloudShare } from '../../js/cloud-share.js';

const app = document.querySelector('#app');
const playerDialog = document.querySelector('#player-dialog');
let report = null;
let requestNumber = 0;
let displayMode = 'total';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const percent = (made, attempts) => attempts ? `${(made / attempts * 100).toFixed(1)}%` : '—';
const statLabel = key => ({ OREB: 'OR', DREB: 'DR', PF: 'F' }[key] || key);
const formatDate = date => String(date || '').replaceAll('-', '.');

const average = (value, games) => (value / games).toFixed(1);
const metric = (value, games) => displayMode === 'average' ? average(value, games) : value;
const modeText = () => displayMode === 'average' ? '平均' : '合計';
function shooting(stats, games = 1) {
  return `<div class="shooting-grid">${[['FG', 'FGM', 'FGA'], ['2P', 'P2M', 'P2A'], ['3P', 'P3M', 'P3A'], ['FT', 'FTM', 'FTA']].map(([label, made, attempts]) => `<div><span>${label}</span><strong>${stats[made]}<small>/${stats[attempts]}</small></strong><b>${percent(stats[made], stats[attempts])}</b>${games > 1 ? `<em class="shooting-average">平均 ${average(stats[made], games)}/${average(stats[attempts], games)}</em>` : ''}</div>`).join('')}</div>`;
}

function statCells(stats, games = 1) {
  return ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF'].map(key => `<span><small>${statLabel(key)}</small><b>${metric(stats[key], games)}</b></span>`).join('');
}

function playerCard(player, games = 1) {
  return `<button class="player-card" type="button" data-player-id="${esc(player.id)}" aria-label="#${esc(player.number)} ${esc(player.name)}の詳細を開く"><span class="player-name"><b>#${esc(player.number)}</b><strong>${esc(player.name)}</strong><small>${games > 1 ? '合計 / 平均' : 'タップして詳細'}</small></span><span class="player-stats">${statCells(player.stats, games)}</span></button>`;
}

function reportView(data) {
  const status = data.status === 'live' ? '記録時点' : 'FINAL';
  const mode = modeText();
  return `<main class="reader-shell"><header class="reader-header"><div class="identity"><span class="brand-mark">C</span><div><strong>COURTSIDE</strong><span>READER</span></div></div><span class="read-only">閲覧専用</span></header><section class="intro-line"><span>SHARED BOX SCORE</span><span>${esc(formatDate(data.date))} · ${esc(data.format)}</span></section><section class="score-card"><div class="score-status">${status}</div><div class="team home"><span>HOME</span><h1>${esc(data.teamName)}</h1></div><div class="score"><strong>${metric(data.team.PTS, data.gameCount)}</strong><span>–</span><strong>${metric(data.opponentScore, data.gameCount)}</strong></div><div class="team away"><span>OPPONENT</span><h2>${esc(data.opponentName)}</h2></div>${data.gameCount > 1 ? `<p class="score-average">${mode === 'average' ? '合計' : '1試合平均'} ${mode === 'average' ? `${data.team.PTS} – ${data.opponentScore}` : `${average(data.team.PTS, data.gameCount)} – ${average(data.opponentScore, data.gameCount)}`}</p>` : ''}</section><section class="period-card" aria-label="ピリオドごとの得点"><div class="period-row period-title"><span>PERIOD</span><b>${esc(data.teamName)}</b><b>${esc(data.opponentName)}</b></div>${data.periods.map(period => `<div class="period-row"><span>${esc(period.label)}</span><b>${period.home}</b><b>${period.away}</b></div>`).join('')}</section><section class="section"><div class="section-title"><div><span>TEAM</span><h2>シューティング</h2></div>${data.gameCount > 1 ? '<p>成功数/試投数：合計・平均</p>' : ''}</div>${shooting(data.team, data.gameCount)}<div class="rebound-total"><span>OR <b>${metric(data.team.OREB, data.gameCount)}</b></span><span>DR <b>${metric(data.team.DREB, data.gameCount)}</b></span><span>REB <b>${metric(data.team.REB, data.gameCount)}</b></span></div></section><section class="section"><div class="section-title"><div><span>BOX SCORE</span><h2>選手スタッツ</h2></div>${data.gameCount > 1 ? `<button class="mode-toggle" data-action="toggle-stat-mode" aria-label="合計と平均を切り替え">合計 / 平均：${mode}</button>` : '<p>選手をタップで詳細</p>'}</div><div class="player-list">${data.players.map(player => playerCard(player, data.gameCount)).join('')}<div class="player-card total-card"><span class="player-name"><b>TEAM</b><strong>チーム合計</strong></span><span class="player-stats">${statCells(data.team, data.gameCount)}</span></div></div></section><footer class="reader-footer">この画面は共有された${data.gameCount > 1 ? `${data.gameCount}試合の集計` : '試合結果'}だけを表示しています。チームや試合の記録は保存しません。</footer></main>`;
}

function landingView() {
  return `<main class="landing"><header class="reader-header"><div class="identity"><span class="brand-mark">C</span><div><strong>COURTSIDE</strong><span>READER</span></div></div><span class="read-only">閲覧専用</span></header><section class="landing-card"><span class="landing-icon">↗</span><p>LINEで届いた</p><h1>共有リンクを開くと<br>BOX SCOREを表示します。</h1><p class="landing-note">チーム登録、試合入力、端末内データの保存は行いません。リンクに含まれる試合結果だけを読み取ります。</p></section><p class="landing-help">共有リンクをSafariで開いた後、必要なら「ホーム画面に追加」でCourtside Readerとして使えます。</p></main>`;
}

function errorView(message) {
  return `<main class="landing"><header class="reader-header"><div class="identity"><span class="brand-mark">C</span><div><strong>COURTSIDE</strong><span>READER</span></div></div><span class="read-only">閲覧専用</span></header><section class="landing-card error-card"><span class="landing-icon">!</span><p>共有レポートを開けません</p><h1>リンクを確認してください。</h1><p class="landing-note">${esc(message)}</p></section><p class="landing-help">LINEのメッセージにある「BOX SCOREを見る」をもう一度タップしてください。</p></main>`;
}

function loadingView() {
  return `<main class="loading"><span class="brand-mark">C</span><strong>COURTSIDE READER</strong><p>共有レポートを読み込み中…</p></main>`;
}

function payloadFromHash() {
  const match = location.hash.match(/^#share\/([^/]+)$/);
  return match ? match[1] : '';
}

function passwordView(message = '') {
  return `<main class="landing"><section class="landing-card"><span class="landing-icon">鍵</span><h1>閲覧パスワード</h1><p class="landing-note">送信者から教えてもらったパスワードを入力してください。パスワードはこの端末に保存しません。</p><form id="unlock-form"><label for="share-password">パスワード</label><input id="share-password" name="password" type="password" autocomplete="off" maxlength="128" required><p role="alert">${esc(message)}</p><button type="submit">BOX SCOREを開く</button></form></section></main>`;
}

async function render(password = '') {
  if (typeof password !== 'string') password = '';
  const sequence = ++requestNumber;
  if (playerDialog.open) playerDialog.close();
  const payload = payloadFromHash();
  const short = location.hash.match(/^#s\/([A-Za-z0-9_-]{22})$/);
  report = null;
  if (!payload && !short) {
    app.innerHTML = location.hash ? errorView('共有リンクの形式が不正です。') : landingView();
    return;
  }
  app.innerHTML = loadingView();
  try {
    const parsed = short ? await openCloudShare(short[1], password) : await parseSharePayload(payload);
    if (sequence !== requestNumber) return;
    report = parsed;
    app.innerHTML = reportView(parsed);
  } catch (error) {
    if (sequence !== requestNumber) return;
    if (['password_required', 'wrong_password'].includes(error.code)) {
      app.innerHTML = passwordView(error.code === 'wrong_password' ? error.message : '');
      document.querySelector('#unlock-form').addEventListener('submit', event => {
        event.preventDefault();
        const input = event.currentTarget.querySelector('input');
        const value = input.value; input.value = '';
        void render(value);
      });
      document.querySelector('#share-password').focus();
      return;
    }
    app.innerHTML = errorView(error?.message || '共有レポートを読み取れませんでした。');
    app.querySelector('.error-card').insertAdjacentHTML('beforeend', '<button id="retry-share" type="button">再試行</button>');
    document.querySelector('#retry-share').addEventListener('click', () => void render());
  }
}

function openPlayer(playerId) {
  const player = report?.players.find(item => item.id === playerId);
  if (!player) return;
  playerDialog.innerHTML = `<div class="dialog-handle"></div><button class="dialog-close" type="button" data-close-dialog aria-label="閉じる">×</button>${report.gameCount > 1 ? `<div class="detail-mode-row"><span>表示</span><button class="mode-toggle" data-action="toggle-player-mode" data-player-id="${esc(playerId)}" aria-label="合計と平均を切り替え">合計 / 平均：${modeText()}</button></div>` : ''}<p class="dialog-context">${esc(report.teamName)} vs ${esc(report.opponentName)} · ${report.gameCount > 1 ? `${report.gameCount}試合合計` : esc(formatDate(report.date))}</p><div class="player-detail"><span class="jersey">${esc(player.number)}</span><div><h2 id="player-dialog-title">${esc(player.name)}</h2><p><b>${metric(player.stats.PTS, report.gameCount)}</b> PTS</p></div></div>${shooting(player.stats, report.gameCount)}<div class="detail-stats">${['OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF'].map(key => `<span><small>${statLabel(key)}</small><b>${metric(player.stats[key], report.gameCount)}</b></span>`).join('')}</div>`;
  if (typeof playerDialog.showModal === 'function') playerDialog.showModal();
  else playerDialog.setAttribute('open', '');
}

document.addEventListener('click', event => {
  const toggle = event.target.closest('[data-action]');
  if (toggle?.dataset.action === 'toggle-stat-mode') { displayMode = displayMode === 'average' ? 'total' : 'average'; if (report) app.innerHTML = reportView(report); return; }
  if (toggle?.dataset.action === 'toggle-player-mode') { displayMode = displayMode === 'average' ? 'total' : 'average'; openPlayer(toggle.dataset.playerId); return; }
  const player = event.target.closest('[data-player-id]');
  if (player) openPlayer(player.dataset.playerId);
  if (event.target.closest('[data-close-dialog]')) playerDialog.close();
});
playerDialog.addEventListener('click', event => {
  if (event.target === playerDialog) playerDialog.close();
});
window.addEventListener('hashchange', render);
// Recheck stopped/expired links on return; reports and passwords never enter Cache Storage.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && location.hash.startsWith('#s/')) void render(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
