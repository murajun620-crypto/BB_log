import { parseSharePayload } from '../../js/shared-report.js';

const app = document.querySelector('#app');
const playerDialog = document.querySelector('#player-dialog');
let report = null;
let requestNumber = 0;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const percent = (made, attempts) => attempts ? `${(made / attempts * 100).toFixed(1)}%` : '—';
const statLabel = key => ({ OREB: 'OR', DREB: 'DR', PF: 'F' }[key] || key);
const formatDate = date => String(date || '').replaceAll('-', '.');

function shooting(stats) {
  return `<div class="shooting-grid">${[['FG', 'FGM', 'FGA'], ['2P', 'P2M', 'P2A'], ['3P', 'P3M', 'P3A'], ['FT', 'FTM', 'FTA']].map(([label, made, attempts]) => `<div><span>${label}</span><strong>${stats[made]}<small>/${stats[attempts]}</small></strong><b>${percent(stats[made], stats[attempts])}</b></div>`).join('')}</div>`;
}

function statCells(stats) {
  return ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF'].map(key => `<span><small>${statLabel(key)}</small><b>${stats[key]}</b></span>`).join('');
}

function playerCard(player) {
  return `<button class="player-card" type="button" data-player-id="${esc(player.id)}" aria-label="#${esc(player.number)} ${esc(player.name)}の詳細を開く"><span class="player-name"><b>#${esc(player.number)}</b><strong>${esc(player.name)}</strong><small>タップして詳細</small></span><span class="player-stats">${statCells(player.stats)}</span></button>`;
}

function reportView(data) {
  const status = data.status === 'live' ? '記録時点' : 'FINAL';
  return `<main class="reader-shell"><header class="reader-header"><div class="identity"><span class="brand-mark">C</span><div><strong>COURTSIDE</strong><span>READER</span></div></div><span class="read-only">閲覧専用</span></header><section class="intro-line"><span>SHARED BOX SCORE</span><span>${esc(formatDate(data.date))} · ${esc(data.format)}</span></section><section class="score-card"><div class="score-status">${status}</div><div class="team home"><span>HOME</span><h1>${esc(data.teamName)}</h1></div><div class="score"><strong>${data.team.PTS}</strong><span>–</span><strong>${data.opponentScore}</strong></div><div class="team away"><span>OPPONENT</span><h2>${esc(data.opponentName)}</h2></div></section><section class="period-card" aria-label="ピリオドごとの得点"><div class="period-row period-title"><span>PERIOD</span><b>${esc(data.teamName)}</b><b>${esc(data.opponentName)}</b></div>${data.periods.map(period => `<div class="period-row"><span>${esc(period.label)}</span><b>${period.home}</b><b>${period.away}</b></div>`).join('')}</section><section class="section"><div class="section-title"><div><span>TEAM</span><h2>シューティング</h2></div></div>${shooting(data.team)}<div class="rebound-total"><span>OR <b>${data.team.OREB}</b></span><span>DR <b>${data.team.DREB}</b></span><span>REB <b>${data.team.REB}</b></span></div></section><section class="section"><div class="section-title"><div><span>BOX SCORE</span><h2>選手スタッツ</h2></div><p>選手をタップで詳細</p></div><div class="player-list">${data.players.map(playerCard).join('')}<div class="player-card total-card"><span class="player-name"><b>TEAM</b><strong>チーム合計</strong></span><span class="player-stats">${statCells(data.team)}</span></div></div></section><footer class="reader-footer">この画面は共有された試合結果だけを表示しています。チームや試合の記録は保存しません。</footer></main>`;
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

async function render() {
  const sequence = ++requestNumber;
  if (playerDialog.open) playerDialog.close();
  const payload = payloadFromHash();
  report = null;
  if (!payload) {
    app.innerHTML = landingView();
    return;
  }
  app.innerHTML = loadingView();
  try {
    const parsed = await parseSharePayload(payload);
    if (sequence !== requestNumber) return;
    report = parsed;
    app.innerHTML = reportView(parsed);
  } catch (error) {
    if (sequence !== requestNumber) return;
    app.innerHTML = errorView(error?.message || '共有レポートを読み取れませんでした。');
  }
}

function openPlayer(playerId) {
  const player = report?.players.find(item => item.id === playerId);
  if (!player) return;
  playerDialog.innerHTML = `<div class="dialog-handle"></div><button class="dialog-close" type="button" data-close-dialog aria-label="閉じる">×</button><p class="dialog-context">${esc(report.teamName)} vs ${esc(report.opponentName)} · ${esc(formatDate(report.date))}</p><div class="player-detail"><span class="jersey">${esc(player.number)}</span><div><h2 id="player-dialog-title">${esc(player.name)}</h2><p><b>${player.stats.PTS}</b> PTS</p></div></div>${shooting(player.stats)}<div class="detail-stats">${['OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF'].map(key => `<span><small>${statLabel(key)}</small><b>${player.stats[key]}</b></span>`).join('')}</div>`;
  if (typeof playerDialog.showModal === 'function') playerDialog.showModal();
  else playerDialog.setAttribute('open', '');
}

document.addEventListener('click', event => {
  const player = event.target.closest('[data-player-id]');
  if (player) openPlayer(player.dataset.playerId);
  if (event.target.closest('[data-close-dialog]')) playerDialog.close();
});
playerDialog.addEventListener('click', event => {
  if (event.target === playerDialog) playerDialog.close();
});
window.addEventListener('hashchange', render);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
