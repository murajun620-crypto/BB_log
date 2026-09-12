import * as db from './db.js';
import { uid, localDate, STATS, activeEvents, attackDirectionForPeriod, fullCourtPointFromHalf, isBackcourtPoint, makePeriods, opponentLineup, oppositeDirection, shotPointsFromPoint, shotZoneFromPoint, validateTeam, validateGame, lineup, eventLabel, aggregate, aggregateGames } from './domain.js';
import { backupObject, parseBackup, gameCSV, download, copyText, shareFile, shareUrl } from './transfer.js';
import { boxScoreImage, playerStatsImage, safeFilename, shareImage } from './share-image.js';
import { createSharedReport, createAggregateSharedReport, createCompressedSharePayload, parseSharePayload, parseSharedReport, sharedReportFile } from './shared-report.js';
import * as view from './views.js';
import { cloudShareEnabled } from './cloud-share.js';
import { cloudSettingsHTML, setupCloudShareUI } from './cloud-share-ui.js';

const app = document.querySelector('#app');
const sheet = document.querySelector('#sheet');
const toastNode = document.querySelector('#toast');
const state = { data: { teams: [], games: [], events: [], settings: [] }, preferences: { continuous: false, keepAwake: false, advancedMode: false, theme: 'system' }, pwa: { ready: false, error: '', update: false }, historySelection: new Set(), aggregateMode: 'total', aggregateGameId: null, aggregatePlayerGameId: 'total', shotDisplayMode: 'points', strategyBoard: null, proSelection: null, proSub: null, proOpponentSelection: null, proOpponentSub: null, proShotFeedback: null, page: 'home', gameId: null, busy: false, lastError: '' };
let teamDraft, gameDraft, sharedReport, pending, confirmAction, toastTimer, draftVersion = 0, draftQueue = Promise.resolve(), wakeLock = null, proClockTimer = null, proClockSaving = false, proShotFeedbackTimer = null, activeShotMarkerFeedback = null, resolvedShareHash = '', sharePayloadPromise = null, pwaRegistration = null;
const PRO_FIELD_SHOT_TYPES = new Set(['FGM', 'FGX']);
const PRO_DIRECT_FIELD_SHOT_TYPES = new Set(['2PM', '2PX', '3PM', '3PX']);
const PRO_SHOT_FEEDBACK_DURATION = 3200;
function proShotPointFromEvent(button, event, direction) {
  const rect = button.getBoundingClientRect();
  const clientX = event?.clientX || rect.left + rect.width / 2;
  const clientY = event?.clientY || rect.top + rect.height / 2;
  if (!button.classList.contains('pro-court-half')) {
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }
  const scale = Math.min(rect.width / 500, rect.height / 500) || 1;
  const offsetX = (rect.width - 500 * scale) / 2;
  const offsetY = (rect.height - 500 * scale) / 2;
  const localX = Math.max(0, Math.min(500, (clientX - rect.left - offsetX) / scale));
  const localY = Math.max(0, Math.min(500, (clientY - rect.top - offsetY) / scale));
  return fullCourtPointFromHalf(localX, localY, direction);
}
const getSetting = key => state.data.settings.find(s => s.key === key)?.value;
const game = () => state.data.games.find(g => g.id === state.gameId);
const gameEvents = (g = game()) => state.data.events.filter(e => e.gameId === g?.id);
function showProShotFeedback(event) {
  const zone = shotZoneFromPoint(null, event?.shotX, event?.shotY);
  if (!event?.gameId || !zone) return;
  clearTimeout(proShotFeedbackTimer);
  state.proShotFeedback = { gameId: event.gameId, eventId: event.id, eventType: event.eventType, side: event.side, shotX: event.shotX, shotY: event.shotY, shotZone: zone };
  render();
  const { gameId, eventId } = state.proShotFeedback;
  proShotFeedbackTimer = setTimeout(() => {
    if (state.proShotFeedback?.gameId !== gameId || state.proShotFeedback?.eventId !== eventId) return;
    state.proShotFeedback = null;
    proShotFeedbackTimer = null;
    render();
  }, PRO_SHOT_FEEDBACK_DURATION);
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
  marker.insertAdjacentHTML('afterend', view.shotMarkerDetailFeedbackHTML({ player: values.shotPlayer, area: values.shotArea, result: values.shotResult, points: values.shotPoints, x, y, width, height }));
  activeShotMarkerFeedback = { marker, feedback: marker.nextElementSibling };
}
function shotMarkerFromTarget(target) {
  return target?.closest?.('[data-shot-marker]');
}
function shotCourtFromTarget(target) {
  return target?.closest?.('.pro-court, .shot-court-map, .shot-chart-map');
}
function toast(message, error = false) {
  clearTimeout(toastTimer); toastNode.textContent = message; toastNode.className = `show${error ? ' error' : ''}`;
  toastNode.setAttribute('role', error ? 'alert' : 'status');
  toastTimer = setTimeout(() => { toastNode.className = ''; }, error ? 8000 : 2300);
}
function applyTheme() {
  document.documentElement.dataset.theme = state.preferences.theme;
  const dark = state.preferences.theme === 'dark' || state.preferences.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.querySelector('meta[name="theme-color"]').content = dark ? '#121916' : '#f6f7f9';
}
async function refresh() {
  state.data = await db.readAll();
  state.preferences = { continuous: false, keepAwake: false, advancedMode: false, theme: 'system', ...getSetting('preferences') };
  applyTheme();
}
async function syncWakeLock() {
  const shouldStayAwake = state.preferences.keepAwake && state.page === 'live' && game()?.status === 'live' && document.visibilityState === 'visible';
  if (!shouldStayAwake) {
    if (wakeLock && !wakeLock.released) await wakeLock.release().catch(() => {});
    wakeLock = null;
    return;
  }
  if (!('wakeLock' in navigator) || (wakeLock && !wakeLock.released)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
function currentClockSeconds(g, now = Date.now()) {
  if (!g?.clockEnabled) return null;
  const base = Number.isInteger(g.clockSeconds) ? g.clockSeconds : Math.round(Number(g.minutes) * 60);
  if (!g.clockRunning || !g.clockStartedAt) return Math.max(0, base);
  return Math.max(0, base - Math.floor((now - Date.parse(g.clockStartedAt)) / 1000));
}
function syncProClockTimer() {
  if (proClockTimer) clearInterval(proClockTimer);
  proClockTimer = null;
  const g = game();
  if (state.page !== 'live' || g?.mode !== 'pro' || !g.clockEnabled || !g.clockRunning) return;
  proClockTimer = setInterval(() => {
    const value = currentClockSeconds(game());
    const node = document.querySelector('#pro-clock-value');
    if (node) node.innerHTML = view.digitalText(view.clockText(value));
    if (value <= 0 && !proClockSaving) {
      proClockSaving = true;
      void saveGameChange({ ...game(), clockSeconds: 0, clockRunning: false, clockStartedAt: null }).then(() => toast('ゲームクロックが終了しました。')).catch(reportError).finally(() => { proClockSaving = false; });
    }
  }, 250);
}
function render() {
  const currentHash = location.hash;
  const [requestedPage = 'home', id, ...rest] = currentHash.replace(/^#/, '').split('/');
  if (state.proShotFeedback && (requestedPage !== 'live' || state.proShotFeedback.gameId !== id)) {
    clearTimeout(proShotFeedbackTimer);
    proShotFeedbackTimer = null;
    state.proShotFeedback = null;
  }
  const page = requestedPage === 'share' ? 'shared' : requestedPage;
  if (requestedPage === 'share' && resolvedShareHash !== currentHash) {
    resolvedShareHash = currentHash;
    sharedReport = null;
    app.innerHTML = '<main class="loading"><h1>共有レポート</h1><p>読み込み中…</p></main>';
    void (async () => {
      try {
        sharedReport = await parseSharePayload([id, ...rest].filter(Boolean).join('/'));
        if (location.hash === currentHash) render();
      } catch (error) {
        if (location.hash !== currentHash) return;
        resolvedShareHash = '';
        sharedReport = null;
        location.hash = '#home';
        toast(error.message, true);
      }
    })();
    return;
  }
  if (requestedPage === 'share' && !sharedReport) return;
  state.page = page; state.gameId = ['live', 'box'].includes(page) ? id : null;
  document.body.classList.toggle('in-game', page === 'live' && !!game() && game().status === 'live');
  let html;
  if (page === 'teams') html = view.teamsView(state);
  else if (page === 'team') {
    const saved = state.data.teams.find(t => t.id === id);
    if (id !== 'new' && !saved) { location.hash = '#teams'; return; }
    if (!teamDraft || (teamDraft.id || 'new') !== id) {
      const draft = getSetting('teamDraft');
      teamDraft = draft && (draft.id || 'new') === id ? structuredClone(draft) : saved ? structuredClone(saved) : { id: null, revision: null, name: '', players: Array.from({ length: 5 }, () => ({ id: uid(), number: '', name: '' })) };
    }
    html = view.teamFormView(state, teamDraft);
  } else if (page === 'new') {
    if (!gameDraft) {
      const draft = getSetting('gameDraft');
      const t = state.data.teams.find(t => t.id === draft?.teamId) || state.data.teams[0];
      gameDraft = { date: localDate(), teamId: t?.id, opponentName: '', format: 'quarters', count: 4, minutes: 8, participants: t?.players.map(p => p.id) || [], starters: t?.players.length >= 5 ? t.players.slice(0, 5).map(p => p.id) : [], mode: 'standard', clockEnabled: false, opponentTracking: 'score', opponentRosterNumbersText: '', opponentRosterNamesText: '', ...(draft ? structuredClone(draft) : {}) };
      if (t && gameDraft.teamId !== t.id) selectTeam(t.id);
    }
    html = view.gameFormView(state, gameDraft);
  } else if (page === 'history') html = view.historyView(state);
  else if (page === 'aggregate') {
    const selectedGames = state.data.games.filter(candidate => state.historySelection.has(candidate.id));
    if (selectedGames.length < 2 || new Set(selectedGames.map(candidate => candidate.teamId)).size !== 1) { state.historySelection.clear(); location.hash = '#history'; return; }
    if (state.aggregateGameId && !selectedGames.some(candidate => candidate.id === state.aggregateGameId)) state.aggregateGameId = null;
    html = view.aggregateViewUnified(state, selectedGames, state.data.events);
  }
  else if (page === 'settings') html = view.settingsView(state);
  else if (page === 'shared') {
    if (!sharedReport) { location.hash = '#settings'; return; }
    html = view.sharedReportView(state, sharedReport);
  }
  else if (page === 'live' || page === 'box') {
    const g = game();
    if (!g) { location.hash = '#history'; return; }
    if (page === 'live' && g.status === 'finished') { location.hash = `#box/${g.id}`; return; }
    html = page === 'live' ? g.mode === 'pro' ? view.proLiveView(state, g, gameEvents(g), currentClockSeconds(g)) : view.liveView(state, g, gameEvents(g)) : view.boxView(state, g, gameEvents(g));
  } else { state.page = 'home'; html = view.homeView(state); }
  clearShotMarkerFeedback();
  app.innerHTML = html;
  app.querySelector('.version-note')?.replaceChildren(`COURTSIDE 2.2.28 · BUILT FOR THE SIDELINES`);
  if (page === 'box') app.querySelector('.report-card')?.insertAdjacentHTML('afterend', view.shotChartHTML(gameEvents(game()), null, state.shotDisplayMode, game()?.roster));
  if (page === 'aggregate') {
    const selectedForChart = state.data.games.filter(candidate => state.historySelection.has(candidate.id));
    const chartEvents = state.aggregateGameId ? gameEvents(state.data.games.find(candidate => candidate.id === state.aggregateGameId)) : state.data.events.filter(event => selectedForChart.some(candidate => candidate.id === event.gameId));
    const chartPlayers = state.aggregateGameId ? state.data.games.find(candidate => candidate.id === state.aggregateGameId)?.roster || [] : selectedForChart.flatMap(candidate => candidate.roster);
    [...app.querySelectorAll('.section-heading')].find(element => element.querySelector('h2')?.textContent === 'チーム・シューティング')?.insertAdjacentHTML('beforebegin', view.shotChartHTML(chartEvents, null, state.shotDisplayMode, chartPlayers));
  }
  if (page === 'shared') [...app.querySelectorAll('.section-heading')].find(element => element.querySelector('h2')?.textContent === 'チーム・シューティング')?.insertAdjacentHTML('beforebegin', view.sharedShotChartHTML(sharedReport.shots || [], null, state.shotDisplayMode, sharedReport.players));
  if (page === 'settings') app.querySelector('.settings-panel')?.insertAdjacentHTML('afterend', cloudSettingsHTML());
  if (page === 'settings' && !app.querySelector('#keepAwake')) {
    const continuous = app.querySelector('#continuous');
    if (continuous) {
      const row = document.createElement('label'); row.className = 'setting-row';
      row.innerHTML = `<span><strong>試合中は画面をスリープさせない</strong><small>試合画面を開いている間だけ自動ロックを防ぎます。電池を消費します。</small></span><input type="checkbox" role="switch" id="keepAwake" ${state.preferences.keepAwake ? 'checked' : ''}>`;
      continuous.closest('.setting-row')?.after(row);
    }
    const advanced = document.createElement('label'); advanced.className = 'setting-row';
    advanced.innerHTML = '<span><strong>Advancedモード</strong><small>2P・3Pのシュート位置を記録します。</small></span><input type="checkbox" role="switch" id="advancedMode">';
    advanced.querySelector('input').checked = state.preferences.advancedMode;
    app.querySelector('#continuous')?.closest('.setting-row')?.after(advanced);
  }
  void syncWakeLock();
  if (state.lastError && page === 'live') {
    const status = app.querySelector('.save-state');
    if (status) { status.textContent = '直前の操作は未保存'; status.classList.add('failed'); }
  }
  syncProClockTimer();
}
function closeSheet() { if (sheet.open) sheet.close(); pending = null; confirmAction = null; }
function showSheet(title, html, cls = '') {
  sheet.className = cls;
  sheet.innerHTML = `<div class="sheet-handle"></div><header class="sheet-header"><h2 id="sheet-title">${view.esc(title)}</h2><button type="button" class="icon-button" data-action="close-sheet" aria-label="閉じる">${view.icon('close')}</button></header><div class="sheet-content">${html}</div>`;
  sheet.querySelector('[data-action="close-sheet"]')?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); closeSheet(); });
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
}
function confirm(title, body, label, callback, dangerous = false) {
  pending = null; confirmAction = callback;
  showSheet(title, `<p class="confirm-body">${view.esc(body)}</p><div class="confirm-actions"><button class="button secondary" data-action="close-sheet">キャンセル</button><button class="button ${dangerous ? 'danger-solid' : 'primary'}" data-action="confirm">${view.esc(label)}</button></div>`);
}
async function reportError(error) {
  state.lastError = error.message || '保存できませんでした。';
  if (error instanceof db.ConflictError) { await refresh(); closeSheet(); teamDraft = null; gameDraft = null; render(); }
  const message = error.name === 'QuotaExceededError' ? '保存容量が不足しています。直前の操作は未保存です。JSONを書き出して端末の空き容量を確保してください。' : state.lastError;
  toast(message, true);
  if (sheet.open) {
    sheet.querySelector('.inline-error')?.remove();
    const p = document.createElement('p'); p.className = 'inline-error'; p.setAttribute('role', 'alert'); p.textContent = message;
    sheet.querySelector('.sheet-content').prepend(p);
  }
  const status = app.querySelector('.save-state');
  if (status) { status.textContent = '直前の操作は未保存'; status.classList.add('failed'); }
}
async function busy(work) {
  if (state.busy) return;
  state.busy = true; state.lastError = ''; document.body.classList.add('saving');
  const status = app.querySelector('.save-state'); if (status) status.textContent = '保存中…';
  try { await work(); }
  catch (error) { await reportError(error); }
  finally { state.busy = false; document.body.classList.remove('saving'); }
}
function persistDraft(key, value) {
  const version = ++draftVersion;
  const snapshot = structuredClone(value);
  document.querySelectorAll('.draft-status').forEach(el => { el.textContent = '下書きを保存中…'; });
  draftQueue = draftQueue.catch(() => {}).then(async () => {
    await db.saveSetting(key, snapshot);
    state.data.settings = state.data.settings.filter(s => s.key !== key).concat({ key, value: snapshot });
    if (version === draftVersion) document.querySelectorAll('.draft-status').forEach(el => { el.textContent = '下書き保存済み'; });
  });
  draftQueue.catch(error => {
    document.querySelectorAll('.draft-status').forEach(el => { el.textContent = '下書き保存に失敗'; });
    toast(`下書きを保存できませんでした。${error.message}`, true);
  });
}
function readTeamForm() {
  const form = document.querySelector('#team-form'); if (!form) return;
  teamDraft.name = form.elements.name.value;
  teamDraft.players = [...form.querySelectorAll('.roster-edit-row')].map(row => ({ id: row.dataset.playerId, number: row.querySelector('[name=number]').value, name: row.querySelector('[name=playerName]').value }));
}
function opponentRosterRowsFromForm(form) {
  const numbers = [...form.querySelectorAll('[name="opponentRosterNumber"]')].map(input => input.value);
  const names = [...form.querySelectorAll('[name="opponentRosterName"]')].map(input => input.value);
  return Array.from({ length: Math.max(numbers.length, names.length) }, (_, index) => ({ number: numbers[index] || '', name: names[index] || '' }));
}
function readGameForm() {
  const form = document.querySelector('#game-form'); if (!form) return;
  const d = new FormData(form);
  const rosterEditor = form.querySelector('[data-opponent-roster-editor]');
  const opponentRoster = rosterEditor ? opponentRosterRowsFromForm(form) : null;
  gameDraft = { ...gameDraft, date: d.get('date'), teamId: d.get('teamId'), opponentName: d.get('opponentName'), format: d.get('format'), count: d.get('count') || 4, minutes: d.get('minutes'), mode: d.get('mode') || 'standard', clockEnabled: d.get('clockEnabled') === 'on', opponentTracking: d.get('opponentTracking') || 'score', ...(opponentRoster ? { opponentRosterNumbersText: opponentRoster.map(row => row.number).join('\n'), opponentRosterNamesText: opponentRoster.map(row => row.name).join('\n') } : {}), participants: d.getAll('participants'), starters: d.getAll('starters') };
  if (rosterEditor) delete gameDraft.opponentRosterText;
}
function selectTeam(id) {
  const t = state.data.teams.find(t => t.id === id);
  gameDraft.teamId = id; gameDraft.participants = t.players.map(p => p.id); gameDraft.starters = t.players.length >= 5 ? t.players.slice(0, 5).map(p => p.id) : [];
}
function parseOpponentRoster(value, previousRoster = []) {
  const rows = Array.isArray(value)
    ? value.map(row => ({ number: String(row?.number ?? '').trim(), name: String(row?.name ?? '').trim() }))
    : value && typeof value === 'object' && !Array.isArray(value) && ('numbers' in value || 'names' in value)
      ? (() => {
        const numberLines = String(value.numbers ?? '').replace(/\r/g, '').split('\n');
        const nameLines = String(value.names ?? '').replace(/\r/g, '').split('\n');
        return Array.from({ length: Math.max(numberLines.length, nameLines.length) }, (_, index) => ({ number: numberLines[index]?.trim() || '', name: nameLines[index]?.trim() || '' })).filter(row => row.number || row.name);
      })()
      : String(value ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
        const match = line.match(/^([0-9]{1,3})(?:[ \t]+(.+?))?$/);
        return { number: match?.[1] || '', name: match?.[2]?.trim() || '' };
      });
  const existing = new Map(previousRoster.map(player => [String(player.number), player.id]));
  const numbers = new Set();
  return rows.map((row, index) => {
    if (!/^[0-9]{1,3}$/.test(row.number)) throw new Error(`相手選手${index + 1}の背番号は半角数字1〜3桁で入力してください。名前は任意です。`);
    if (row.name.length > 40) throw new Error(`相手選手${index + 1}の名前は40文字以内で入力してください。`);
    if (numbers.has(row.number)) throw new Error('相手選手の背番号が重複しています。');
    numbers.add(row.number);
    return { id: existing.get(row.number) || uid(), number: row.number, ...(row.name ? { name: row.name } : {}) };
  });
}
function refreshOpponentRosterRowLabels(editor) {
  [...editor.querySelectorAll('[data-opponent-roster-row]')].forEach((row, index) => {
    const labels = row.querySelectorAll('label');
    const numberLabel = labels[0]?.firstElementChild;
    const nameLabel = labels[1]?.firstElementChild;
    if (numberLabel) numberLabel.innerHTML = index === 0 ? '背番号' : '<span class="sr-only">背番号</span>';
    if (nameLabel) nameLabel.innerHTML = index === 0 ? '名前' : '<span class="sr-only">名前</span>';
    row.querySelector('[data-opponent-roster-number]')?.setAttribute('aria-label', `相手選手${index + 1}の背番号`);
    row.querySelector('[name="opponentRosterName"]')?.setAttribute('aria-label', `相手選手${index + 1}の名前（任意）`);
    row.querySelector('[data-action="remove-opponent-roster-player"]')?.setAttribute('aria-label', `相手選手${index + 1}を削除`);
  });
}
function persistGameDraftFromForm(form) {
  if (form?.id !== 'game-form') return;
  readGameForm();
  persistDraft('gameDraft', gameDraft);
}
async function saveGameChange(next, event = null) {
  const events = gameEvents(next).filter(e => e.id !== event?.id).concat(event ? [event] : []);
  validateGame(next, events);
  const saved = await db.commitGame(next, event);
  state.data.games = state.data.games.map(g => g.id === saved.id ? saved : g);
  if (event) state.data.events = state.data.events.filter(e => e.id !== event.id).concat(event);
  render(); return saved;
}
async function record(eventType, playerId = null, extra = {}) {
  const g = game();
  if (!g || g.status !== 'live') throw new Error('記録中の試合で入力してください。');
  const clockSeconds = g.mode === 'pro' && g.clockEnabled ? currentClockSeconds(g) : null;
  const event = { id: uid(), gameId: g.id, periodId: g.currentPeriodId, eventType, playerId, points: STATS[eventType]?.points || 0, timestamp: new Date().toISOString(), seq: g.nextSeq, ...extra, ...(clockSeconds === null ? {} : { clockSeconds }) };
  await saveGameChange({ ...g, nextSeq: g.nextSeq + 1 }, event);
  toast(eventLabel(g, event)); return event;
}
function pickStat(type, options = {}) {
  pending = { kind: 'stat', type, followup: !!options.followup };
  showSheet(options.title || STATS[type].label, view.pickerHTML(game(), gameEvents(), type, options), 'player-sheet');
}
function offerFollowup(event) {
  if (state.page !== 'live' || game()?.id !== event.gameId) return;
  if (!state.preferences.continuous || !['2PM', '3PM', '2PX', '3PX'].includes(event.eventType)) return;
  if (event.eventType.endsWith('M')) {
    pending = { kind: 'stat', type: 'AST', followup: true };
    showSheet('ASTあり？', `<p class="recorded-note">${view.icon('check')}シュートは保存済み</p><button class="button secondary full" data-action="close-sheet">なし・次のプレーへ</button>${view.pickerHTML(game(), gameEvents(), 'AST', { exclude: event.playerId, instruction: 'アシストした選手をタップ' })}`, 'player-sheet');
  } else {
    showSheet('REBあり？', `<p class="recorded-note">${view.icon('check')}シュートは保存済み</p><button class="button secondary full" data-action="close-sheet">なし・次のプレーへ</button><div class="two-columns spaced"><button class="stat-button other" data-action="follow-reb" data-type="OREB">OR</button><button class="stat-button other" data-action="follow-reb" data-type="DREB">DR</button></div>`);
  }
}
function memberForm(player = null) {
  pending = { kind: 'member-form', playerId: player?.id || null };
  showSheet(player ? '登録済み選手を追加' : '新しい選手を追加', `<form id="live-member-form" data-player-id="${view.esc(player?.id || '')}"><p class="help">${player ? '背番号や名前を変更すると、チームの現在の登録にも反映します。' : 'この選手をチームへ登録し、進行中の試合にも追加します。'}過去試合の表示は変更されません。</p><label>背番号<input name="number" data-jersey-number inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" required value="${view.esc(player?.number || '')}" placeholder="例：12"></label><label class="spaced">名前<input name="name" maxlength="40" required value="${view.esc(player?.name || '')}" placeholder="選手名"></label><button class="button primary full spaced" type="submit">チームと試合に追加</button></form>`);
}
function opponentMemberForm() {
  pending = { kind: 'opponent-member-form' };
  showSheet('相手選手を追加', '<form id="live-opponent-member-form"><p class="help">試合中の相手選手一覧に追加します。背番号は半角数字1〜3桁、名前は任意です。</p><label>背番号<input name="number" data-jersey-number inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" required placeholder="例：12"></label><label class="spaced">名前（任意）<input name="name" maxlength="40" placeholder="相手選手名"></label><button class="button primary full spaced" type="submit">相手選手を追加</button></form>', 'player-sheet');
}
function addMemberMenu() {
  const g = game(); const team = state.data.teams.find(t => t.id === g?.teamId);
  if (!g || !team) return;
  const current = new Set(g.roster.map(p => p.id));
  const available = team.players.filter(p => !current.has(p.id));
  const players = available.length ? `<p class="picker-label">登録済み選手</p><div class="player-grid">${available.map(p => `<button class="player-button" data-action="prepare-member" data-id="${p.id}"><strong>${view.esc(p.number)}</strong><span>${view.esc(p.name)}</span></button>`).join('')}</div>` : '<p class="help">試合に未追加の登録済み選手はいません。</p>';
  showSheet('メンバーを追加', `${players}<button class="button primary full spaced" data-action="prepare-member">＋ 新しい選手を登録して追加</button><p class="help">登録済み選手は背番号を確認・変更してから追加できます。</p>`, 'player-sheet');
}
function subStart() {
  const g = game();
  if (g.roster.length < 5) { showSheet('選手交代', '<p class="help">交代管理には5人以上の出場メンバーが必要です。試合メニューの「メンバーを追加」から選手を追加してください。</p>'); return; }
  if (g.starters.length !== 5) {
    const choices = g.roster.map(p => `<label class="member-choice"><input type="checkbox" name="lineup" value="${p.id}" ${g.roster.length === 5 ? 'checked' : ''}><strong>${view.esc(p.number)}</strong><span>${view.esc(p.name)}</span></label>`).join('');
    showSheet('コート上の5人を設定', `<form id="live-lineup-form"><p class="help">現在コートにいる5人を選んでください。これまでのスタッツには影響しません。</p><div class="panel roster-select">${choices}</div><button class="button primary full spaced" type="submit">5人を設定して交代へ</button></form>`);
    return;
  }
  if (g.roster.length <= 5) { toast('交代できるベンチの選手がいません。'); return; }
  pending = { kind: 'sub-out' };
  showSheet('SUB · OUTを選択', view.pickerHTML(g, gameEvents(), null, { only: lineup(g, gameEvents()), instruction: 'コートを出る選手をタップ' }), 'player-sheet');
}
function periodMenu() {
  const g = game(); const index = g.periods.findIndex(p => p.id === g.currentPeriodId);
  showSheet('ピリオド操作', `<p class="help">現在：${view.esc(g.periods[index].label)}。変更しても記録済みイベントのピリオドは変わりません。</p><div class="card-list"><button class="button secondary full" data-action="change-period" data-index="${index - 1}" ${index === 0 ? 'disabled' : ''}>前のピリオドへ${index > 0 ? ` · ${view.esc(g.periods[index - 1].label)}` : ''}</button><button class="button primary full" data-action="change-period" data-index="${index + 1}" ${index === g.periods.length - 1 ? 'disabled' : ''}>次のピリオドへ${index < g.periods.length - 1 ? ` · ${view.esc(g.periods[index + 1].label)}` : ''}</button><button class="button secondary full" data-action="add-ot" ${g.periods.length >= 50 ? 'disabled' : ''}>＋ OTを追加</button></div>`);
}
async function shareStatsImage(playerId = null) {
  const g = game();
  if (!g) throw new Error('試合が見つかりません。');
  const player = playerId ? g.roster.find(candidate => candidate.id === playerId) : null;
  const canvas = player ? playerStatsImage(g, gameEvents(g), player.id) : boxScoreImage(g, gameEvents(g));
  const subject = player ? `${player.number}-${player.name}` : 'box-score';
  const filename = `${safeFilename(`courtside-${g.date}-${subject}`)}.png`;
  const result = await shareImage(canvas, filename, player ? `${player.name}のスタッツ` : `${g.teamName} vs ${g.opponentName}`);
  if (result === 'downloaded') toast('共有画像を保存しました。');
}
function gameShareMessage(g, suffix = 'Courtside ReaderでBOX SCOREを見る') {
  const summary = aggregate(g, gameEvents(g));
  const date = String(g.date || '').replaceAll('-', '/');
  return `${date} ${g.teamName} vs ${g.opponentName}\n${g.teamName} ${summary.team.PTS} - ${summary.opponent} ${g.opponentName}\n${suffix}`;
}
function startShotZone(type, playerId) {
  const player = game()?.roster.find(candidate => candidate.id === playerId);
  pending = { kind: 'advanced-shot', type, playerId };
  showSheet(`${STATS[type].label} · 位置`, view.shotZonePicker(player?.name || '選手', STATS[type]), 'player-sheet');
}
function aggregateShareContext() {
  const games = state.data.games.filter(candidate => state.historySelection.has(candidate.id));
  if (games.length < 2 || new Set(games.map(candidate => candidate.teamId)).size !== 1) throw new Error('同じ自チームの試合を2試合以上選択してください。');
  const summary = aggregateGames(games, state.data.events);
  const getTitle = tournamentName => `${tournamentName ? `${tournamentName} · ` : ''}${summary.teamName} ${games.length}試合合計`;
  const getMessage = tournamentName => `${tournamentName ? `${tournamentName}\n` : ''}${summary.teamName} ${games.length}試合合計\n${summary.teamName} ${summary.team.PTS} - ${summary.opponent} 相手合計\n1試合平均 ${ (summary.team.PTS / games.length).toFixed(1) } - ${ (summary.opponent / games.length).toFixed(1) }\nCourtside Readerで合計スタッツを見る`;
  return {
    aggregate: true,
    snapshot: createAggregateSharedReport(games, state.data.events),
    makeSnapshot: tournamentName => createAggregateSharedReport(games, state.data.events, tournamentName),
    getTitle,
    getMessage,
    description: `${summary.teamName}の${games.length}試合分の合計スタッツ・1試合平均`,
  };
}
function reportLink(payload) {
  // Reader has its own app shell, so a received link never exposes recording controls.
  const link = new URL('./reader/', location.href);
  link.hash = `share/${payload}`;
  return link.href;
}
async function shareGameReport() {
  const g = game();
  if (!g) throw new Error('試合が見つかりません。');
  const data = createSharedReport(g, gameEvents(g));
  const filename = `${safeFilename(`courtside-report-${g.date}-${g.teamName}-vs-${g.opponentName}`)}.json`;
  const file = sharedReportFile(data, filename);
  const message = gameShareMessage(g, 'Courtsideの「設定」→「共有レポートを開く」から閲覧できます。');
  const result = await shareFile(file, `${g.teamName} vs ${g.opponentName}`, message);
  if (result === 'downloaded') toast('閲覧用レポートを保存しました。共有先へ送ってください。');
  if (sheet.open) closeSheet();
}
async function shareGameLink() {
  const g = game();
  if (!g) throw new Error('試合が見つかりません。');
  const prepared = sharePayloadPromise?.gameId === g.id ? sharePayloadPromise.promise : null;
  const payload = await (prepared || createCompressedSharePayload(g, gameEvents(g)));
  sharePayloadPromise = null;
  const link = reportLink(payload);
  if (link.length > 14000) {
    toast('リンクが長いため、閲覧用ファイルで共有します。');
    await shareGameReport();
    return;
  }
  const result = await shareUrl(link, `${g.teamName} vs ${g.opponentName}`, gameShareMessage(g));
  if (result === 'copied') toast('共有リンクをコピーしました。LINEに貼り付けてください。');
  if (result === 'copy-failed') toast('リンクをコピーできませんでした。共有メニューから送ってください。', true);
  if (sheet.open) closeSheet();
}
async function copyGameLink() {
  const g = game();
  if (!g) throw new Error('試合が見つかりません。');
  const prepared = sharePayloadPromise?.gameId === g.id ? sharePayloadPromise.promise : null;
  const payload = await (prepared || createCompressedSharePayload(g, gameEvents(g)));
  sharePayloadPromise = null;
  const link = reportLink(payload);
  if (link.length > 14000) {
    toast('リンクが長すぎるためコピーできません。ファイルで共有してください。', true);
    return;
  }
  if (!(await copyText(link))) {
    toast('リンクをコピーできませんでした。', true);
    return;
  }
  toast('共有リンクをコピーしました。LINEに貼り付けてください。');
  if (sheet.open) closeSheet();
}
const strategyToolHints = { home: '味方を選び、コートをタップして配置（最大5人）。配置済みはドラッグで移動', away: '相手を選び、コートをタップして配置（最大5人）。配置済みはドラッグで移動', ball: '空いている場所をタップしてボールを配置・移動。配置済みはドラッグで移動', line: '始点から終点までドラッグしてラインを描く', arrow: '始点から終点までドラッグして矢印を描く', erase: '消したいユニフォーム・ボール・線をタップ' };
const strategyBoardTools = new Set(Object.keys(strategyToolHints));
function strategyPoint(svg, event) {
  const rect = svg.getBoundingClientRect();
  const scale = Math.min(rect.width / 1000, rect.height / 600) || 1;
  const offsetX = (rect.width - 1000 * scale) / 2;
  const offsetY = (rect.height - 600 * scale) / 2;
  return { x: Math.max(20, Math.min(980, (event.clientX - rect.left - offsetX) / scale)), y: Math.max(20, Math.min(580, (event.clientY - rect.top - offsetY) / scale)) };
}
function strategyDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function strategySegmentDistance(point, start, end) {
  const dx = end.x - start.x; const dy = end.y - start.y;
  if (!dx && !dy) return strategyDistance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return strategyDistance(point, { x: start.x + t * dx, y: start.y + t * dy });
}
function normalizeStrategyBoard(board) {
  const count = { home: 0, away: 0 }; let hasBall = false;
  board.items = (Array.isArray(board.items) ? board.items : []).reduce((items, item) => {
    if (!item || typeof item !== 'object') return items;
    if (item.kind === 'marker' && item.marker === 'player') item = { ...item, kind: 'athlete', team: 'home' };
    if (item.kind === 'marker' && item.marker === 'ball') item = { ...item, kind: 'ball' };
    if (item.kind === 'athlete') {
      const team = item.team === 'away' ? 'away' : 'home';
      if (count[team] >= 5) return items;
      count[team] += 1;
      items.push({ ...item, team, label: item.label || String(count[team]) });
      return items;
    }
    if (item.kind === 'ball') {
      if (hasBall) return items;
      hasBall = true; items.push(item); return items;
    }
    if (item.kind === 'line' || item.kind === 'arrow') items.push(item);
    return items;
  }, []);
  board.tool = board.tool === 'player' ? 'home' : strategyBoardTools.has(board.tool) ? board.tool : 'home';
  board.history = Array.isArray(board.history) ? board.history.slice(-40) : [];
  return board;
}
function rememberStrategyBoard(snapshot = state.strategyBoard?.items) {
  const board = state.strategyBoard;
  if (!board || !snapshot) return;
  const history = Array.isArray(board.history) ? board.history : (board.history = []);
  history.push(structuredClone(snapshot));
  if (history.length > 40) history.shift();
}
function strategyNextUniformNumber(team) {
  const used = new Set(state.strategyBoard.items.filter(item => item.kind === 'athlete' && item.team === team).map(item => String(item.label)));
  return String([1, 2, 3, 4, 5].find(number => !used.has(String(number))) || 5);
}
function refreshStrategyBoard(itemsOnly = false) {
  const items = sheet.querySelector('[data-strategy-board-items]');
  if (items) items.innerHTML = view.strategyBoardItemsHTML(state.strategyBoard);
  const counts = sheet.querySelector('[data-strategy-board-counts]');
  if (counts) counts.innerHTML = view.strategyBoardCountsHTML(state.strategyBoard);
  if (!itemsOnly) sheet.querySelector('[data-strategy-board-draft]')?.replaceChildren();
}
function setupStrategyBoard() {
  const svg = sheet.querySelector('[data-strategy-board]');
  if (!svg) return;
  let draft = null, dragging = null;
  const renderDraft = () => { const node = sheet.querySelector('[data-strategy-board-draft]'); if (node) node.innerHTML = view.strategyBoardDraftHTML(draft); };
  const releasePointer = pointerId => { if (svg.hasPointerCapture?.(pointerId)) svg.releasePointerCapture(pointerId); };
  const setDragPosition = (point, updateElement = true) => {
    if (!dragging) return;
    const { item, startX, startY, originX, originY, element } = dragging;
    item.x = Math.max(20, Math.min(980, originX + point.x - startX));
    item.y = Math.max(20, Math.min(580, originY + point.y - startY));
    if (updateElement) element.setAttribute('transform', `translate(${item.x} ${item.y})`);
  };
  const endDrag = event => {
    if (!dragging || dragging.pointerId !== event.pointerId) return false;
    const move = dragging;
    setDragPosition(strategyPoint(svg, event));
    if (Math.abs(move.item.x - move.originX) > .1 || Math.abs(move.item.y - move.originY) > .1) rememberStrategyBoard(move.before);
    move.element.classList.remove('dragging');
    dragging = null;
    refreshStrategyBoard(true);
    releasePointer(event.pointerId);
    return true;
  };
  const endDraft = event => {
    if (!draft || draft.pointerId !== event.pointerId) return;
    const point = strategyPoint(svg, event); draft.endX = point.x; draft.endY = point.y;
    if (strategyDistance({ x: draft.startX, y: draft.startY }, point) > 12) {
      rememberStrategyBoard();
      state.strategyBoard.items.push({ id: uid(), kind: draft.tool, startX: draft.startX, startY: draft.startY, endX: draft.endX, endY: draft.endY });
    }
    draft = null; renderDraft(); refreshStrategyBoard(true); releasePointer(event.pointerId);
  };
  svg.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = strategyPoint(svg, event); const tool = state.strategyBoard.tool;
    if (['line', 'arrow'].includes(tool)) {
      draft = { tool, pointerId: event.pointerId, startX: point.x, startY: point.y, endX: point.x, endY: point.y };
      svg.setPointerCapture?.(event.pointerId); renderDraft(); event.preventDefault(); return;
    }
    if (tool === 'erase') {
      let nearest = -1; let distance = 42;
      state.strategyBoard.items.forEach((item, index) => {
        const current = item.kind === 'athlete' || item.kind === 'ball' || item.kind === 'marker' ? strategyDistance(point, { x: item.x, y: item.y }) : strategySegmentDistance(point, { x: item.startX, y: item.startY }, { x: item.endX, y: item.endY });
        if (current < distance) { nearest = index; distance = current; }
      });
      if (nearest >= 0) { rememberStrategyBoard(); state.strategyBoard.items.splice(nearest, 1); refreshStrategyBoard(true); }
      return;
    }
    const element = event.target.closest?.('[data-strategy-movable="true"]');
    const item = element && state.strategyBoard.items.find(candidate => candidate.id === element.dataset.strategyItem);
    if (item && (item.kind === 'athlete' || item.kind === 'ball')) {
      dragging = { pointerId: event.pointerId, item, element, startX: point.x, startY: point.y, originX: Number(item.x), originY: Number(item.y), before: structuredClone(state.strategyBoard.items) };
      element.classList.add('dragging'); svg.setPointerCapture?.(event.pointerId); event.preventDefault(); return;
    }
    if (tool === 'home' || tool === 'away') {
      const count = state.strategyBoard.items.filter(item => item.kind === 'athlete' && item.team === tool).length;
      if (count >= 5) return toast(`${tool === 'home' ? '味方' : '相手'}は5人まで配置できます。`);
      rememberStrategyBoard();
      state.strategyBoard.items.push({ id: uid(), kind: 'athlete', team: tool, label: strategyNextUniformNumber(tool), x: point.x, y: point.y });
      refreshStrategyBoard(true); return;
    }
    if (tool === 'ball') {
      const ball = state.strategyBoard.items.find(item => item.kind === 'ball');
      rememberStrategyBoard();
      if (ball) { ball.x = point.x; ball.y = point.y; } else state.strategyBoard.items.push({ id: uid(), kind: 'ball', x: point.x, y: point.y });
      refreshStrategyBoard(true); return;
    }
  });
  svg.addEventListener('pointermove', event => {
    if (dragging?.pointerId === event.pointerId) { setDragPosition(strategyPoint(svg, event)); event.preventDefault(); return; }
    if (!draft || draft.pointerId !== event.pointerId) return;
    const point = strategyPoint(svg, event); draft.endX = point.x; draft.endY = point.y; renderDraft(); event.preventDefault();
  });
  const endInteraction = event => { if (!endDrag(event)) endDraft(event); };
  svg.addEventListener('pointerup', endInteraction);
  svg.addEventListener('pointercancel', endInteraction);
}
function openStrategyBoard() {
  const g = game();
  if (!g || g.status !== 'live') return toast('試合中に作戦ボードを開いてください。', true);
  if (!state.strategyBoard || state.strategyBoard.gameId !== g.id) state.strategyBoard = { gameId: g.id, items: [], history: [], tool: 'home' };
  normalizeStrategyBoard(state.strategyBoard);
  showSheet('作戦ボード', view.strategyBoardHTML(state.strategyBoard), 'strategy-board-sheet');
  setupStrategyBoard();
}
const handlers = {
  ...setupCloudShareUI({ showSheet, closeSheet, toast, refreshView: render, getGame: game, getEvents: gameEvents, getAggregate: aggregateShareContext, message: gameShareMessage }),
  'close-sheet': closeSheet,
  'apply-update': applyPWAUpdate,
  'check-update': checkPWAUpdate,
  confirm: () => busy(async () => { const fn = confirmAction; if (fn) await fn(); }),
  'add-player': () => { readTeamForm(); teamDraft.players.push({ id: uid(), number: '', name: '' }); persistDraft('teamDraft', teamDraft); render(); document.querySelector('.roster-edit-row:last-child input').focus(); },
  'remove-player': button => { readTeamForm(); if (teamDraft.players.length <= 1) return toast('1人以上の選手を登録してください。'); teamDraft.players = teamDraft.players.filter(p => p.id !== button.dataset.id); persistDraft('teamDraft', teamDraft); render(); },
  'add-opponent-roster-player': button => {
    const form = button.closest('form');
    const editor = form?.querySelector('[data-opponent-roster-editor]');
    const template = editor?.querySelector('[data-opponent-roster-row]');
    if (!form || !editor || !template) return;
    const row = template.cloneNode(true);
    row.querySelectorAll('input').forEach(input => { input.value = ''; });
    editor.append(row);
    refreshOpponentRosterRowLabels(editor);
    persistGameDraftFromForm(form);
    row.querySelector('[data-opponent-roster-number]')?.focus();
  },
  'remove-opponent-roster-player': button => {
    const row = button.closest('[data-opponent-roster-row]');
    const editor = row?.closest('[data-opponent-roster-editor]');
    if (!row || !editor) return;
    const rows = editor.querySelectorAll('[data-opponent-roster-row]');
    if (rows.length <= 1) row.querySelectorAll('input').forEach(input => { input.value = ''; });
    else row.remove();
    refreshOpponentRosterRowLabels(editor);
    persistGameDraftFromForm(button.closest('form'));
  },
  'preset-minutes': button => { document.querySelector('[name=minutes]').value = button.dataset.value; readGameForm(); persistDraft('gameDraft', gameDraft); document.querySelectorAll('.preset').forEach(b => b.classList.toggle('active', b === button)); },
  stat: button => pickStat(button.dataset.type),
  'follow-reb': button => pickStat(button.dataset.type, { followup: true }),
  'pro-action': button => {
    if (game()?.mode !== 'pro') return;
    const playerId = state.proSelection?.playerId || null;
    state.proSub = null; state.proOpponentSelection = null; state.proOpponentSub = null; state.proSelection = { type: button.dataset.type, playerId }; render();
  },
  'pro-select-player': button => {
    const g = game(); if (g?.mode !== 'pro') return;
    const id = button.dataset.id; const on = new Set(lineup(g, gameEvents(g)));
    if (state.proSub) {
      if (!state.proSub.outPlayerId) {
        if (!on.has(id)) return toast('交代するコート上の選手を選んでください。', true);
        state.proSub = { outPlayerId: id }; render(); return;
      }
      if (on.has(id)) return toast('コートに入るベンチの選手を選んでください。', true);
      const outPlayerId = state.proSub.outPlayerId;
      return busy(async () => { await record('SUB', null, { outPlayerId, inPlayerId: id }); state.proSub = null; state.proSelection = null; render(); });
    }
    const selection = state.proSelection;
    if (!selection?.type) return toast('先に記録するプレーを選んでください。', true);
    if (PRO_FIELD_SHOT_TYPES.has(selection.type)) { state.proSelection = { ...selection, playerId: id }; render(); return; }
    return busy(async () => { await record(selection.type, id); state.proSelection = null; render(); });
  },
  'pro-shot-point': (button, event) => {
    const g = game(), ownSelection = state.proSelection, opponentSelection = state.proOpponentSelection;
    const isOpponent = g?.opponentTracking === 'player' && !ownSelection?.playerId && opponentSelection?.playerId;
    const selection = isOpponent ? opponentSelection : ownSelection;
    if (isOpponent && button.classList.contains('pro-court-half')) return toast('スマホでは相手のシュート位置を記録できません。', true);
    if (g?.mode !== 'pro' || !selection?.type || !selection.playerId || !PRO_FIELD_SHOT_TYPES.has(selection.type)) return toast('FGの○／×と選手を先に選んでください。FTは選手をタップすると記録されます。', true);
    const attackDirection = attackDirectionForPeriod(g);
    const shotDirection = isOpponent ? oppositeDirection(attackDirection) : attackDirection;
    const point = proShotPointFromEvent(button, event, shotDirection);
    const x = point.x, y = point.y;
    if (isBackcourtPoint(attackDirection, x, isOpponent)) return toast('バックコートは選択できません。', true);
    const points = shotPointsFromPoint(x, y);
    const eventType = `${points}${selection.type.endsWith('M') ? 'PM' : 'PX'}`;
    const zone = shotZoneFromPoint(null, x, y);
    const shotExtra = { ...(zone ? { shotZone: zone } : {}), shotX: x, shotY: y, ...(isOpponent ? { side: 'opponent' } : {}) };
    return busy(async () => { const saved = await record(eventType, selection.playerId, shotExtra); if (isOpponent) state.proOpponentSelection = null; else state.proSelection = null; showProShotFeedback(saved); if (!isOpponent) offerFollowup(saved); });
  },
  'pro-backcourt': () => toast('バックコートは選択できません。', true),
  'pro-sub': () => { if (game()?.mode !== 'pro') return; state.proSelection = null; state.proSub = { outPlayerId: null }; state.proOpponentSelection = null; state.proOpponentSub = null; render(); },
  'toggle-pro-attack': () => busy(async () => {
    const g = game(); if (g?.mode !== 'pro') return;
    const next = { ...g, attackDirection: g.attackDirection === 'left' ? 'right' : 'left' };
    await saveGameChange(next);
    toast(`自チームの攻撃：${attackDirectionForPeriod(next) === 'right' ? '右ゴール' : '左ゴール'}`);
  }),
  'pro-opponent-action': button => {
    if (game()?.mode !== 'pro' || game().opponentTracking !== 'player') return;
    const playerId = state.proOpponentSelection?.playerId || null;
    state.proOpponentSelection = { type: button.dataset.type, playerId }; state.proSelection = null; state.proSub = null; state.proOpponentSub = null; render();
  },
  'pro-opponent-sub': () => {
    const g = game();
    if (g?.mode !== 'pro' || g.opponentTracking !== 'player') return;
    if ((g.opponentRoster || []).length < 5) return toast('相手選手は5人以上入力してください。', true);
    if ((g.opponentRoster || []).length <= 5) return toast('交代できる相手ベンチ選手がいません。', true);
    if (opponentLineup(g, gameEvents(g)).length !== 5) return toast('相手チームのコート上選手を5人に設定してから交代してください。', true);
    state.proOpponentSelection = null; state.proSelection = null; state.proSub = null; state.proOpponentSub = { outPlayerId: null }; render();
  },
  'pro-select-opponent': button => {
    const g = game(), selection = state.proOpponentSelection;
    const on = new Set(opponentLineup(g, gameEvents(g)));
    if (state.proOpponentSub) {
      if (!state.proOpponentSub.outPlayerId) {
        if (!on.has(button.dataset.id)) return toast('交代するコート上の相手選手を選んでください。', true);
        state.proOpponentSub = { outPlayerId: button.dataset.id }; render(); return;
      }
      if (on.has(button.dataset.id)) return toast('コートに入る相手のベンチ選手を選んでください。', true);
      const outPlayerId = state.proOpponentSub.outPlayerId;
      return busy(async () => { await record('SUB', null, { side: 'opponent', outPlayerId, inPlayerId: button.dataset.id }); state.proOpponentSub = null; state.proOpponentSelection = null; render(); });
    }
    if (g?.mode !== 'pro' || g.opponentTracking !== 'player' || !selection?.type) return toast('先に相手のプレーを選んでください。', true);
    if (PRO_DIRECT_FIELD_SHOT_TYPES.has(selection.type)) {
      return busy(async () => { await record(selection.type, button.dataset.id, { side: 'opponent' }); state.proOpponentSelection = null; render(); });
    }
    if (document.querySelector('.pro-court-half') && PRO_FIELD_SHOT_TYPES.has(selection.type)) return toast('スマホでは相手のシュート位置を記録できません。', true);
    if (PRO_FIELD_SHOT_TYPES.has(selection.type)) { state.proOpponentSelection = { ...selection, playerId: button.dataset.id }; render(); return; }
    return busy(async () => { await record(selection.type, button.dataset.id, { side: 'opponent' }); state.proOpponentSelection = null; render(); });
  },
  'pro-clock-edit': () => {
    const g = game(); if (g?.mode !== 'pro' || !g.clockEnabled) return;
    const seconds = Math.max(0, Math.floor(currentClockSeconds(g) ?? 0));
    const minutes = Math.floor(seconds / 60); const remainder = seconds % 60;
    const minuteOptions = Array.from({ length: 601 }, (_, value) => `<option value="${value}" ${value === minutes ? 'selected' : ''}>${String(value).padStart(2, '0')}分</option>`).join('');
    const secondOptions = Array.from({ length: 60 }, (_, value) => `<option value="${value}" ${value === remainder ? 'selected' : ''}>${String(value).padStart(2, '0')}秒</option>`).join('');
    showSheet('ゲームクロックを編集', `<p class="help">分と秒をタップすると、ドラム式の選択画面が開きます。設定後も現在の開始・停止状態を引き継ぎます。</p><form id="pro-clock-form"><div class="clock-drum-grid"><label>分<select name="minutes" required>${minuteOptions}</select></label><label>秒<select name="seconds" required>${secondOptions}</select></label></div><button type="submit" class="button primary full spaced">設定する</button></form>`);
  },
  'pro-clock-toggle': () => busy(async () => {
    const g = game(); if (g?.mode !== 'pro' || !g.clockEnabled) return;
    const seconds = currentClockSeconds(g);
    if (!g.clockRunning && seconds <= 0) return toast('リセットしてから開始してください。', true);
    await saveGameChange({ ...g, clockSeconds: seconds, clockRunning: !g.clockRunning, clockStartedAt: g.clockRunning ? null : new Date().toISOString() });
  }),
  'pro-clock-reset': () => busy(async () => {
    const g = game(); if (g?.mode !== 'pro' || !g.clockEnabled) return;
    const period = g.periods.find(p => p.id === g.currentPeriodId);
    await saveGameChange({ ...g, clockSeconds: Math.round(period.minutes * 60), clockRunning: false, clockStartedAt: null });
  }),
  'pick-player': button => {
    if (!pending) return;
    if (pending.kind === 'sub-out') {
      const out = button.dataset.id; pending = { kind: 'sub-in', out };
      showSheet('SUB · INを選択', view.pickerHTML(game(), gameEvents(), null, { only: game().roster.filter(p => !lineup(game(), gameEvents()).includes(p.id)).map(p => p.id), plain: true, instruction: 'コートに入る選手をタップ' }), 'player-sheet');
    } else if (pending.kind === 'sub-in') {
      const out = pending.out;
      return busy(async () => { await record('SUB', null, { outPlayerId: out, inPlayerId: button.dataset.id }); closeSheet(); });
    } else {
      const selection = { ...pending };
      if (state.preferences.advancedMode && ['2PM', '2PX', '3PM', '3PX'].includes(selection.type)) { startShotZone(selection.type, button.dataset.id); return; }
      return busy(async () => { const event = await record(selection.type, button.dataset.id); closeSheet(); if (!selection.followup) offerFollowup(event); });
    }
  },
  'shot-zone': button => {
    if (pending?.kind !== 'advanced-shot') return;
    const selection = { ...pending };
    return busy(async () => { const event = await record(selection.type, selection.playerId, { shotZone: button.dataset.zone }); closeSheet(); offerFollowup(event); });
  },
  'cancel-shot-zone': closeSheet,
  'prepare-member': button => {
    const g = game(); const team = state.data.teams.find(t => t.id === g?.teamId);
    const player = team?.players.find(p => p.id === button.dataset.id) || null;
    memberForm(player);
  },
  opponent: button => busy(() => record('OPP', null, { points: Number(button.dataset.points) })),
  sub: subStart,
  undo: () => busy(async () => {
    const e = activeEvents(gameEvents()).at(-1); if (!e) return;
    await saveGameChange(game(), { ...e, deletedAt: new Date().toISOString() }); toast(`取消：${eventLabel(game(), e)}`);
  }),
  events: () => showSheet('イベント履歴', view.eventsHTML(game(), gameEvents())),
  'edit-event': button => { const e = gameEvents().find(e => e.id === button.dataset.id && !e.deletedAt); if (e) showSheet('記録を編集', view.editEventHTML(game(), e)); },
  'delete-event': button => {
    const e = gameEvents().find(e => e.id === button.dataset.id);
    confirm('この記録を削除しますか？', eventLabel(game(), e), '削除する', async () => { await saveGameChange(game(), { ...e, deletedAt: new Date().toISOString() }); closeSheet(); toast('記録を削除しました。'); }, true);
  },
  'delete-game': button => {
    const g = state.data.games.find(candidate => candidate.id === button.dataset.id);
    if (!g) return;
    const events = state.data.events.filter(event => event.gameId === g.id).length;
    confirm('この試合を削除しますか？', `${g.date} · ${g.teamName} vs. ${g.opponentName}\nイベントログ${events}件も完全に削除されます。この操作は取り消せません。`, '試合を削除', async () => {
      await db.deleteGame(g);
      state.data.games = state.data.games.filter(candidate => candidate.id !== g.id);
      state.data.events = state.data.events.filter(event => event.gameId !== g.id);
      state.historySelection.delete(g.id);
      closeSheet(); render(); toast('試合履歴を削除しました。');
    }, true);
  },
  'period-menu': periodMenu,
  'change-period': button => {
    const g = game(); const p = g.periods[Number(button.dataset.index)]; if (!p) return;
    confirm(`${p.label}へ移動しますか？`, `これ以降の入力を${p.label}に記録します。`, '移動する', async () => { const clock = g.mode === 'pro' && g.clockEnabled ? { clockSeconds: Math.round(p.minutes * 60), clockRunning: false, clockStartedAt: null } : {}; const next = { ...g, currentPeriodId: p.id, ...clock }; const directionChanged = g.mode === 'pro' && g.format === 'quarters' && attackDirectionForPeriod(g) !== attackDirectionForPeriod(next); await saveGameChange(next); closeSheet(); toast(`${p.label}に移動しました。${directionChanged ? ` 自チームの攻撃を${attackDirectionForPeriod(next) === 'right' ? '右ゴール' : '左ゴール'}へ自動変更しました。` : ''}`); });
  },
  'add-ot': () => {
    const g = game(); const label = `OT${g.periods.filter(p => p.overtime).length + 1}`;
    showSheet(`${label}を追加`, `<form id="ot-form"><p class="help">新しい延長ピリオドを追加し、入力先を切り替えます。</p><label>延長時間（分）<input type="number" name="minutes" value="5" min="1" max="60" step="0.5" required></label><button class="button primary full spaced" type="submit">${label}を追加して移動</button></form>`);
  },
  'add-member': addMemberMenu,
  'add-opponent-player': opponentMemberForm,
  'game-menu': () => showSheet('試合メニュー', `<div class="card-list"><a class="button secondary full" href="#box/${game().id}">BOX SCOREを表示</a><button class="button secondary full" data-action="game-settings">試合設定</button><button class="button secondary full" data-action="add-member">メンバーを追加</button><button class="button secondary full" data-action="period-menu">ピリオド操作</button><button class="button secondary full" data-action="events">イベント履歴・編集</button><button class="button primary full" data-action="finish">試合を終了する</button><a class="button secondary full" href="#home">保存してホームへ</a></div><p class="help">試合中の設定変更も、その場で保存されます。</p>`),
  'game-settings': () => { const g = game(); if (g) showSheet('試合設定', view.liveSettingsHTML(g)); },
  'aggregate-selected': () => {
    const selected = state.data.games.filter(candidate => state.historySelection.has(candidate.id));
    if (selected.length < 2) return toast('2試合以上を選択してください。', true);
    if (new Set(selected.map(candidate => candidate.teamId)).size !== 1) return toast('同じ自チームの試合を選択してください。', true);
    state.aggregateGameId = null; state.aggregatePlayerGameId = state.aggregateMode; location.hash = '#aggregate';
  },
  'back-history': () => { state.aggregateGameId = null; state.aggregatePlayerGameId = state.aggregateMode; location.hash = '#history'; },
  'select-aggregate-game': button => { state.aggregateGameId = button.dataset.id || null; state.aggregatePlayerGameId = state.aggregateGameId || state.aggregateMode; render(); },
  'toggle-aggregate-mode': () => { state.aggregateMode = state.aggregateMode === 'average' ? 'total' : 'average'; state.aggregatePlayerGameId = state.aggregateMode; render(); },
  'aggregate-player-detail': button => {
    const games = state.data.games.filter(candidate => state.historySelection.has(candidate.id));
    const report = aggregateGames(games, state.data.events);
    showSheet('合計スタッツ', view.aggregatePlayerDetailWithGames(report, button.dataset.id, state.aggregateMode, games, state.data.events, state.aggregatePlayerGameId));
  },
  'toggle-aggregate-player-mode': button => {
    state.aggregateMode = state.aggregateMode === 'average' ? 'total' : 'average';
    state.aggregatePlayerGameId = state.aggregateMode;
    const games = state.data.games.filter(candidate => state.historySelection.has(candidate.id));
    const report = aggregateGames(games, state.data.events);
    showSheet('合計スタッツ', view.aggregatePlayerDetailWithGames(report, button.dataset.id, state.aggregateMode, games, state.data.events, state.aggregatePlayerGameId));
  },
  finish: () => confirm('試合を終了しますか？', 'BOX SCOREに結果をまとめます。終了後も履歴の編集や記録の再開ができます。', '試合を終了', async () => { const g = await saveGameChange({ ...game(), status: 'finished' }); closeSheet(); location.hash = `#box/${g.id}`; }),
  reopen: () => confirm('記録を再開しますか？', 'この試合を記録中に戻します。', '再開する', async () => { const g = await saveGameChange({ ...game(), status: 'live' }); closeSheet(); location.hash = `#live/${g.id}`; }),
  'player-detail': button => showSheet('選手スタッツ', `${view.playerDetail(game(), gameEvents(), button.dataset.id)}${view.shotChartHTML(gameEvents(), button.dataset.id, state.shotDisplayMode, game()?.roster)}`),
  'shared-player-detail': button => showSheet('選手スタッツ', `${view.sharedPlayerDetail(sharedReport, button.dataset.id)}${view.sharedShotChartHTML(sharedReport.shots || [], button.dataset.id, state.shotDisplayMode, sharedReport.players)}`),
  'share-options': () => {
    const g = game();
    const events = gameEvents(g);
    sharePayloadPromise = g ? { gameId: g.id, promise: createCompressedSharePayload(g, events) } : null;
    showSheet('スタッツを共有', `<button class="button primary full" data-action="share-link">${view.icon('share')}LINEへ共有</button><p class="help">日付・対戦チーム・スコアを本文に添えて、リンクをLINEなどの共有メニューから送ります。受信者はリンクをタップしてBOX SCOREを開き、選手をタップして詳細も確認できます。</p><button class="button secondary full spaced" data-action="copy-share-link">${view.icon('share')}リンクをコピー</button><p class="help">Readerの共有リンクだけをクリップボードにコピーします。サーバーには保存しません。</p><button class="button secondary full spaced" data-action="share-report">${view.icon('download')}ファイルで共有</button><p class="help">リンクを使わず、閲覧用ファイルを送る方法です。受信者は「設定」から開きます。</p><button class="button secondary full spaced" data-action="share-box-image">${view.icon('download')}画像で共有</button>`);
    if (cloudShareEnabled()) {
      const button = sheet.querySelector('[data-action="share-link"]');
      button.dataset.action = 'cloud-create';
      button.nextElementSibling.textContent = 'リンクを作成してLINEへ送ります。共有データをCloudflareに保存し、有効期限とパスワード（任意）を設定できます。';
      sheet.querySelector('.sheet-content').insertAdjacentHTML('beforeend', '<button class="button secondary full spaced" data-action="share-link">従来の長いリンクで共有</button><p class="help">サーバーに保存しない方式です。パスワード・有効期限・共有停止は使えません。</p>');
    }
  },
  'share-link': () => shareGameLink(),
  'copy-share-link': () => copyGameLink(),
  'share-report': () => shareGameReport(),
  'share-box-image': async () => { await shareStatsImage(); if (sheet.open) closeSheet(); },
  'share-player-image': button => shareStatsImage(button.dataset.id),
  csv: () => { download(gameCSV(game(), gameEvents()), `courtside-${game().date}-${game().id.slice(0, 8)}.csv`, 'text/csv;charset=utf-8'); toast('CSVを書き出しました。'); },
  'export-json': () => busy(async () => { await draftQueue; await refresh(); teamDraft = null; gameDraft = null; download(JSON.stringify(backupObject(state.data), null, 2), `courtside-backup-${localDate()}.json`, 'application/json'); toast('バックアップを書き出しました。'); render(); }),
  persist: async () => { const result = await navigator.storage?.persist?.(); document.querySelector('#persist-status').textContent = result ? 'このブラウザで保存領域の保持が許可されています。JSONバックアップも続けてください。' : '保持の許可はブラウザが判断します。現在も端末内への保存は有効です。JSONバックアップをご利用ください。'; },
};
document.addEventListener('selectstart', event => {
  if (shotCourtFromTarget(event.target)) event.preventDefault();
});
document.addEventListener('dragstart', event => {
  if (shotCourtFromTarget(event.target)) event.preventDefault();
});
document.addEventListener('pointerdown', event => {
  const marker = shotMarkerFromTarget(event.target);
  if (!marker || event.button > 0) return;
  event.preventDefault();
  showShotMarkerFeedback(marker);
  marker.setPointerCapture?.(event.pointerId);
});
document.addEventListener('pointerup', clearShotMarkerFeedback);
document.addEventListener('pointercancel', clearShotMarkerFeedback);
window.addEventListener('blur', clearShotMarkerFeedback);
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || state.busy) return;
  if (button.dataset.action === 'toggle-shot-display') {
    const root = button.closest('[data-shot-display-root]');
    if (!root) return;
    const mode = button.dataset.mode === 'zones' ? 'zones' : 'points';
    state.shotDisplayMode = mode;
    root.dataset.shotDisplayMode = mode;
    root.querySelectorAll('[data-action="toggle-shot-display"]').forEach(toggle => {
      const active = toggle.dataset.mode === mode;
      toggle.classList.toggle('active', active);
      toggle.setAttribute('aria-pressed', String(active));
    });
    return;
  }
  const fn = handlers[button.dataset.action];
  if (fn) Promise.resolve().then(() => fn(button, event)).catch(reportError);
});
document.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key)) return;
  const marker = shotMarkerFromTarget(event.target);
  if (marker) {
    event.preventDefault();
    showShotMarkerFeedback(marker);
    return;
  }
  const zone = event.target.closest?.('[data-action="shot-zone"]');
  if (!zone) return;
  event.preventDefault();
  zone.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
document.addEventListener('keyup', event => {
  if (['Enter', ' '].includes(event.key) && shotMarkerFromTarget(event.target)) clearShotMarkerFeedback();
});
document.addEventListener('input', event => {
  if (event.target.matches?.('[data-jersey-number]')) {
    const sanitized = event.target.value.replace(/[^0-9]/g, '').slice(0, 3);
    if (event.target.value !== sanitized) event.target.value = sanitized;
  }
  if (event.target.closest('#team-form')) { readTeamForm(); persistDraft('teamDraft', teamDraft); }
  if (event.target.closest('#game-form')) { readGameForm(); persistDraft('gameDraft', gameDraft); }
});
document.addEventListener('change', event => {
  const el = event.target;
  if (el.matches('[data-action="select-aggregate-player-game"]')) {
    const games = state.data.games.filter(candidate => state.historySelection.has(candidate.id));
    const report = aggregateGames(games, state.data.events);
    state.aggregatePlayerGameId = el.value;
    showSheet('合計スタッツ', view.aggregatePlayerDetailWithGames(report, el.dataset.id, state.aggregateMode, games, state.data.events, state.aggregatePlayerGameId));
    return;
  }
  if (el.matches('[data-history-select]')) {
    const selected = state.data.games.filter(candidate => state.historySelection.has(candidate.id));
    const target = state.data.games.find(candidate => candidate.id === el.dataset.id);
    if (el.checked) {
      if (selected[0] && selected[0].teamId !== target?.teamId) { el.checked = false; toast('同じ自チームの試合を選択してください。', true); return; }
      state.historySelection.add(el.dataset.id);
    } else state.historySelection.delete(el.dataset.id);
    render();
    return;
  }
  if (el.closest('#game-form')) {
    readGameForm();
    if (el.name === 'teamId') { selectTeam(el.value); render(); }
    if (['format', 'mode', 'opponentTracking'].includes(el.name)) render();
    if (el.name === 'participants' && !el.checked) { const starter = document.querySelector(`[name=starters][value="${el.value}"]`); starter.checked = false; readGameForm(); }
    if (el.name === 'starters' && el.checked) {
      if (gameDraft.starters.length > 5) { el.checked = false; toast('先発は5人までです。'); }
      else document.querySelector(`[name=participants][value="${el.value}"]`).checked = true;
      readGameForm();
    }
    persistDraft('gameDraft', gameDraft);
  }
  if (el.id === 'continuous' || el.id === 'keepAwake' || el.id === 'advancedMode' || el.id === 'theme') busy(async () => {
    const key = el.id === 'continuous' ? 'continuous' : el.id === 'keepAwake' ? 'keepAwake' : el.id === 'advancedMode' ? 'advancedMode' : 'theme';
    const preferences = { ...state.preferences, [key]: key === 'theme' ? el.value : el.checked };
    await db.saveSetting('preferences', preferences); state.preferences = preferences;
    state.data.settings = state.data.settings.filter(s => s.key !== 'preferences').concat({ key: 'preferences', value: preferences });
    applyTheme(); toast('設定を保存しました。'); render();
  });
  if (el.id === 'restore-file') {
    const file = el.files[0]; el.value = ''; if (!file) return;
    busy(async () => {
      if (file.size > 30 * 1024 * 1024) throw new Error('バックアップは30MB以下にしてください。');
      const restored = parseBackup(await file.text());
      confirm('全データを復元しますか？', `${restored.teams.length}チーム・${restored.games.length}試合・${activeEvents(restored.events).length}記録を復元します。現在のデータはすべて置き換わります。必要なバックアップは先に書き出してください。`, '置き換えて復元', async () => {
        await draftQueue; await db.replaceAll(restored); await refresh(); teamDraft = null; gameDraft = null;
        closeSheet(); render(); toast('全データを復元しました。');
      }, true);
    });
  }
  if (el.id === 'shared-report-file') {
    const file = el.files[0]; el.value = ''; if (!file) return;
    busy(async () => {
      if (file.size > 1024 * 1024) throw new Error('共有レポートは1MB以下にしてください。');
      sharedReport = parseSharedReport(await file.text());
      if (sheet.open) closeSheet();
      if (location.hash === '#shared') render(); else location.hash = '#shared';
      toast('共有レポートを開きました。');
    });
  }
});
document.addEventListener('submit', event => {
  event.preventDefault(); if (state.busy) return;
  const form = event.target;
  if (form.id === 'team-form') busy(async () => {
    readTeamForm(); await draftQueue;
    const team = { ...teamDraft, id: teamDraft.id || uid(), name: teamDraft.name.trim(), revision: (teamDraft.revision ?? -1) + 1, players: teamDraft.players.map(p => ({ ...p, number: p.number.trim(), name: p.name.trim() })) };
    validateTeam(team); await db.saveTeam(team, teamDraft.revision);
    await refresh(); teamDraft = null; gameDraft = null; location.hash = '#teams'; toast('チームを保存しました。');
  });
  if (form.id === 'game-form') busy(async () => {
    readGameForm(); await draftQueue;
    const t = state.data.teams.find(t => t.id === gameDraft.teamId);
    const periods = makePeriods(gameDraft.format, gameDraft.count, gameDraft.minutes);
    const now = new Date().toISOString();
    const mode = gameDraft.mode === 'pro' ? 'pro' : 'standard';
    const opponentRoster = mode === 'pro' && gameDraft.opponentTracking === 'player' ? parseOpponentRoster({ numbers: gameDraft.opponentRosterNumbersText, names: gameDraft.opponentRosterNamesText }) : [];
    if (mode === 'pro' && gameDraft.opponentTracking === 'player' && !opponentRoster.length) throw new Error('相手選手を1人以上入力してください。');
    const g = { id: uid(), teamId: t.id, teamName: t.name, opponentName: gameDraft.opponentName.trim(), date: gameDraft.date, format: gameDraft.format, regulationCount: periods.length, minutes: Number(gameDraft.minutes), periods, currentPeriodId: periods[0]?.id, roster: structuredClone(t.players.filter(p => gameDraft.participants.includes(p.id))), starters: gameDraft.starters, mode, ...(mode === 'pro' ? { attackDirection: 'right' } : {}), clockEnabled: mode === 'pro' && !!gameDraft.clockEnabled, clockSeconds: mode === 'pro' && gameDraft.clockEnabled ? Math.round(Number(gameDraft.minutes) * 60) : undefined, clockRunning: false, clockStartedAt: null, opponentTracking: mode === 'pro' ? gameDraft.opponentTracking : 'score', opponentRoster, ...(mode === 'pro' && gameDraft.opponentTracking === 'player' ? { opponentStarters: opponentRoster.slice(0, 5).map(player => player.id) } : {}), status: 'live', nextSeq: 1, revision: 0, createdAt: now, updatedAt: now };
    validateGame(g, []); await db.createGame(g); await refresh(); gameDraft = null; location.hash = `#live/${g.id}`;
  });
  if (form.id === 'live-member-form') busy(async () => {
    const g = game(); const team = state.data.teams.find(t => t.id === g?.teamId);
    if (!g || !team || g.status !== 'live') throw new Error('記録中の試合を開いてください。');
    const values = new FormData(form);
    const player = { id: form.dataset.playerId || uid(), number: String(values.get('number')).trim(), name: String(values.get('name')).trim() };
    if (g.roster.some(candidate => candidate.id === player.id)) throw new Error('この選手はすでに試合へ追加されています。');
    const exists = team.players.some(candidate => candidate.id === player.id);
    const teamPlayers = exists ? team.players.map(candidate => candidate.id === player.id ? player : candidate) : [...team.players, player];
    const previewTeam = { ...team, players: teamPlayers, revision: team.revision + 1 };
    const previewGame = { ...g, roster: [...g.roster, structuredClone(player)], revision: g.revision + 1, updatedAt: new Date().toISOString() };
    validateTeam(previewTeam); validateGame(previewGame, gameEvents(g));
    const saved = await db.addPlayerToTeamAndGame(team, g, player);
    state.data.teams = state.data.teams.map(candidate => candidate.id === saved.team.id ? saved.team : candidate);
    state.data.games = state.data.games.map(candidate => candidate.id === saved.game.id ? saved.game : candidate);
    closeSheet(); render(); toast(`${player.number} ${player.name}をチームと試合に追加しました。`);
  });
  if (form.id === 'live-opponent-member-form') busy(async () => {
    const g = game();
    if (!g || g.status !== 'live' || g.mode !== 'pro' || g.opponentTracking !== 'player') throw new Error('Proの相手選手記録中に追加してください。');
    const values = new FormData(form);
    const player = parseOpponentRoster([{ number: values.get('number'), name: values.get('name') }], g.opponentRoster || [])[0];
    if ((g.opponentRoster || []).some(candidate => candidate.number === player.number)) throw new Error('相手選手の背番号が重複しています。');
    const opponentRoster = [...(g.opponentRoster || []), player];
    const initialStarters = Array.isArray(g.opponentStarters) && g.opponentStarters.length
      ? [...g.opponentStarters]
      : (g.opponentRoster || []).slice(0, 5).map(candidate => candidate.id);
    const hasOpponentSubstitutions = activeEvents(gameEvents(g)).some(event => event.side === 'opponent' && event.eventType === 'SUB');
    const opponentStarters = hasOpponentSubstitutions ? initialStarters : [...initialStarters, player.id].slice(0, 5);
    await saveGameChange({ ...g, opponentRoster, opponentStarters });
    closeSheet(); toast(`相手 ${player.number}${player.name ? ` ${player.name}` : ''}を追加しました。`);
  });
  if (form.id === 'live-lineup-form') busy(async () => {
    const selected = new FormData(form).getAll('lineup');
    if (selected.length !== 5) throw new Error('コート上の選手を5人選択してください。');
    await saveGameChange({ ...game(), starters: selected });
    closeSheet(); toast('コート上の5人を設定しました。'); subStart();
  });
  if (form.id === 'live-settings-form') busy(async () => {
    const g = game(); if (!g || g.status !== 'live') throw new Error('記録中の試合を開いてください。');
    const values = new FormData(form);
    const mode = values.get('mode') === 'pro' ? 'pro' : 'standard';
    const opponentTracking = values.get('opponentTracking') === 'player' ? 'player' : 'score';
    const opponentPlayerEvents = activeEvents(gameEvents(g)).filter(event => event.side === 'opponent');
    if ((mode !== 'pro' || opponentTracking !== 'player') && opponentPlayerEvents.length) throw new Error('相手選手の個人記録があるため、標準モード／総得点のみに変更できません。先に履歴から該当記録を削除してください。');
    const opponentRoster = mode === 'pro' && opponentTracking === 'player' ? parseOpponentRoster(opponentRosterRowsFromForm(form), g.opponentRoster || []) : [];
    const previousOpponentPlayers = new Map((g.opponentRoster || []).map(player => [player.id, player]));
    const previousInitialIds = Array.isArray(g.opponentStarters) && g.opponentStarters.length ? g.opponentStarters : (g.opponentRoster || []).slice(0, 5).map(player => player.id);
    const previousInitialNumbers = new Set(previousInitialIds.map(id => previousOpponentPlayers.get(id)?.number).filter(Boolean));
    const opponentStarters = opponentRoster.filter(player => previousInitialNumbers.has(player.number)).slice(0, 5).map(player => player.id);
    const hasOpponentSubstitutions = activeEvents(gameEvents(g)).some(event => event.side === 'opponent' && event.eventType === 'SUB');
    if (!hasOpponentSubstitutions && opponentStarters.length < 5) {
      const selectedStarters = new Set(opponentStarters);
      opponentRoster.forEach(player => { if (opponentStarters.length < 5 && !selectedStarters.has(player.id)) { selectedStarters.add(player.id); opponentStarters.push(player.id); } });
    }
    const clockEnabled = mode === 'pro' && values.get('clockEnabled') === 'on';
    const currentSeconds = currentClockSeconds(g);
    const period = g.periods.find(candidate => candidate.id === g.currentPeriodId);
    const clockSeconds = clockEnabled ? Math.max(0, Math.round(currentSeconds ?? Number(period?.minutes || g.minutes) * 60)) : undefined;
    const clockRunning = clockEnabled && g.clockRunning && clockSeconds > 0;
    await saveGameChange({ ...g, mode, clockEnabled, clockSeconds, clockRunning, clockStartedAt: clockRunning ? g.clockStartedAt : null, opponentTracking: mode === 'pro' ? opponentTracking : 'score', opponentRoster, opponentStarters: mode === 'pro' && opponentTracking === 'player' ? (opponentStarters.length ? opponentStarters : opponentRoster.slice(0, 5).map(player => player.id)) : [] });
    closeSheet(); toast('試合設定を保存しました。');
  });
  if (form.id === 'event-form') busy(async () => {
    const values = new FormData(form); const old = gameEvents().find(e => e.id === form.dataset.id);
    const e = { ...old, periodId: values.get('periodId'), updatedAt: new Date().toISOString() };
    if (old.eventType === 'OPP') e.points = Number(values.get('points'));
    else if (old.eventType !== 'SUB') {
      e.eventType = values.get('eventType'); e.playerId = values.get('playerId'); e.points = STATS[e.eventType].points;
      if (['2PM', '2PX', '3PM', '3PX'].includes(e.eventType)) {
        const zone = values.get('shotZone');
        if (zone) e.shotZone = zone; else delete e.shotZone;
      } else delete e.shotZone;
    }
    await saveGameChange(game(), e); closeSheet(); toast('記録を修正しました。');
  });
  if (form.id === 'ot-form') busy(async () => {
    const g = game(); const p = { id: uid(), label: `OT${g.periods.filter(p => p.overtime).length + 1}`, minutes: Number(new FormData(form).get('minutes')), overtime: true };
    await saveGameChange({ ...g, periods: [...g.periods, p], currentPeriodId: p.id }); closeSheet(); toast(`${p.label}を追加しました。`);
  });
  if (form.id === 'pro-clock-form') busy(async () => {
    const g = game(); if (g?.mode !== 'pro' || !g.clockEnabled) throw new Error('Proのゲームクロックを開いてください。');
    const values = new FormData(form); const minutes = Number(values.get('minutes')); const seconds = Number(values.get('seconds'));
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 600 || !Number.isInteger(seconds) || seconds < 0 || seconds > 59) throw new Error('分は0〜600、秒は0〜59の整数で入力してください。');
    const total = minutes * 60 + seconds; const running = g.clockRunning && total > 0;
    await saveGameChange({ ...g, clockSeconds: total, clockRunning: running, clockStartedAt: running ? new Date().toISOString() : null });
    closeSheet(); toast('ゲームクロックを変更しました。');
  });
});
sheet.addEventListener('cancel', event => { event.preventDefault(); if (!state.busy) closeSheet(); });
sheet.addEventListener('click', event => { if (event.target === sheet && !state.busy) { const r = sheet.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeSheet(); } });
window.addEventListener('hashchange', () => { resolvedShareHash = ''; closeSheet(); state.lastError = ''; render(); window.scrollTo(0, 0); });
document.addEventListener('visibilitychange', () => { void syncWakeLock(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
function renderStatus() {
  if (['home', 'settings', 'history', 'teams'].includes(state.page)) render();
  else document.querySelectorAll('.connection').forEach(el => {
    el.classList.toggle('ready', state.pwa.ready);
    el.innerHTML = `<i></i>${state.pwa.ready ? (navigator.onLine ? 'オフライン利用OK' : 'オフライン') : state.pwa.error ? 'キャッシュ未完了' : 'オフライン準備中'}`;
  });
}
window.addEventListener('online', renderStatus); window.addEventListener('offline', renderStatus);
async function applyPWAUpdate() {
  const registration = pwaRegistration || await navigator.serviceWorker.getRegistration();
  const waiting = registration?.waiting;
  if (!waiting) { state.pwa.update = false; renderStatus(); toast('利用中のアプリは最新版です。'); return; }
  const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  waiting.postMessage({ type: 'SKIP_WAITING' });
  await changed;
  location.reload();
}
async function checkPWAUpdate() {
  const registration = pwaRegistration || await navigator.serviceWorker.getRegistration();
  if (!registration) { toast('更新を確認できませんでした。', true); return; }
  await registration.update();
  const installing = registration.installing;
  if (installing) await new Promise(resolve => {
    if (['installed', 'redundant'].includes(installing.state)) { resolve(); return; }
    installing.addEventListener('statechange', () => { if (['installed', 'redundant'].includes(installing.state)) resolve(); }, { once: false });
  });
  state.pwa.update = !!registration.waiting;
  renderStatus();
  if (!state.pwa.update) toast('最新版です。');
}
async function initPWA() {
  if (!('serviceWorker' in navigator)) { state.pwa.error = 'このブラウザではオフライン起動に対応していません。HTTPSのSafariなどで開いてください。'; renderStatus(); return; }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    pwaRegistration = registration;
    const updateStatus = () => { state.pwa.update = !!registration.waiting; renderStatus(); };
    const watchInstall = () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'redundant' && !registration.active) {
          state.pwa.error = 'オフライン準備に失敗しました。通信を確認して再読み込みしてください。';
        }
        updateStatus();
      });
    };
    watchInstall(); registration.addEventListener('updatefound', watchInstall);
    await navigator.serviceWorker.ready;
    state.pwa.ready = true; updateStatus();
  } catch { state.pwa.error = 'キャッシュに失敗しました。HTTPSまたはlocalhostで開き、通信を確認して再読み込みしてください。'; renderStatus(); }
}
try { await refresh(); render(); initPWA(); }
catch (error) { app.innerHTML = `<main class="fatal-error"><h1>記録を開けませんでした</h1><p>${view.esc(error.message)}</p><p>ブラウザの保存設定を確認して、再度お試しください。</p><button class="button primary" onclick="location.reload()">再読み込み</button></main>`; }
