import { parseSharePayload } from '../../js/shared-report.js';
import { openCloudShare } from '../../js/cloud-share.js';
import { shotChartMapHTML, shotMarkerDetailFeedbackHTML } from '../../js/views.js';

const app = document.querySelector('#app');
const playerDialog = document.querySelector('#player-dialog');
let report = null;
let requestNumber = 0;
let displayMode = 'total';
let selectedGameIndex = null;
let playerDisplay = 'total';
let shotDisplayMode = 'points';
let activeShotMarkerFeedback = null;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const percent = (made, attempts) => attempts ? `${(made / attempts * 100).toFixed(1)}%` : '—';
const statLabel = key => ({ OREB: 'OR', DREB: 'DR', PF: 'F', FD: 'FD' }[key] || key);
const BOX_STATS = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FD'];
const DETAIL_STATS = ['OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FD'];
const formatDate = date => String(date || '').replaceAll('-', '.');

const average = (value, games) => (value / games).toFixed(1);
const metric = (value, games) => displayMode === 'average' && games > 1 ? average(value, games) : value;
const modeText = () => displayMode === 'average' ? '平均' : '合計';
function renderApp(html) {
  app.innerHTML = html;
}
function shooting(stats, games = 1) {
  return `<div class="shooting-grid">${[['FG', 'FGM', 'FGA'], ['2P', 'P2M', 'P2A'], ['3P', 'P3M', 'P3A'], ['FT', 'FTM', 'FTA']].map(([label, made, attempts]) => `<div><span>${label}</span><strong>${stats[made]}<small>/${stats[attempts]}</small></strong><b>${percent(stats[made], stats[attempts])}</b>${games > 1 ? `<em class="shooting-average">平均 ${average(stats[made], games)}/${average(stats[attempts], games)}</em>` : ''}</div>`).join('')}</div>`;
}
function shotChart(shots = [], playerId = null, displayMode = 'points', players = []) {
  const map = shotChartMapHTML(shots, playerId, displayMode, players);
  return map ? `<section class="shot-chart"><div class="section-heading"><h2>ショットチャート</h2><span>成功数/試投数・成功率</span></div>${map}</section>` : '';
}

function statCells(stats, games = 1) {
  return BOX_STATS.map(key => `<span><small>${statLabel(key)}</small><b>${metric(stats[key], games)}</b></span>`).join('');
}

function playerCard(player, games = 1) {
  return `<button class="player-card" type="button" data-player-id="${esc(player.id)}" aria-label="${esc(player.number)} ${esc(player.name)}の詳細を開く"><span class="player-name"><b>${esc(player.number)}</b><strong>${esc(player.name)}</strong><small>${games > 1 ? '合計 / 平均' : 'タップして詳細'}</small></span><span class="player-stats">${statCells(player.stats, games)}</span></button>`;
}

function reportView(data) {
  const detailGames = Array.isArray(data.games) && data.games.length === data.gameCount ? data.games : [];
  const currentGame = selectedGameIndex === null ? null : detailGames[selectedGameIndex];
  const view = currentGame || data;
  const gameCount = currentGame ? 1 : data.gameCount;
  const status = view.status === 'live' ? '記録時点' : 'FINAL';
  const mode = modeText();
  const scoreCard = `<section class="score-card"><div class="score-status">${status}</div><div class="team home"><span>HOME</span><h1>${esc(view.teamName)}</h1></div><div class="score"><strong>${metric(view.team.PTS, gameCount)}</strong><span>–</span><strong>${metric(view.opponentScore, gameCount)}</strong></div><div class="team away"><span>OPPONENT</span><h2>${esc(view.opponentName)}</h2></div>${!currentGame && gameCount > 1 ? `<p class="score-average">${mode === 'average' ? '合計' : '1試合平均'} ${mode === 'average' ? `${view.team.PTS} – ${view.opponentScore}` : `${average(view.team.PTS, gameCount)} – ${average(view.opponentScore, gameCount)}`}</p>` : ''}</section>`;
  const periodCard = `<section class="period-card" aria-label="ピリオドごとの得点"><div class="period-row period-title"><span>PERIOD</span><b>${esc(view.teamName)}</b><b>${esc(view.opponentName)}</b></div>${view.periods.map(period => `<div class="period-row"><span>${esc(period.label)}</span><b>${period.home}</b><b>${period.away}</b></div>`).join('')}</section>`;
  const gameScores = detailGames.length > 1 ? `<section class="section game-score-section"><div class="section-title"><div><span>GAMES</span><h2>各試合のスコア</h2></div>${currentGame ? '<button class="mode-toggle" data-action="select-game" data-game-index="-1">全試合集計</button>' : '<p>タップで各試合を表示</p>'}</div><div class="game-score-list">${detailGames.map((game, index) => `<button class="game-score-card ${index === selectedGameIndex ? 'selected' : ''}" type="button" data-action="select-game" data-game-index="${index}"><span class="game-score-info"><b>${esc(formatDate(game.date))}</b><small>${esc(game.teamName)} vs. ${esc(game.opponentName)}</small></span><strong>${game.team.PTS}<span>–</span>${game.opponentScore}</strong><span class="game-score-arrow">›</span></button>`).join('')}</div></section>` : '';
  const scoreBlock = currentGame ? `${scoreCard}${periodCard}` : detailGames.length > 1 ? gameScores : `${scoreCard}${periodCard}`;
  return `<main class="reader-shell"><header class="reader-header"><div class="identity"><span class="brand-mark">C</span><div><strong>COURTSIDE</strong><span>READER</span></div></div><span class="read-only">閲覧専用</span></header><section class="intro-line"><span>${data.tournamentName ? esc(data.tournamentName) : 'SHARED BOX SCORE'}</span><span>${esc(formatDate(view.date))} · ${esc(view.format)}</span></section>${scoreBlock}<section class="section"><div class="section-title"><div><span>TEAM</span><h2>シューティング</h2></div>${gameCount > 1 ? '<p>成功数/試投数：合計・平均</p>' : ''}</div>${shooting(view.team, gameCount)}<div class="rebound-total"><span>OR <b>${metric(view.team.OREB, gameCount)}</b></span><span>DR <b>${metric(view.team.DREB, gameCount)}</b></span><span>REB <b>${metric(view.team.REB, gameCount)}</b></span></div></section><section class="section"><div class="section-title"><div><span>BOX SCORE</span><h2>選手スタッツ</h2></div>${gameCount > 1 ? `<button class="mode-toggle" data-action="toggle-stat-mode" aria-label="合計と平均を切り替え">合計 / 平均：${mode}</button>` : '<p>選手をタップで詳細</p>'}</div><div class="player-list">${view.players.map(player => playerCard(player, gameCount)).join('')}<div class="player-card total-card"><span class="player-name"><b>TEAM</b><strong>チーム合計</strong></span><span class="player-stats">${statCells(view.team, gameCount)}</span></div></div></section><footer class="reader-footer">この画面は共有された${currentGame ? '試合結果' : data.gameCount > 1 ? `${data.gameCount}試合の集計` : '試合結果'}だけを表示しています。チームや試合の記録は保存しません。</footer></main>`;
}

function readerReportView(data) {
  const detailGames = Array.isArray(data.games) && data.games.length === data.gameCount ? data.games : [];
  const currentGame = selectedGameIndex === null ? null : detailGames[selectedGameIndex];
  const view = currentGame || data;
  const gameCount = currentGame ? 1 : data.gameCount;
  const status = view.status === 'live' ? '記録時点' : 'FINAL';
  const mode = modeText();
  const label = key => ({ OREB: 'OR', DREB: 'DR', PF: 'F' }[key] || key);
  const cell = (stats, key) => `<td${key === 'PTS' ? ' class="pts-cell"' : ''}>${metric(stats[key], gameCount)}</td>`;
  const rows = view.players.map(player => `<tr><th scope="row"><button type="button" data-player-id="${esc(player.id)}" aria-label="${esc(player.number)} ${esc(player.name)}の詳細を開く"><b>${esc(player.number)}</b><span>${esc(player.name)}</span></button></th>${BOX_STATS.map(key => cell(player.stats, key)).join('')}</tr>`).join('');
  const scoreCard = `<section class="report-card"><div class="game-meta"><span>${esc(formatDate(view.date))} · ${esc(view.format)}</span><span class="report-status">${status}</span></div><div class="report-score"><div><span>MY TEAM</span><h2>${esc(view.teamName)}</h2></div><strong>${metric(view.team.PTS, gameCount)}<span>–</span>${metric(view.opponentScore, gameCount)}</strong><div><span>OPPONENT</span><h2>${esc(view.opponentName)}</h2></div></div><div class="period-scores"><div><span>PERIOD</span><b>自チーム</b><b>相手</b></div>${view.periods.map(period => `<div><span>${esc(period.label)}</span><b>${period.home}</b><b>${period.away}</b></div>`).join('')}</div></section>`;
  const gameScores = detailGames.length > 1 ? `<section class="report-card game-list-card"><div class="game-meta"><span>${esc(data.tournamentName || data.teamName)} · 各試合のスコア</span>${currentGame ? '<button class="mode-toggle" type="button" data-action="select-game" data-game-index="-1">全試合集計</button>' : '<span class="report-hint">タップで試合を表示</span>'}</div><div class="aggregate-game-scores">${detailGames.map((game, index) => `<button class="aggregate-game-score ${index === selectedGameIndex ? 'selected' : ''}" type="button" data-action="select-game" data-game-index="${index}" aria-label="${esc(formatDate(game.date))} ${esc(game.opponentName)}の試合を表示"><span class="aggregate-game-info"><b>${esc(formatDate(game.date))}</b><small>${esc(game.teamName)} vs. ${esc(game.opponentName)}</small></span><strong class="game-score">${game.team.PTS}<span>–</span>${game.opponentScore}</strong><span class="game-score-arrow">›</span></button>`).join('')}</div></section>` : '';
  const scoreBlock = detailGames.length > 1 ? `${gameScores}${currentGame ? scoreCard : ''}` : scoreCard;
  return `<main class="reader-shell"><header class="reader-header"><div class="identity"><span class="brand-mark">C</span><div><strong>COURTSIDE</strong><span>READER</span></div></div><span class="read-only">閲覧専用</span></header><section class="intro-line"><span>${data.tournamentName ? esc(data.tournamentName) : 'SHARED BOX SCORE'}</span><span>${esc(formatDate(view.date))} · ${esc(view.format)}</span></section>${scoreBlock}${shotChart(view.shots || [], null, shotDisplayMode, view.players)}<div class="section-heading"><h2>チーム・シューティング</h2>${gameCount > 1 ? '<span class="muted">成功率は合計から計算</span>' : ''}</div><div class="panel">${shooting(view.team, gameCount)}</div><div class="rebound-total"><span>OR <b>${metric(view.team.OREB, gameCount)}</b></span><span>DR <b>${metric(view.team.DREB, gameCount)}</b></span><span>REB <b>${metric(view.team.REB, gameCount)}</b></span></div><div class="section-heading"><h2>選手スタッツ</h2>${gameCount > 1 ? `<button class="mode-toggle" type="button" data-action="toggle-stat-mode" aria-label="合計と平均を切り替え">合計 / 平均：${mode}</button>` : '<span class="muted">選手をタップで詳細</span>'}</div><div class="box-table-wrap"><table class="box-table"><thead><tr><th scope="col">PLAYER</th>${BOX_STATS.map(key => `<th scope="col">${label(key)}</th>`).join('')}</tr></thead><tbody>${rows}<tr class="total-row"><th scope="row">TEAM</th>${BOX_STATS.map(key => cell(view.team, key)).join('')}</tr></tbody></table></div><footer class="reader-footer">この画面は共有された${currentGame ? '試合結果' : data.gameCount > 1 ? `${data.gameCount}試合の集計` : '試合結果'}だけを表示しています。チームや試合の記録は保存しません。</footer></main>`;
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
  clearShotMarkerFeedback();
  const payload = payloadFromHash();
  const short = location.hash.match(/^#s\/([A-Za-z0-9_-]{22})$/);
  report = null;
  if (!payload && !short) {
    renderApp(location.hash ? errorView('共有リンクの形式が不正です。') : landingView());
    return;
  }
  app.innerHTML = loadingView();
  try {
    const parsed = short ? await openCloudShare(short[1], password) : await parseSharePayload(payload);
    if (sequence !== requestNumber) return;
    report = parsed;
    selectedGameIndex = null;
    playerDisplay = displayMode;
    shotDisplayMode = 'points';
    renderApp(readerReportView(parsed));
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
    renderApp(errorView(error?.message || '共有レポートを読み取れませんでした。'));
    app.querySelector('.error-card').insertAdjacentHTML('beforeend', '<button id="retry-share" type="button">再試行</button>');
    document.querySelector('#retry-share').addEventListener('click', () => void render());
  }
}

function clearShotMarkerFeedback() {
  activeShotMarkerFeedback?.feedback?.remove();
  activeShotMarkerFeedback = null;
}
function showShotMarkerFeedback(marker) {
  if (!marker?.dataset.shotMarker) return;
  const values = marker.dataset;
  const x = Number(values.shotX), y = Number(values.shotY), width = Number(values.shotViewWidth), height = Number(values.shotViewHeight);
  if (![x, y, width, height].every(Number.isFinite)) return;
  clearShotMarkerFeedback();
  marker.insertAdjacentHTML('afterend', shotMarkerDetailFeedbackHTML({ player: values.shotPlayer, area: values.shotArea, result: values.shotResult, points: values.shotPoints, x, y, width, height }));
  activeShotMarkerFeedback = { marker, feedback: marker.nextElementSibling };
}
function shotMarkerFromTarget(target) {
  return target?.closest?.('[data-shot-marker]');
}
function shotCourtFromTarget(target) {
  return target?.closest?.('.pro-court, .shot-court-map, .shot-chart-map');
}

function openPlayer(playerId) {
  if (!report) return;
  const detailGames = Array.isArray(report.games) && report.games.length === report.gameCount ? report.games : [];
  const gameIndex = /^\d+$/.test(playerDisplay) ? Number(playerDisplay) : null;
  const selectedGame = gameIndex !== null ? detailGames[gameIndex] : selectedGameIndex === null ? null : detailGames[selectedGameIndex];
  const source = selectedGame || report;
  const player = source.players.find(item => item.id === playerId);
  if (!player) return;
  clearShotMarkerFeedback();
  const selectedCount = selectedGame ? 1 : report.gameCount;
  const playerValue = value => playerDisplay === 'average' && !selectedGame ? average(value, report.gameCount) : value;
  const options = detailGames.length > 1 ? `<div class="detail-mode-row"><span>表示する試合</span><select data-action="select-player-game" data-player-id="${esc(playerId)}" aria-label="選手スタッツの対象試合"><option value="total" ${playerDisplay === 'total' ? 'selected' : ''}>全試合集計</option><option value="average" ${playerDisplay === 'average' ? 'selected' : ''}>1試合平均</option>${detailGames.map((game, index) => `<option value="${index}" ${String(gameIndex) === String(index) ? 'selected' : ''}>${index + 1}試合目：${esc(formatDate(game.date))} vs. ${esc(game.opponentName)}</option>`).join('')}</select></div>` : '';
  const context = selectedGame ? `${selectedGame.teamName} vs ${selectedGame.opponentName} · ${formatDate(selectedGame.date)}` : `${report.teamName} vs ${report.opponentName} · ${report.gameCount > 1 ? '全試合集計' : formatDate(report.date)}`;
  playerDialog.innerHTML = `<div class="dialog-handle"></div><button class="dialog-close" type="button" data-close-dialog aria-label="閉じる">×</button>${options}<p class="dialog-context">${esc(context)}</p><div class="player-detail"><span class="jersey">${esc(player.number)}</span><div><h2 id="player-dialog-title">${esc(player.name)}</h2><p><b>${playerValue(player.stats.PTS)}</b> PTS</p></div></div>${shooting(player.stats, selectedCount)}<div class="detail-stats">${DETAIL_STATS.map(key => `<span><small>${statLabel(key)}</small><b>${playerValue(player.stats[key])}</b></span>`).join('')}</div>${shotChart(source.shots || [], playerId, shotDisplayMode, source.players)}`;
  if (!playerDialog.open && typeof playerDialog.showModal === 'function') playerDialog.showModal();
  else if (!playerDialog.open) playerDialog.setAttribute('open', '');
}

document.addEventListener('selectstart', event => {
  if (shotCourtFromTarget(event.target)) event.preventDefault();
});
document.addEventListener('dragstart', event => {
  if (shotCourtFromTarget(event.target)) event.preventDefault();
});
document.addEventListener('click', event => {
  const marker = shotMarkerFromTarget(event.target);
  if (marker) {
    if (activeShotMarkerFeedback?.marker === marker) clearShotMarkerFeedback();
    else showShotMarkerFeedback(marker);
    return;
  }
  if (activeShotMarkerFeedback && !event.target.closest?.('[data-shot-marker-feedback]')) clearShotMarkerFeedback();
  const toggle = event.target.closest('[data-action]');
  if (toggle?.dataset.action === 'select-player-game') return;
  if (toggle?.dataset.action === 'toggle-shot-display') {
    const root = toggle.closest('[data-shot-display-root]');
    if (!root) return;
    shotDisplayMode = toggle.dataset.mode === 'zones' ? 'zones' : 'points';
    root.dataset.shotDisplayMode = shotDisplayMode;
    root.querySelectorAll('[data-action="toggle-shot-display"]').forEach(button => {
      const active = button.dataset.mode === shotDisplayMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    return;
  }
  if (toggle?.dataset.action === 'toggle-stat-mode') { displayMode = displayMode === 'average' ? 'total' : 'average'; if (report) renderApp(readerReportView(report)); return; }
  if (toggle?.dataset.action === 'select-game') {
    const index = Number(toggle.dataset.gameIndex);
    selectedGameIndex = index < 0 ? null : Number.isInteger(index) ? index : null;
    playerDisplay = selectedGameIndex === null ? displayMode : String(selectedGameIndex);
    if (report) renderApp(readerReportView(report));
    return;
  }
  const player = event.target.closest('[data-player-id]');
  if (player) { playerDisplay = selectedGameIndex === null ? displayMode : String(selectedGameIndex); openPlayer(player.dataset.playerId); }
  if (event.target.closest('[data-close-dialog]')) playerDialog.close();
});
document.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key)) return;
  const marker = shotMarkerFromTarget(event.target);
  if (marker) {
    event.preventDefault();
    if (activeShotMarkerFeedback?.marker === marker) clearShotMarkerFeedback();
    else showShotMarkerFeedback(marker);
  }
});
document.addEventListener('change', event => {
  const select = event.target.closest('[data-action="select-player-game"]');
  if (select) { playerDisplay = select.value; openPlayer(select.dataset.playerId); }
});
playerDialog.addEventListener('click', event => {
  if (event.target === playerDialog) playerDialog.close();
});
window.addEventListener('hashchange', render);
// Recheck stopped/expired links on return; reports and passwords never enter Cache Storage.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && location.hash.startsWith('#s/')) void render(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
