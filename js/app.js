import * as db from './db.js';
import { uid, localDate, STATS, activeEvents, makePeriods, validateTeam, validateGame, lineup, eventLabel, aggregate } from './domain.js';
import { backupObject, parseBackup, gameCSV, download, shareFile, shareUrl } from './transfer.js';
import { boxScoreImage, playerStatsImage, safeFilename, shareImage } from './share-image.js';
import { createSharedReport, createCompressedSharePayload, parseSharePayload, parseSharedReport, sharedReportFile } from './shared-report.js';
import * as view from './views.js';

const app = document.querySelector('#app');
const sheet = document.querySelector('#sheet');
const toastNode = document.querySelector('#toast');
const state = { data: { teams: [], games: [], events: [], settings: [] }, preferences: { continuous: false, keepAwake: false, theme: 'system' }, pwa: { ready: false, error: '', update: false }, page: 'home', gameId: null, busy: false, lastError: '' };
let teamDraft, gameDraft, sharedReport, pending, confirmAction, toastTimer, draftVersion = 0, draftQueue = Promise.resolve(), wakeLock = null, resolvedShareHash = '', sharePayloadPromise = null;
const getSetting = key => state.data.settings.find(s => s.key === key)?.value;
const game = () => state.data.games.find(g => g.id === state.gameId);
const gameEvents = (g = game()) => state.data.events.filter(e => e.gameId === g?.id);
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
  state.preferences = { continuous: false, keepAwake: false, theme: 'system', ...getSetting('preferences') };
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
function render() {
  const currentHash = location.hash;
  const [requestedPage = 'home', id, ...rest] = currentHash.replace(/^#/, '').split('/');
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
      gameDraft = draft ? structuredClone(draft) : { date: localDate(), teamId: t?.id, opponentName: '', format: 'quarters', count: 4, minutes: 8, participants: t?.players.map(p => p.id) || [], starters: t?.players.length >= 5 ? t.players.slice(0, 5).map(p => p.id) : [] };
      if (t && gameDraft.teamId !== t.id) selectTeam(t.id);
    }
    html = view.gameFormView(state, gameDraft);
  } else if (page === 'history') html = view.historyView(state);
  else if (page === 'settings') html = view.settingsView(state);
  else if (page === 'shared') {
    if (!sharedReport) { location.hash = '#settings'; return; }
    html = view.sharedReportView(state, sharedReport);
  }
  else if (page === 'live' || page === 'box') {
    const g = game();
    if (!g) { location.hash = '#history'; return; }
    if (page === 'live' && g.status === 'finished') { location.hash = `#box/${g.id}`; return; }
    html = page === 'live' ? view.liveView(state, g, gameEvents(g)) : view.boxView(state, g, gameEvents(g));
  } else { state.page = 'home'; html = view.homeView(state); }
  app.innerHTML = html;
  if (page === 'settings' && !app.querySelector('#keepAwake')) {
    const continuous = app.querySelector('#continuous');
    if (continuous) {
      const row = document.createElement('label'); row.className = 'setting-row';
      row.innerHTML = `<span><strong>試合中は画面をスリープさせない</strong><small>試合画面を開いている間だけ自動ロックを防ぎます。電池を消費します。</small></span><input type="checkbox" role="switch" id="keepAwake" ${state.preferences.keepAwake ? 'checked' : ''}>`;
      continuous.closest('.setting-row')?.after(row);
    }
  }
  void syncWakeLock();
  if (state.lastError && page === 'live') {
    const status = app.querySelector('.save-state');
    if (status) { status.textContent = '直前の操作は未保存'; status.classList.add('failed'); }
  }
}
function closeSheet() { sheet.close(); pending = null; confirmAction = null; }
function showSheet(title, html, cls = '') {
  sheet.className = cls;
  sheet.innerHTML = `<div class="sheet-handle"></div><header class="sheet-header"><h2 id="sheet-title">${view.esc(title)}</h2><button class="icon-button" data-action="close-sheet" aria-label="閉じる">${view.icon('close')}</button></header><div class="sheet-content">${html}</div>`;
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
function readGameForm() {
  const form = document.querySelector('#game-form'); if (!form) return;
  const d = new FormData(form);
  gameDraft = { date: d.get('date'), teamId: d.get('teamId'), opponentName: d.get('opponentName'), format: d.get('format'), count: d.get('count') || 4, minutes: d.get('minutes'), participants: d.getAll('participants'), starters: d.getAll('starters') };
}
function selectTeam(id) {
  const t = state.data.teams.find(t => t.id === id);
  gameDraft.teamId = id; gameDraft.participants = t.players.map(p => p.id); gameDraft.starters = t.players.length >= 5 ? t.players.slice(0, 5).map(p => p.id) : [];
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
  const event = { id: uid(), gameId: g.id, periodId: g.currentPeriodId, eventType, playerId, points: STATS[eventType]?.points || 0, timestamp: new Date().toISOString(), seq: g.nextSeq, ...extra };
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
  showSheet(player ? '登録済み選手を追加' : '新しい選手を追加', `<form id="live-member-form" data-player-id="${view.esc(player?.id || '')}"><p class="help">${player ? '背番号や名前を変更すると、チームの現在の登録にも反映します。' : 'この選手をチームへ登録し、進行中の試合にも追加します。'}過去試合の表示は変更されません。</p><label>背番号<input name="number" inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" required value="${view.esc(player?.number || '')}" placeholder="例：12"></label><label class="spaced">名前<input name="name" maxlength="40" required value="${view.esc(player?.name || '')}" placeholder="選手名"></label><button class="button primary full spaced" type="submit">チームと試合に追加</button></form>`);
}
function addMemberMenu() {
  const g = game(); const team = state.data.teams.find(t => t.id === g?.teamId);
  if (!g || !team) return;
  const current = new Set(g.roster.map(p => p.id));
  const available = team.players.filter(p => !current.has(p.id));
  const players = available.length ? `<p class="picker-label">登録済み選手</p><div class="player-grid">${available.map(p => `<button class="player-button" data-action="prepare-member" data-id="${p.id}"><strong>#${view.esc(p.number)}</strong><span>${view.esc(p.name)}</span></button>`).join('')}</div>` : '<p class="help">試合に未追加の登録済み選手はいません。</p>';
  showSheet('メンバーを追加', `${players}<button class="button primary full spaced" data-action="prepare-member">＋ 新しい選手を登録して追加</button><p class="help">登録済み選手は背番号を確認・変更してから追加できます。</p>`, 'player-sheet');
}
function subStart() {
  const g = game();
  if (g.roster.length < 5) { showSheet('選手交代', '<p class="help">交代管理には5人以上の出場メンバーが必要です。試合メニューの「メンバーを追加」から選手を追加してください。</p>'); return; }
  if (g.starters.length !== 5) {
    const choices = g.roster.map(p => `<label class="member-choice"><input type="checkbox" name="lineup" value="${p.id}" ${g.roster.length === 5 ? 'checked' : ''}><strong>#${view.esc(p.number)}</strong><span>${view.esc(p.name)}</span></label>`).join('');
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
  const subject = player ? `#${player.number}-${player.name}` : 'box-score';
  const filename = `${safeFilename(`courtside-${g.date}-${subject}`)}.png`;
  const result = await shareImage(canvas, filename, player ? `${player.name}のスタッツ` : `${g.teamName} vs ${g.opponentName}`);
  if (result === 'downloaded') toast('共有画像を保存しました。');
}
function gameShareMessage(g, suffix = 'CourtsideでBOX SCOREを見る') {
  const summary = aggregate(g, gameEvents(g));
  const date = String(g.date || '').replaceAll('-', '/');
  return `${date} ${g.teamName} vs ${g.opponentName}\n${g.teamName} ${summary.team.PTS} - ${summary.opponent} ${g.opponentName}\n${suffix}`;
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
  const link = new URL(location.href);
  link.hash = `share/${payload}`;
  if (link.href.length > 14000) {
    toast('リンクが長いため、閲覧用ファイルで共有します。');
    await shareGameReport();
    return;
  }
  const result = await shareUrl(link.href, `${g.teamName} vs ${g.opponentName}`, gameShareMessage(g));
  if (result === 'copied') toast('共有リンクをコピーしました。LINEに貼り付けてください。');
  if (result === 'copy-failed') toast('リンクをコピーできませんでした。共有メニューから送ってください。', true);
  if (sheet.open) closeSheet();
}
const handlers = {
  'close-sheet': closeSheet,
  confirm: () => busy(async () => { const fn = confirmAction; if (fn) await fn(); }),
  'add-player': () => { readTeamForm(); if (teamDraft.players.length >= 60) return toast('選手は60人まで登録できます。'); teamDraft.players.push({ id: uid(), number: '', name: '' }); persistDraft('teamDraft', teamDraft); render(); document.querySelector('.roster-edit-row:last-child input').focus(); },
  'remove-player': button => { readTeamForm(); if (teamDraft.players.length <= 1) return toast('1人以上の選手を登録してください。'); teamDraft.players = teamDraft.players.filter(p => p.id !== button.dataset.id); persistDraft('teamDraft', teamDraft); render(); },
  'preset-minutes': button => { document.querySelector('[name=minutes]').value = button.dataset.value; readGameForm(); persistDraft('gameDraft', gameDraft); document.querySelectorAll('.preset').forEach(b => b.classList.toggle('active', b === button)); },
  stat: button => pickStat(button.dataset.type),
  'follow-reb': button => pickStat(button.dataset.type, { followup: true }),
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
      return busy(async () => { const event = await record(selection.type, button.dataset.id); closeSheet(); if (!selection.followup) offerFollowup(event); });
    }
  },
  'prepare-member': button => {
    const g = game(); const team = state.data.teams.find(t => t.id === g?.teamId);
    const player = team?.players.find(p => p.id === button.dataset.id) || null;
    if (team && !button.dataset.id && team.players.length >= 60) return toast('チームには60人まで登録できます。');
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
      closeSheet(); render(); toast('試合履歴を削除しました。');
    }, true);
  },
  'period-menu': periodMenu,
  'change-period': button => {
    const g = game(); const p = g.periods[Number(button.dataset.index)]; if (!p) return;
    confirm(`${p.label}へ移動しますか？`, `これ以降の入力を${p.label}に記録します。`, '移動する', async () => { await saveGameChange({ ...g, currentPeriodId: p.id }); closeSheet(); toast(`${p.label}に移動しました。`); });
  },
  'add-ot': () => {
    const g = game(); const label = `OT${g.periods.filter(p => p.overtime).length + 1}`;
    showSheet(`${label}を追加`, `<form id="ot-form"><p class="help">新しい延長ピリオドを追加し、入力先を切り替えます。</p><label>延長時間（分）<input type="number" name="minutes" value="5" min="1" max="60" step="0.5" required></label><button class="button primary full spaced" type="submit">${label}を追加して移動</button></form>`);
  },
  'add-member': addMemberMenu,
  'game-menu': () => showSheet('試合メニュー', `<div class="card-list"><a class="button secondary full" href="#box/${game().id}">BOX SCOREを表示</a><button class="button secondary full" data-action="add-member">メンバーを追加</button><button class="button secondary full" data-action="period-menu">ピリオド操作</button><button class="button secondary full" data-action="events">イベント履歴・編集</button><button class="button primary full" data-action="finish">試合を終了する</button><a class="button secondary full" href="#home">保存してホームへ</a></div><p class="help">追加した選手はベンチメンバーとして記録できます。すべての入力はその都度保存されています。</p>`),
  finish: () => confirm('試合を終了しますか？', 'BOX SCOREに結果をまとめます。終了後も履歴の編集や記録の再開ができます。', '試合を終了', async () => { const g = await saveGameChange({ ...game(), status: 'finished' }); closeSheet(); location.hash = `#box/${g.id}`; }),
  reopen: () => confirm('記録を再開しますか？', 'この試合を記録中に戻します。', '再開する', async () => { const g = await saveGameChange({ ...game(), status: 'live' }); closeSheet(); location.hash = `#live/${g.id}`; }),
  'player-detail': button => showSheet('選手スタッツ', view.playerDetail(game(), gameEvents(), button.dataset.id)),
  'shared-player-detail': button => showSheet('選手スタッツ', view.sharedPlayerDetail(sharedReport, button.dataset.id)),
  'share-options': () => {
    const g = game();
    sharePayloadPromise = g ? { gameId: g.id, promise: createCompressedSharePayload(g, gameEvents(g)) } : null;
    showSheet('スタッツを共有', `<button class="button primary full" data-action="share-link">${view.icon('share')}LINEへ共有</button><p class="help">日付・対戦チーム・スコアを本文に添えて、短いリンクを送ります。受信者はリンクをタップしてBOX SCOREを開き、選手をタップして詳細も確認できます。</p><button class="button secondary full spaced" data-action="share-report">${view.icon('download')}ファイルで共有</button><p class="help">リンクを使わず、閲覧用ファイルを送る方法です。受信者は「設定」から開きます。</p><button class="button secondary full spaced" data-action="share-box-image">${view.icon('download')}画像で共有</button>`);
  },
  'share-link': () => shareGameLink(),
  'share-report': () => shareGameReport(),
  'share-box-image': async () => { await shareStatsImage(); if (sheet.open) closeSheet(); },
  'share-player-image': button => shareStatsImage(button.dataset.id),
  csv: () => { download(gameCSV(game(), gameEvents()), `courtside-${game().date}-${game().id.slice(0, 8)}.csv`, 'text/csv;charset=utf-8'); toast('CSVを書き出しました。'); },
  'export-json': () => busy(async () => { await draftQueue; await refresh(); teamDraft = null; gameDraft = null; download(JSON.stringify(backupObject(state.data), null, 2), `courtside-backup-${localDate()}.json`, 'application/json'); toast('バックアップを書き出しました。'); render(); }),
  persist: async () => { const result = await navigator.storage?.persist?.(); document.querySelector('#persist-status').textContent = result ? 'このブラウザで保存領域の保持が許可されています。JSONバックアップも続けてください。' : '保持の許可はブラウザが判断します。現在も端末内への保存は有効です。JSONバックアップをご利用ください。'; },
};
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || state.busy) return;
  const fn = handlers[button.dataset.action];
  if (fn) Promise.resolve().then(() => fn(button)).catch(reportError);
});
document.addEventListener('input', event => {
  if (event.target.closest('#team-form')) { readTeamForm(); persistDraft('teamDraft', teamDraft); }
  if (event.target.closest('#game-form')) { readGameForm(); persistDraft('gameDraft', gameDraft); }
});
document.addEventListener('change', event => {
  const el = event.target;
  if (el.closest('#game-form')) {
    readGameForm();
    if (el.name === 'teamId') { selectTeam(el.value); render(); }
    if (el.name === 'format') render();
    if (el.name === 'participants' && !el.checked) { const starter = document.querySelector(`[name=starters][value="${el.value}"]`); starter.checked = false; readGameForm(); }
    if (el.name === 'starters' && el.checked) {
      if (gameDraft.starters.length > 5) { el.checked = false; toast('先発は5人までです。'); }
      else document.querySelector(`[name=participants][value="${el.value}"]`).checked = true;
      readGameForm();
    }
    persistDraft('gameDraft', gameDraft);
  }
  if (el.id === 'continuous' || el.id === 'keepAwake' || el.id === 'theme') busy(async () => {
    const key = el.id === 'continuous' ? 'continuous' : el.id === 'keepAwake' ? 'keepAwake' : 'theme';
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
    const g = { id: uid(), teamId: t.id, teamName: t.name, opponentName: gameDraft.opponentName.trim(), date: gameDraft.date, format: gameDraft.format, regulationCount: periods.length, minutes: Number(gameDraft.minutes), periods, currentPeriodId: periods[0]?.id, roster: structuredClone(t.players.filter(p => gameDraft.participants.includes(p.id))), starters: gameDraft.starters, status: 'live', nextSeq: 1, revision: 0, createdAt: now, updatedAt: now };
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
    closeSheet(); render(); toast(`#${player.number} ${player.name}をチームと試合に追加しました。`);
  });
  if (form.id === 'live-lineup-form') busy(async () => {
    const selected = new FormData(form).getAll('lineup');
    if (selected.length !== 5) throw new Error('コート上の選手を5人選択してください。');
    await saveGameChange({ ...game(), starters: selected });
    closeSheet(); toast('コート上の5人を設定しました。'); subStart();
  });
  if (form.id === 'event-form') busy(async () => {
    const values = new FormData(form); const old = gameEvents().find(e => e.id === form.dataset.id);
    const e = { ...old, periodId: values.get('periodId'), updatedAt: new Date().toISOString() };
    if (old.eventType === 'OPP') e.points = Number(values.get('points'));
    else if (old.eventType !== 'SUB') { e.eventType = values.get('eventType'); e.playerId = values.get('playerId'); e.points = STATS[e.eventType].points; }
    await saveGameChange(game(), e); closeSheet(); toast('記録を修正しました。');
  });
  if (form.id === 'ot-form') busy(async () => {
    const g = game(); const p = { id: uid(), label: `OT${g.periods.filter(p => p.overtime).length + 1}`, minutes: Number(new FormData(form).get('minutes')), overtime: true };
    await saveGameChange({ ...g, periods: [...g.periods, p], currentPeriodId: p.id }); closeSheet(); toast(`${p.label}を追加しました。`);
  });
});
sheet.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); else { pending = null; confirmAction = null; } });
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
async function initPWA() {
  if (!('serviceWorker' in navigator)) { state.pwa.error = 'このブラウザではオフライン起動に対応していません。HTTPSのSafariなどで開いてください。'; renderStatus(); return; }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
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
