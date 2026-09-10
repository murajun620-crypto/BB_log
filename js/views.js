import { STATS, STAT_DEFS, SHOT_ZONES, aggregate, aggregateGames, activeEvents, attackDirectionForPeriod, eventLabel, formatGame, halfCourtPointFromFull, isShotEvent, lineup, localDate, oppositeDirection, percent, shotZoneForEvent, shotZoneLabel } from './domain.js';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const paths = {
  ball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c7 3 7 9.8 0 12.8M18.4 5.6c-7 3-7 9.8 0 12.8"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
  history: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-3"/>',
  sub: '<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.6 6.6-4.1M8.7 13.4l6.6 4.1"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6ZM8 12l3 3 5-6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 14h10l1-14"/>',
};
export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.ball}</svg>`;
const action = (name, text, cls = 'button secondary', attrs = '') => `<button class="${cls}" data-action="${name}" ${attrs}>${text}</button>`;
const tag = text => `<span class="tag">${esc(text)}</span>`;
const statusChip = s => { const pwa = s?.pwa || {}; return `<span class="connection ${pwa.ready ? 'ready' : ''}"><i></i>${pwa.ready ? (navigator.onLine ? 'オフライン利用OK' : 'オフライン') : pwa.error ? 'キャッシュ未完了' : 'オフライン準備中'}</span>`; };
function nav(current) {
  return `<nav class="navigation" aria-label="メインナビゲーション">${[['home', 'ホーム'], ['teams', 'チーム'], ['history', '履歴'], ['settings', '設定']].map(([id, label]) => `<a href="#${id}" class="nav-item ${current === id ? 'selected' : ''}" ${current === id ? 'aria-current="page"' : ''}>${icon(id === 'teams' ? 'team' : id)}<span>${label}</span></a>`).join('')}</nav>`;
}
export function shell(state, content) {
  return `<div class="app-shell"><aside class="sidebar"><a class="brand" href="#home">${icon('ball')}<span>COURTSIDE<small>BASKETBALL STATS</small></span></a>${nav(state.page)}<div class="sidebar-note">WATCH THE GAME.<br>CAPTURE THE MOMENT.<span>すべての記録を、この端末に。</span></div></aside><div class="main-column"><header class="app-header"><a href="#home" class="mobile-brand">${icon('ball')}<strong>COURTSIDE</strong></a>${statusChip(state)}</header><main class="page" id="main">${content}</main></div></div>`;
}
const heading = (eyebrow, title, right = '') => `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div>${right}</div>`;
function gameCard(g, events, resume = false, deletable = false) {
  const a = aggregate(g, events.filter(e => e.gameId === g.id));
  const card = `<a class="game-card" href="#${resume ? 'live' : 'box'}/${g.id}"><div class="game-meta"><span>${esc(g.date.replaceAll('-', '.'))}</span>${tag(g.status === 'live' ? '記録中' : formatGame(g))}</div><div class="game-match"><div><span class="muted">${esc(g.teamName)}</span><h3>vs. ${esc(g.opponentName)}</h3></div><strong class="game-score">${a.team.PTS}<span>–</span>${a.opponent}</strong>${icon('chevron')}</div>${resume ? `<div class="resume-line"><span class="live-dot"></span>${esc(g.periods.find(p => p.id === g.currentPeriodId)?.label)} · ${esc(formatGame(g))}<b>試合を再開 ${icon('arrow')}</b></div>` : ''}</a>`;
  return card;
}
function historyGameCard(g, events, selected, disabled) {
  const label = `${g.date} ${g.teamName} vs ${g.opponentName}`;
  return `<div class="history-game-card ${selected ? 'selected' : ''}"><label class="history-select"><input type="checkbox" data-history-select data-id="${esc(g.id)}" ${selected ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="${esc(label)}を集計対象にする"><span>選択</span></label>${gameCard(g, events)}${action('delete-game', icon('trash'), 'delete-game-button', `data-id="${g.id}" aria-label="${esc(`${g.date} ${g.opponentName}を削除`)}"`)}</div>`;
}
const court = `<svg class="court-art" viewBox="0 0 290 220" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.5"><rect x="24" y="15" width="242" height="330" rx="2"/><path d="M24 180h242M24 53c0 136 242 136 242 0M103 15v88h84V15"/><circle cx="145" cy="103" r="42"/><circle cx="145" cy="180" r="28"/><path d="M127 33h36"/><circle cx="145" cy="43" r="10"/></g><circle cx="222" cy="148" r="6" fill="currentColor"/><path d="m186 174 26-18" stroke="currentColor" stroke-width="2" stroke-dasharray="4 5"/></svg>`;
export function homeView(s) {
  const live = s.data.games.filter(g => g.status === 'live').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const recent = s.data.games.filter(g => g.status === 'finished').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  return shell(s, `${heading('YOUR GAME. YOUR RECORD.', 'コートサイドから。')}<section class="hero">${court}<div class="hero-content"><span class="hero-tag">FOCUS ON THE GAME</span><h2>一瞬を、<br>記録に。</h2><p>スタッツ、選手。2タップで完了。<br>目の前のプレーに集中しよう。</p><a class="button hero-button" href="#new">${icon('plus')}試合を記録する${icon('arrow')}</a></div></section><div class="quick-facts"><span>${icon('check')}2タップ入力</span><span>${icon('shield')}端末に自動保存</span><span>${icon('ball')}完全オフライン</span></div>${live.length ? `<section><div class="section-heading"><h2><span class="live-dot"></span>記録中の試合</h2><span class="muted">${live.length} GAMES</span></div><div class="card-list">${live.map(g => gameCard(g, s.data.events, true)).join('')}</div></section>` : ''}<section><div class="section-heading"><h2>最近の試合</h2><a href="#history" class="text-link">すべて見る ${icon('arrow')}</a></div>${recent.length ? `<div class="card-list">${recent.map(g => gameCard(g, s.data.events)).join('')}</div>` : `<div class="empty-state">${icon('history')}<h3>次の試合が、最初の記録。</h3><p>終了した試合とBOX SCOREがここに並びます。</p></div>`}</section>${!s.data.teams.length ? `<a class="setup-card" href="#team/new"><span class="square-icon">${icon('team')}</span><div><h3>まずは、チームを登録</h3><p>背番号と名前を登録して、試合の準備を。</p></div>${icon('chevron')}</a>` : `<a class="setup-card" href="#teams"><span class="square-icon">${icon('team')}</span><div><h3>マイチーム</h3><p>${s.data.teams.length}チーム · 選手を管理</p></div>${icon('chevron')}</a>`}`);
}
export function teamsView(s) {
  return shell(s, `${heading('MY ROSTER', 'チーム', '<a class="button primary small" href="#team/new">＋ 新規登録</a>')}<p class="intro">いつものメンバーを登録して、試合前の準備をスムーズに。</p><div class="card-list">${s.data.teams.map(t => `<a href="#team/${t.id}" class="setup-card"><span class="team-avatar">${esc(t.name.slice(0, 1))}</span><div><h2>${esc(t.name)}</h2><p>${t.players.length} PLAYERS</p></div>${icon('chevron')}</a>`).join('') || '<div class="empty-state"><h3>チームをつくろう</h3><p>背番号と名前だけで、すぐに登録できます。</p><a href="#team/new" class="button primary">チームを登録</a></div>'}</div>`);
}
export function teamFormView(s, draft) {
  return shell(s, `${heading('TEAM SETUP', draft.id ? 'チームを編集' : 'チームを登録')}<form id="team-form"><div class="panel"><label>チーム名<input name="name" maxlength="40" required placeholder="例：TOKYO HOOPS" value="${esc(draft.name)}"></label></div><div class="section-heading"><h2>選手 <span class="muted">${draft.players.length}人</span></h2><span class="draft-status">下書きを自動保存</span></div><div class="roster-editor">${draft.players.map((p, i) => `<div class="roster-edit-row" data-player-id="${esc(p.id)}"><label><span>${i === 0 ? '背番号' : '<span class="sr-only">背番号</span>'}</span><input name="number" aria-label="選手${i + 1}の背番号" inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" required placeholder="00" value="${esc(p.number)}"></label><label><span>${i === 0 ? '名前' : '<span class="sr-only">名前</span>'}</span><input name="playerName" aria-label="選手${i + 1}の名前" maxlength="40" required placeholder="選手名" value="${esc(p.name)}"></label><button type="button" class="icon-button remove-player" data-action="remove-player" data-id="${esc(p.id)}" aria-label="選手${i + 1}を外す">${icon('close')}</button></div>`).join('')}</div>${action('add-player', `${icon('plus')}選手を追加`, 'button secondary full', 'type="button"')}<p class="help">先発5人は試合作成時に選択できます。登録内容の変更は、過去の試合には影響しません。</p><div class="form-actions"><a href="#teams" class="button secondary">戻る</a><button class="button primary" type="submit">チームを保存 ${icon('check')}</button></div></form>`);
}
export function gameFormView(s, d) {
  if (!s.data.teams.length) return shell(s, `${heading('NEW GAME', '試合の準備')}<div class="empty-state">${icon('team')}<h3>先にチームを登録しましょう</h3><p>選手を登録すると、新しい試合を作成できます。</p><a href="#team/new" class="button primary">チームを登録 ${icon('arrow')}</a></div>`);
  const team = s.data.teams.find(t => t.id === d.teamId) || s.data.teams[0];
  const modeValue = d.mode === 'pro' ? 'pro' : 'standard';
  const pro = modeValue === 'pro';
  const opponentRosterText = d.opponentRosterText || '';
  const modeOptions = `<div class="segmented">${[['standard', '標準'], ['pro', 'Pro']].map(([value, label]) => `<label><input type="radio" name="mode" value="${value}" ${modeValue === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div><p class="help">標準は現在の入力画面${s.preferences.advancedMode ? '（Advanced位置入力を含む）' : ''}、ProはiPad横向きの試合中入力画面です。</p>`;
  const proOptions = pro ? `<div class="pro-setup-grid"><label>ゲームクロック<div class="segmented">${[['off', '使わない'], ['on', '使う']].map(([value, label]) => `<label><input type="radio" name="clockEnabled" value="${value}" ${value === (d.clockEnabled ? 'on' : 'off') ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></label><label>相手チームの記録<div class="segmented">${[['score', '総得点のみ'], ['player', '個人も記録']].map(([value, label]) => `<label><input type="radio" name="opponentTracking" value="${value}" ${(d.opponentTracking || 'score') === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></label>${d.opponentTracking === 'player' ? `<label class="span-2">相手選手（1行に1人：背番号 名前）<textarea name="opponentRosterText" rows="4" maxlength="2400" placeholder="4 山田\n7 佐藤">${esc(opponentRosterText)}</textarea><small class="field-help">相手個人スタッツを記録する場合に入力してください。</small></label>` : ''}</div>` : '';
  return shell(s, `${heading('NEW GAME', '試合の準備')}<form id="game-form"><div class="panel form-grid"><label>日付<input type="date" name="date" required value="${esc(d.date || localDate())}"></label><label>自チーム<select name="teamId">${s.data.teams.map(t => `<option value="${t.id}" ${t.id === team.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label><label class="span-2">対戦相手<input name="opponentName" maxlength="40" required placeholder="対戦相手のチーム名" value="${esc(d.opponentName)}"></label></div><div class="section-heading"><h2>記録モード</h2></div><div class="panel">${modeOptions}${proOptions}</div><div class="section-heading"><h2>ゲーム形式</h2></div><div class="panel"><div class="segmented">${[['quarters', '4クォーター'], ['halves', '2ハーフ'], ['custom', '任意設定']].map(([value, label]) => `<label><input type="radio" name="format" value="${value}" ${d.format === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>${d.format === 'custom' ? `<label class="spaced">ピリオド数<input type="number" name="count" min="1" max="12" step="1" required value="${esc(d.count || 4)}"></label>` : ''}<label class="spaced">1ピリオドの時間（分）<input type="number" name="minutes" min="1" max="60" step="0.5" required value="${esc(d.minutes || 8)}"></label><div class="presets">${[5, 6, 7, 8, 10, 12].map(n => action('preset-minutes', `${n}分`, `preset ${Number(d.minutes) === n ? 'active' : ''}`, `type="button" data-value="${n}"`)).join('')}</div><p class="help">時間は試合情報として保存されます。${pro && d.clockEnabled ? 'Proのゲームクロックは、ここで設定した時間からカウントダウンします。' : 'クロック機能はありません。'}延長は試合中に追加できます。</p></div><div class="section-heading"><h2>出場メンバー</h2><span class="muted">先発は0人または5人</span></div><div class="panel roster-select"><div class="roster-select-head"><span>出場する選手</span><span>先発</span></div>${team.players.map(p => `<div class="roster-select-row"><label class="member-choice"><input type="checkbox" name="participants" value="${p.id}" ${d.participants.includes(p.id) ? 'checked' : ''}><strong>${esc(p.number)}</strong><span>${esc(p.name)}</span></label><label class="starter-choice"><input type="checkbox" name="starters" value="${p.id}" aria-label="${esc(p.number)} ${esc(p.name)}を先発にする" ${d.starters.includes(p.id) ? 'checked' : ''}></label></div>`).join('')}</div><p class="help">先発5人を設定すると、Proではコート上の選手を優先表示し、交代を少ないタップで記録できます。</p><div class="form-actions"><a class="button secondary" href="#home">戻る</a><button type="submit" class="button primary">試合を開始 ${icon('arrow')}</button></div><p class="form-footnote draft-status">入力中の設定も端末に自動保存</p></form>`);
}
export function liveView(s, g, events) {
  const a = aggregate(g, events);
  const period = g.periods.find(p => p.id === g.currentPeriodId);
  const recent = activeEvents(events).slice(-3).reverse();
  const hint = s.preferences.advancedMode ? '<span class="step-number">1</span>スタッツ<span class="hint-arrow">→</span><span class="step-number">2</span>選手<span class="hint-arrow">→</span><span class="muted">3 位置</span>' : '<span class="step-number">1</span>スタッツを選択<span class="hint-arrow">→</span><span class="muted">2 選手をタップ</span>';
  return `<main class="live-screen"><header class="live-header"><a href="#home" class="icon-button" aria-label="ホームに戻る">${icon('back')}</a><span class="live-title"><span class="live-dot"></span>LIVE GAME</span><span class="save-state">${icon('check')}保存済み</span>${action('game-menu', icon('more'), 'icon-button', 'aria-label="試合メニュー"')}</header><section class="scoreboard" aria-label="スコア"><div class="score-team"><span class="team-label">MY TEAM</span><strong>${esc(g.teamName)}</strong></div><div class="score-numbers"><b>${a.team.PTS}</b><span>–</span><b>${a.opponent}</b></div><div class="score-team away"><span class="team-label">OPPONENT</span><strong>${esc(g.opponentName)}</strong></div></section><div class="period-row">${action('period-menu', `${esc(period.label)} <span>⌄</span>`, 'period-button', 'aria-label="ピリオド操作"')}<span>${esc(formatGame(g))}</span></div><div class="opponent-row"><span>相手得点</span>${[1, 2, 3].map(n => action('opponent', `+${n}`, 'opponent-button', `data-points="${n}" aria-label="相手に${n}点追加"`)).join('')}</div><div class="input-hint">${hint}</div><div class="stat-grid">${STAT_DEFS.map(d => action('stat', `<span>${d.label.split(' ')[0]}</span>${d.label.includes(' ') ? `<b class="shot-symbol">${d.tone === 'made' ? '○' : '×'}</b>` : `<small>${d.type === 'OREB' ? 'オフェンスREB' : d.type === 'DREB' ? 'ディフェンスREB' : d.name}</small>`}`, `stat-button ${d.tone}`, `data-type="${d.type}" aria-label="${d.name}"`)).join('')}${action('sub', `<span>SUB</span>${icon('sub')}`, 'stat-button sub', 'aria-label="選手交代"')}</div><section class="recent-events" aria-label="直近の記録"><div class="recent-heading"><span>RECENT PLAYS</span>${action('events', '履歴・編集', 'text-button')}</div><div class="recent-list">${recent.map(e => action('edit-event', `<span>${e.eventType === 'OPP' ? 'OPP' : e.eventType === 'SUB' ? 'SUB' : `${esc(g.roster.find(p => p.id === e.playerId)?.number)}`}</span><b>${e.eventType === 'OPP' ? `+${e.points}` : e.eventType === 'SUB' ? '交代' : esc(STATS[e.eventType]?.label)}</b>`, 'recent-chip', `data-id="${e.id}" aria-label="${esc(eventLabel(g, e))}を編集"`)).join('') || '<p class="recent-empty">ここに直近3件のプレーを表示</p>'}</div></section><footer class="live-footer">${action('undo', `${icon('undo')}<strong>UNDO</strong><span>直前を取消</span>`, 'undo-button', activeEvents(events).length ? '' : 'disabled')}<a href="#box/${g.id}" class="box-button">${icon('history')}<span>BOX SCORE</span></a></footer></main>`;
}
export function liveSettingsHTML(g) {
  const mode = g.mode === 'pro' ? 'pro' : 'standard';
  const clockEnabled = g.mode === 'pro' && g.clockEnabled;
  const tracking = g.mode === 'pro' ? g.opponentTracking || 'score' : 'score';
  const rosterText = (g.opponentRoster || []).map(player => `${player.number} ${player.name}`).join('\n');
  const radio = (name, value, label, checked) => `<label><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
  return `<form id="live-settings-form"><p class="help">試合中でも記録モードとProの入力設定を変更できます。保存後すぐにLIVE画面へ戻ります。</p><label>記録モード<div class="segmented">${radio('mode', 'standard', '標準', mode === 'standard')}${radio('mode', 'pro', 'Pro', mode === 'pro')}</div></label><div class="live-settings-pro-options"><label class="spaced">ゲームクロック<div class="segmented">${radio('clockEnabled', 'off', '使わない', !clockEnabled)}${radio('clockEnabled', 'on', '使う', clockEnabled)}</div></label><label class="spaced">相手チームの記録<div class="segmented">${radio('opponentTracking', 'score', '総得点のみ', tracking === 'score')}${radio('opponentTracking', 'player', '個人も記録', tracking === 'player')}</div></label><label class="spaced">相手選手（個人記録用・1行に1人：背番号 名前）<textarea name="opponentRosterText" rows="4" maxlength="2400" placeholder="4 山田\n7 佐藤">${esc(rosterText)}</textarea><small class="field-help">相手選手の個人スタッツを使う場合だけ入力してください。</small></label></div><button class="button primary full spaced" type="submit">設定を保存</button></form>`;
}
const average = (value, games) => (value / games).toFixed(1);
function shooting(s, games = 1) {
  return `<div class="shooting-grid">${[['FG', 'FGM', 'FGA'], ['2P', 'P2M', 'P2A'], ['3P', 'P3M', 'P3A'], ['FT', 'FTM', 'FTA']].map(([label, m, a]) => `<div><span>${label}</span><strong>${s[m]}<small>/${s[a]}</small></strong><b>${percent(s[m], s[a])}</b>${games > 1 ? `<em class="shooting-average">${average(s[m], games)}/${average(s[a], games)}</em>` : ''}</div>`).join('')}</div>`;
}
const PRO_SHOT_ACTIONS = [['FGM', 'FG', '○', 'made', 'フィールドゴール成功'], ['FGX', 'FG', '×', 'miss', 'フィールドゴール失敗'], ['FTM', 'FT', '○', 'made', 'フリースロー成功'], ['FTX', 'FT', '×', 'miss', 'フリースロー失敗']];
const PRO_OTHER_ACTIONS = ['OREB', 'DREB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FD'];
const PRO_FIELD_SHOT_TYPES = new Set(['FGM', 'FGX']);
const PRO_FT_TYPES = new Set(['FTM', 'FTX']);
// A purpose-built full court prevents the non-uniform half-court transform from
// stretching the 3P arc and produces matching lanes on both ends.
const PRO_COURT_MAIN_LINES = '<path d="M24 24H916V476H24ZM470 24V476M24 56H163M24 444H163M163 56A214 214 0 0 1 163 444M916 56H777M916 444H777M777 56A214 214 0 0 0 777 444M24 176H210V324H24M916 176H730V324H916M54 218V282M886 218V282M162 176V184M186 176V184M162 324V316M186 324V316M778 176V184M754 176V184M778 324V316M754 324V316M210 196A54 54 0 0 1 210 304M730 196A54 54 0 0 0 730 304M74 213A37 37 0 0 1 74 287M866 213A37 37 0 0 0 866 287"></path><circle cx="470" cy="250" r="50"></circle><circle cx="74" cy="250" r="10"></circle><circle cx="866" cy="250" r="10"></circle>';
const PRO_COURT_MARKINGS = PRO_COURT_MAIN_LINES;
const PRO_HALF_COURT_MARKINGS = '<path d="M24 24H476V476H24ZM56 24V163M444 24V163M56 163A214 214 0 0 1 444 163M176 24H324V210H176ZM218 54H282M196 210A54 54 0 0 0 304 210M213 74A37 37 0 0 0 287 74"></path><circle cx="250" cy="74" r="10"></circle>';
export const isIPhoneUserAgent = userAgent => /iPhone|iPod/i.test(String(userAgent || ''));
const isIPhone = () => isIPhoneUserAgent(typeof navigator === 'undefined' ? '' : navigator.userAgent);
export function clockText(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
const DIGITAL_SEGMENTS = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg' };
export function digitalText(value) {
  const text = String(value ?? '');
  const digits = text.split('').map(character => character === ':'
    ? '<span class="digital-colon"><i></i><i></i></span>'
    : `<span class="digital-digit">${'abcdefg'.split('').map(segment => `<i class="digital-segment ${segment} ${DIGITAL_SEGMENTS[character]?.includes(segment) ? 'on' : ''}"></i>`).join('')}</span>`).join('');
  return `<span class="digital-display" aria-hidden="true">${digits}</span><span class="sr-only">${esc(text)}</span>`;
}
function proPlayerButton(player, selected, opponent = false, onCourt = false, stats = {}) {
  const status = opponent ? '' : onCourt ? 'on-court' : 'bench';
  return `<button class="pro-player ${status} ${selected ? 'selected' : ''}" data-action="${opponent ? 'pro-select-opponent' : 'pro-select-player'}" data-id="${esc(player.id)}" aria-pressed="${selected ? 'true' : 'false'}"><span class="pro-player-name"><strong>${esc(player.number)}</strong><span>${esc(player.name)}</span></span><small class="pro-player-stats">${stats.PTS ?? 0}点 · F${stats.PF ?? 0}</small></button>`;
}
function proCourtHTML(g, events, interactive = false, selectionSide = null) {
  const halfCourt = isIPhone();
  const attackDirection = attackDirectionForPeriod(g);
  const markers = activeEvents(events).filter(event => isShotEvent(event) && Number.isFinite(event.shotX) && Number.isFinite(event.shotY)).map(event => {
    const markerDirection = event.side === 'opponent' ? oppositeDirection(attackDirection) : attackDirection;
    const point = halfCourt ? halfCourtPointFromFull(event.shotX, event.shotY, markerDirection) : { x: event.shotX * 940, y: event.shotY * 500 };
    const x = point.x, y = point.y, made = event.eventType.endsWith('M');
    return `<g class="pro-shot-marker ${made ? 'made' : 'miss'}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><text text-anchor="middle" dy=".36em">${made ? '○' : '×'}</text><title>${esc(eventLabel(g, event))}</title></g>`;
  }).join('');
  const interaction = interactive ? 'data-action="pro-shot-point" role="button" tabindex="0"' : 'role="img"';
  const shotDirection = selectionSide === 'opponent' ? oppositeDirection(attackDirection) : attackDirection;
  const backcourt = !halfCourt && interactive && selectionSide ? shotDirection === 'right'
    ? '<rect class="pro-backcourt-overlay" data-action="pro-backcourt" x="24" y="24" width="446" height="452" aria-label="バックコート。選択不可"><title>BACK COURT · 選択不可</title></rect><text class="pro-backcourt-label" x="247" y="250" text-anchor="middle">BACK COURT</text>'
    : '<rect class="pro-backcourt-overlay" data-action="pro-backcourt" x="470" y="24" width="446" height="452" aria-label="バックコート。選択不可"><title>BACK COURT · 選択不可</title></rect><text class="pro-backcourt-label" x="693" y="250" text-anchor="middle">BACK COURT</text>'
    : '';
  const viewBox = halfCourt ? '0 0 500 500' : '0 0 940 500';
  const surface = halfCourt ? '<rect class="pro-court-surface" x="24" y="24" width="452" height="452" rx="2"></rect>' : '<rect class="pro-court-surface" x="24" y="24" width="892" height="452" rx="2"></rect>';
  const markings = halfCourt ? PRO_HALF_COURT_MARKINGS : PRO_COURT_MARKINGS;
  const label = halfCourt ? 'ハーフコート。上側がゴール。シュート位置をタップ' : interactive ? 'フルコート。フロントコートのシュート位置をタップ' : 'フルコート';
  return `<svg class="pro-court${halfCourt ? ' pro-court-half' : ''}" viewBox="${viewBox}" ${interaction} aria-label="${label}">${surface}${backcourt}<g class="pro-court-markings">${markings}</g><g class="pro-shot-markers">${markers}</g></svg>`;
}
export function proLiveView(s, g, events, clockSeconds = null) {
  const a = aggregate(g, events);
  const period = g.periods.find(p => p.id === g.currentPeriodId);
  const attackDirection = attackDirectionForPeriod(g);
  const attackGoal = attackDirection === 'right' ? '右ゴール' : '左ゴール';
  const attackArrow = attackDirection === 'right' ? '→' : '←';
  const selection = s.proSelection || {};
  const onCourt = new Set(lineup(g, events));
  const ownPlayers = [...g.roster].sort((left, right) => Number(onCourt.has(right.id)) - Number(onCourt.has(left.id))).map(player => proPlayerButton(player, selection.playerId === player.id || s.proSub?.outPlayerId === player.id, false, onCourt.has(player.id), a.players[player.id]));
  const opponentSelection = s.proOpponentSelection || {};
  const opponentPlayers = (g.opponentRoster || []).map(player => proPlayerButton(player, opponentSelection.playerId === player.id, true, false, a.opponentPlayers[player.id]));
  const selectedAction = selection.type ? PRO_SHOT_ACTIONS.find(actionData => actionData[0] === selection.type)?.[4] || STATS[selection.type]?.name || STATS[selection.type]?.label : '';
  const selectedPlayer = g.roster.find(player => player.id === selection.playerId);
  const selectedOpponentAction = opponentSelection.type ? PRO_SHOT_ACTIONS.find(actionData => actionData[0] === opponentSelection.type)?.[4] || STATS[opponentSelection.type]?.name || STATS[opponentSelection.type]?.label : '';
  const selectedOpponentPlayer = (g.opponentRoster || []).find(player => player.id === opponentSelection.playerId);
  const ownPointReady = PRO_FIELD_SHOT_TYPES.has(selection.type) && !!selection.playerId;
  const opponentPointReady = PRO_FIELD_SHOT_TYPES.has(opponentSelection.type) && !!opponentSelection.playerId;
  const hint = s.proSub ? (s.proSub.outPlayerId ? '交代するベンチの選手をタップ' : '交代するコート上の選手をタップ') : ownPointReady ? 'コート上をタップして位置を記録' : opponentPointReady ? 'コート上をタップして相手の位置を記録' : selection.type || opponentSelection.type ? '選手をタップ' : 'プレーを選択';
  const actionButton = ([type, label, symbol, tone, name]) => action('pro-action', `<span>${label}</span><b>${symbol}</b>`, `pro-action-button ${tone}`, `data-type="${type}" aria-label="${name}"`);
  const otherButton = type => action('pro-action', `<span>${STATS[type].label}</span>`, 'pro-action-button other', `data-type="${type}" aria-label="${STATS[type].name}"`);
  const opponentAction = ([type, label, symbol, tone, name]) => action('pro-opponent-action', `<span>${label}</span><b>${symbol}</b>`, `pro-action-button ${tone}`, `data-type="${type}" aria-label="相手 ${name}"`);
  return `<main class="pro-live-screen"><header class="pro-header"><a href="#home" class="icon-button" aria-label="ホームに戻る">${icon('back')}</a><span class="live-title"><span class="live-dot"></span>PRO LIVE</span><span class="save-state">${icon('check')}保存済み</span>${action('game-menu', icon('more'), 'icon-button', 'aria-label="試合メニュー"')}</header><section class="pro-scoreboard" aria-label="スコア"><div><span>MY TEAM</span><strong>${esc(g.teamName)}</strong></div><b class="pro-score-digits">${digitalText(a.team.PTS)}<i>–</i>${digitalText(a.opponent)}</b><div><span>OPPONENT</span><strong>${esc(g.opponentName)}</strong></div></section><div class="pro-meta"><span class="pro-period">${action('period-menu', `${esc(period.label)} ⌄`, 'period-button', 'aria-label="ピリオド操作"')}</span><span>${esc(formatGame(g))}</span>${g.clockEnabled ? `<button class="pro-clock ${g.clockRunning ? 'running' : ''}" data-action="pro-clock-edit" aria-label="ゲームクロックを編集"><span id="pro-clock-value" class="pro-clock-digits">${digitalText(clockText(clockSeconds))}</span><small>EDIT</small></button><button class="pro-clock-toggle ${g.clockRunning ? 'running' : ''}" data-action="pro-clock-toggle" aria-label="ゲームクロックを${g.clockRunning ? '停止' : '開始'}"><small>${g.clockRunning ? 'STOP' : 'START'}</small></button><button class="pro-clock-reset" data-action="pro-clock-reset" aria-label="ゲームクロックをリセット">↺</button>` : '<span class="pro-clock-off">CLOCK OFF</span>'}</div><div class="pro-layout"><aside class="pro-side pro-home-side"><p class="pro-roster-label">選手をタップ</p><div class="pro-roster-key"><span class="on-court-key">コート上</span><span class="bench-key">ベンチ</span></div><div class="pro-roster">${ownPlayers.join('')}</div><button class="pro-sub-button" data-action="pro-sub">交代</button></aside><section class="pro-center"><div class="pro-court-status"><span>${esc(hint)}</span>${action('toggle-pro-attack', `<span>自チームの攻撃</span><b>${attackArrow} ${attackGoal}</b><small>${g.format === 'quarters' ? 'ハーフタイムで自動反転' : 'タップで変更'}</small>`, 'pro-direction-button', `aria-label="自チームの攻撃は${attackGoal}です。タップで変更"`)}${selectedPlayer ? `<b>${esc(selectedPlayer.number)} ${esc(selectedPlayer.name)} · ${esc(selectedAction)}</b>` : selectedOpponentPlayer ? `<b>相手 ${esc(selectedOpponentPlayer.number)} ${esc(selectedOpponentPlayer.name)} · ${esc(selectedOpponentAction)}</b>` : ''}</div>${proCourtHTML(g, events, ownPointReady || opponentPointReady, ownPointReady ? 'home' : opponentPointReady ? 'opponent' : null)}<div class="pro-action-panel"><div class="pro-action-row">${PRO_SHOT_ACTIONS.map(actionButton).join('')}</div><div class="pro-action-row pro-other-row">${PRO_OTHER_ACTIONS.map(otherButton).join('')}</div></div></section><aside class="pro-side pro-away-side">${g.opponentTracking === 'player' && opponentPlayers.length ? `<p class="pro-roster-label">相手選手をタップ</p><div class="pro-roster">${opponentPlayers.join('')}</div><div class="pro-action-row pro-opponent-actions">${PRO_SHOT_ACTIONS.map(opponentAction).join('')}</div>` : `<p class="pro-roster-label">総得点のみ</p><div class="pro-opponent-score">${[1, 2, 3].map(points => action('opponent', `+${points}`, 'opponent-button', `data-points="${points}" aria-label="相手に${points}点追加"`)).join('')}</div>`}</aside></div><footer class="pro-footer">${action('undo', `${icon('undo')}<strong>UNDO</strong>`, 'undo-button', activeEvents(events).length ? '' : 'disabled')}${action('events', `${icon('history')}<span>履歴</span>`, 'pro-history-button') }<a href="#box/${g.id}" class="box-button">${icon('history')}<span>BOX SCORE</span></a></footer></main>`;
}
export function strategyBoardButtonHTML() {
  return action('strategy-board', '作戦ボード', 'strategy-button', 'aria-label="作戦ボードを開く"');
}
const strategyBoardToolLabels = { home: '味方', away: '相手', ball: 'ボール', line: 'ライン', arrow: '矢印', erase: '消しゴム' };
const strategyBoardPoint = value => Math.max(20, Math.min(980, Number(value) || 20));
const strategyBoardYPoint = value => Math.max(20, Math.min(580, Number(value) || 20));
const strategyBoardItems = board => Array.isArray(board?.items) ? board.items : [];
const strategyBoardTeamFor = item => item?.team === 'away' ? 'away' : 'home';
export function strategyBoardCountsHTML(board = {}) {
  const items = strategyBoardItems(board);
  const home = items.filter(item => item.kind === 'athlete' ? strategyBoardTeamFor(item) === 'home' : item.kind === 'marker' && item.marker === 'player').length;
  const away = items.filter(item => item.kind === 'athlete' && strategyBoardTeamFor(item) === 'away').length;
  const ball = items.filter(item => item.kind === 'ball' || item.kind === 'marker' && item.marker === 'ball').length;
  return `<span>味方 <b>${home}/5</b></span><span>相手 <b>${away}/5</b></span><span>ボール <b>${ball}/1</b></span>`;
}
export function strategyBoardItemsHTML(board = {}) {
  return strategyBoardItems(board).map(item => {
    const x = strategyBoardPoint(item.x); const y = strategyBoardYPoint(item.y);
    if (item.kind === 'athlete' || item.kind === 'marker' && item.marker === 'player') {
      const team = strategyBoardTeamFor(item);
      return `<g class="strategy-board-uniform strategy-board-${team}" data-strategy-item="${esc(item.id)}" transform="translate(${x} ${y})"><path d="M-13-24-25-17-37-4-26 13-17 7-17 26H17V7L26 13 37-4 25-17 13-24Z"></path><path class="strategy-board-uniform-collar" d="M-10-23Q0-12 10-23"></path><text y="8" text-anchor="middle">${esc(item.label || '')}</text></g>`;
    }
    if (item.kind === 'ball' || item.kind === 'marker' && item.marker === 'ball') return `<g class="strategy-board-ball" data-strategy-item="${esc(item.id)}" transform="translate(${x} ${y})"><circle r="18"></circle><path d="M-18 0H18M0-18V18M-13-13C-4-7 4 7 13 13M13-13C4-7-4 7-13 13"></path></g>`;
    if (!['line', 'arrow'].includes(item.kind)) return '';
    const startX = strategyBoardPoint(item.startX); const startY = strategyBoardYPoint(item.startY);
    const endX = strategyBoardPoint(item.endX); const endY = strategyBoardYPoint(item.endY);
    return `<line class="strategy-board-drawing ${item.kind === 'arrow' ? 'arrow' : ''}" data-strategy-item="${esc(item.id)}" x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}"${item.kind === 'arrow' ? ' marker-end="url(#strategy-board-arrow)"' : ''}></line>`;
  }).join('');
}
export function strategyBoardDraftHTML(draft = null) {
  if (!draft) return '';
  return `<line class="strategy-board-draft ${draft.tool === 'arrow' ? 'arrow' : ''}" x1="${strategyBoardPoint(draft.startX)}" y1="${strategyBoardYPoint(draft.startY)}" x2="${strategyBoardPoint(draft.endX)}" y2="${strategyBoardYPoint(draft.endY)}"${draft.tool === 'arrow' ? ' marker-end="url(#strategy-board-arrow)"' : ''}></line>`;
}
export function strategyBoardHTML(board = {}) {
  const selected = strategyBoardToolLabels[board.tool] ? board.tool : 'home';
  const tools = Object.entries(strategyBoardToolLabels).map(([tool, label]) => `<button type="button" class="strategy-tool ${selected === tool ? 'active' : ''}" data-action="strategy-tool" data-tool="${tool}" aria-pressed="${selected === tool}">${label}</button>`).join('');
  return `<div class="strategy-board-toolbar"><div class="strategy-board-tools" role="group" aria-label="作戦ボードの道具">${tools}</div><div class="strategy-board-actions"><button type="button" class="strategy-board-action" data-action="strategy-undo">UNDO</button><button type="button" class="strategy-board-action danger" data-action="strategy-clear">全消去</button></div></div><div class="strategy-board-counts" data-strategy-board-counts aria-live="polite">${strategyBoardCountsHTML(board)}</div><p class="strategy-board-hint" id="strategy-board-hint">味方を選び、コートをタップして配置（最大5人）</p><div class="strategy-board-stage"><svg class="strategy-board-canvas" data-strategy-board viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet" role="img" aria-label="作戦ボード。味方と相手を各5人まで、ボールを1個配置し、ラインと矢印を描けます"><defs><marker id="strategy-board-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs><rect class="strategy-board-surface" x="20" y="20" width="960" height="560" rx="4"></rect><g class="strategy-board-court"><path d="M20 20H980V580H20ZM500 20V580M20 88H194M20 512H194M194 88A255 255 0 0 1 194 512M980 88H806M980 512H806M806 88A255 255 0 0 0 806 512M20 230H250V370H20M980 230H750V370H980M250 250A60 60 0 0 1 250 350M750 250A60 60 0 0 0 750 350M96 270V330M904 270V330M250 230A42 42 0 0 1 250 370M750 230A42 42 0 0 0 750 370"></path><circle cx="500" cy="300" r="56"></circle><circle cx="96" cy="300" r="12"></circle><circle cx="904" cy="300" r="12"></circle></g><g data-strategy-board-items>${strategyBoardItemsHTML(board)}</g><g data-strategy-board-draft></g></svg></div><div class="strategy-board-footnote"><span>全画面で利用できます。ボード内容はこの端末の試合画面だけに保持されます。</span></div>`;
}
const shotType = type => ['2PM', '2PX', '3PM', '3PX'].includes(type);
const BOX_STAT_KEYS = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FD'];
const DETAIL_STAT_KEYS = ['OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FD'];
export function shotChartHTML(events, playerId = null, displayMode = 'points') {
  const shots = activeEvents(events).filter(event => shotType(event.eventType) && event.side !== 'opponent' && shotZoneForEvent(event) && (!playerId || event.playerId === playerId));
  if (!shots.length) return '';
  return `<section class="shot-chart"><div class="section-heading"><h2>ショットチャート</h2><span class="muted">成功数/試投数・成功率</span></div>${shotChartMapHTML(shots, playerId, displayMode)}</section>`;
}
export function sharedShotChartHTML(shots = [], playerId = null, displayMode = 'points') {
  const filtered = shots.filter(shot => shot?.zone && (!playerId || shot.playerId === playerId));
  if (!filtered.length) return '';
  return `<section class="shot-chart"><div class="section-heading"><h2>ショットチャート</h2><span class="muted">成功数/試投数・成功率</span></div>${shotChartMapHTML(filtered, playerId, displayMode)}</section>`;
}
export function boxView(s, g, events) {
  const a = aggregate(g, events);
  const label = key => ({ OREB: 'OR', DREB: 'DR', PF: 'F' }[key] || key);
  const row = (p, st, total = false) => `<tr ${total ? 'class="total-row"' : ''}><th scope="row">${total ? 'TEAM' : `<button data-action="player-detail" data-id="${p.id}"><b>${esc(p.number)}</b><span>${esc(p.name)}</span></button>`}</th>${BOX_STAT_KEYS.map(k => `<td ${k === 'PTS' ? 'class="pts-cell"' : ''}>${st[k]}</td>`).join('')}</tr>`;
  const opponentRow = (p, st) => `<tr><th scope="row"><b>${esc(p.number)}</b><span>${esc(p.name)}</span></th>${BOX_STAT_KEYS.map(k => `<td ${k === 'PTS' ? 'class="pts-cell"' : ''}>${st[k]}</td>`).join('')}</tr>`;
  const opponentBox = g.mode === 'pro' && g.opponentTracking === 'player' && g.opponentRoster?.length ? `<div class="section-heading"><h2>相手選手スタッツ</h2></div><div class="box-table-wrap"><table class="box-table"><thead><tr><th scope="col">PLAYER</th>${BOX_STAT_KEYS.map(k => `<th scope="col">${label(k)}</th>`).join('')}</tr></thead><tbody>${g.opponentRoster.map(p => opponentRow(p, a.opponentPlayers[p.id])).join('')}<tr class="total-row"><th scope="row">TEAM</th>${BOX_STAT_KEYS.map(k => `<td>${a.opponentTeam[k]}</td>`).join('')}</tr></tbody></table></div>` : '';
  const tools = `<div class="heading-actions">${action('share-options', `${icon('share')}共有`, 'button primary small')}${action('csv', `${icon('download')}CSV`, 'button secondary small')}</div>`;
  return shell(s, `${heading('GAME REPORT', 'BOX SCORE', tools)}<div class="report-card"><div class="game-meta"><span>${esc(g.date.replaceAll('-', '.'))} · ${esc(formatGame(g))}</span>${tag(g.status === 'live' ? '記録中' : 'FINAL')}</div><div class="report-score"><div><span>MY TEAM</span><h2>${esc(g.teamName)}</h2></div><strong>${a.team.PTS}<span>–</span>${a.opponent}</strong><div><span>OPPONENT</span><h2>${esc(g.opponentName)}</h2></div></div><div class="period-scores"><div><span>PERIOD</span><b>自チーム</b><b>相手</b></div>${a.periods.map(p => `<div><span>${esc(p.label)}</span><b>${p.home}</b><b>${p.away}</b></div>`).join('')}</div></div><div class="section-heading"><h2>チーム・シューティング</h2></div><div class="panel">${shooting(a.team)}</div><div class="section-heading"><h2>選手スタッツ</h2><span class="muted">選手をタップで詳細</span></div><div class="box-table-wrap"><table class="box-table"><thead><tr><th scope="col">PLAYER</th>${BOX_STAT_KEYS.map(k => `<th scope="col">${label(k)}</th>`).join('')}</tr></thead><tbody>${g.roster.map(p => row(p, a.players[p.id])).join('')}${row(null, a.team, true)}</tbody></table></div><div class="rebound-total"><span>OR <b>${a.team.OREB}</b></span><span>DR <b>${a.team.DREB}</b></span><span>REB <b>${a.team.REB}</b></span></div>${opponentBox}<div class="form-actions">${action('events', `${icon('history')}履歴・編集`)}${g.status === 'live' ? `<a href="#live/${g.id}" class="button primary">記録に戻る ${icon('arrow')}</a>` : action('reopen', '記録を再開', 'button primary')}</div>${g.status === 'live' ? action('finish', '試合を終了する', 'button secondary full spaced') : ''}`);
}
export function playerDetail(g, events, id) {
  const p = g.roster.find(p => p.id === id); const st = aggregate(g, events).players[id];
  return `<div class="player-detail-name"><span class="jersey">${esc(p.number)}</span><h3>${esc(p.name)}</h3><div class="detail-points"><b>${st.PTS}</b> PTS</div></div>${shooting(st)}<div class="detail-stats">${DETAIL_STAT_KEYS.map(k => `<div><span>${({ OREB: 'OR', DREB: 'DR', PF: 'F' }[k] || k)}</span><strong>${st[k]}</strong></div>`).join('')}</div>${action('share-player-image', `${icon('share')}この選手を画像で共有`, 'button primary full', `data-id="${esc(p.id)}"`)}<p class="share-help">iPhoneでは共有先を選択できます。未対応のブラウザではPNGを保存します。</p>`;
}
export function sharedReportView(s, report) {
  const label = key => ({ PF: 'F' }[key] || key);
  const row = (player, stats, total = false) => `<tr ${total ? 'class="total-row"' : ''}><th scope="row">${total ? 'TEAM' : `<button data-action="shared-player-detail" data-id="${esc(player.id)}"><b>${esc(player.number)}</b><span>${esc(player.name)}</span></button>`}</th>${BOX_STAT_KEYS.map(key => `<td ${key === 'PTS' ? 'class="pts-cell"' : ''}>${stats[key]}</td>`).join('')}</tr>`;
  return shell(s, `${heading('PRIVATE REPORT', '共有レポート', tag('閲覧専用'))}<p class="private-report-note">このファイルの内容だけを表示しています。あなたのチーム・試合データには追加されません。</p><div class="report-card"><div class="game-meta"><span>${esc(report.date.replaceAll('-', '.'))} · ${esc(report.format)}</span>${tag(report.status === 'live' ? '記録時点' : 'FINAL')}</div><div class="report-score"><div><span>MY TEAM</span><h2>${esc(report.teamName)}</h2></div><strong>${report.team.PTS}<span>–</span>${report.opponentScore}</strong><div><span>OPPONENT</span><h2>${esc(report.opponentName)}</h2></div></div><div class="period-scores"><div><span>PERIOD</span><b>自チーム</b><b>相手</b></div>${report.periods.map(period => `<div><span>${esc(period.label)}</span><b>${period.home}</b><b>${period.away}</b></div>`).join('')}</div></div><div class="section-heading"><h2>チーム・シューティング</h2></div><div class="panel">${shooting(report.team)}</div><div class="section-heading"><h2>選手スタッツ</h2><span class="muted">選手をタップで詳細</span></div><div class="box-table-wrap"><table class="box-table"><thead><tr><th scope="col">PLAYER</th>${BOX_STAT_KEYS.map(key => `<th scope="col">${label(key)}</th>`).join('')}</tr></thead><tbody>${report.players.map(player => row(player, player.stats)).join('')}${row(null, report.team, true)}</tbody></table></div><div class="rebound-total"><span>OR <b>${report.team.OREB}</b></span><span>DR <b>${report.team.DREB}</b></span><span>REB <b>${report.team.REB}</b></span></div><div class="form-actions"><label class="button secondary" for="shared-report-file">別のレポートを開く</label><input type="file" id="shared-report-file" accept=".json,application/json" class="sr-only"><a class="button primary" href="#home">ホームへ</a></div>`);
}
export function sharedPlayerDetail(report, id) {
  const player = report.players.find(candidate => candidate.id === id);
  if (!player) return '<p class="empty-message">選手が見つかりません。</p>';
  const stats = player.stats;
  return `<p class="shared-game-context">${esc(report.teamName)} vs. ${esc(report.opponentName)} · ${esc(report.date.replaceAll('-', '.'))}</p><div class="player-detail-name"><span class="jersey">${esc(player.number)}</span><h3>${esc(player.name)}</h3><div class="detail-points"><b>${stats.PTS}</b> PTS</div></div>${shooting(stats)}<div class="detail-stats">${DETAIL_STAT_KEYS.map(key => `<div><span>${({ OREB: 'OR', DREB: 'DR', PF: 'F' }[key] || key)}</span><strong>${stats[key]}</strong></div>`).join('')}</div>`;
}
export function historyView(s) {
  const games = [...s.data.games].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  const selected = new Set(s.historySelection || []);
  const selectedGames = games.filter(g => selected.has(g.id));
  const teamId = selectedGames[0]?.teamId;
  const tools = `<div class="heading-actions">${tag(`${games.length} GAMES`)}${action('aggregate-selected', `${icon('history')}合計を見る`, 'button primary small', selected.size < 2 ? 'disabled' : '')}</div>`;
  const intro = selected.size ? `${selected.size}試合を選択中。同じ自チームの試合を2試合以上選ぶと、合計スタッツを表示できます。` : '試合を選んで、複数試合の合計スタッツを確認できます。';
  return shell(s, `${heading('GAME ARCHIVE', '試合履歴', tools)}<p class="intro">${intro}</p><div class="card-list">${games.map(g => historyGameCard(g, s.data.events, selected.has(g.id), !!teamId && g.teamId !== teamId && !selected.has(g.id))).join('') || '<div class="empty-state"><h3>まだ試合がありません</h3><p>最初の試合を記録してみましょう。</p><a href="#new" class="button primary">試合を記録する</a></div>'}</div>`);
}
export function aggregateView(s, games, events) {
  const report = aggregateGames(games, events);
  const mode = s.aggregateMode === 'average' ? 'average' : 'total';
  const modeText = mode === 'average' ? '平均' : '合計';
  const label = key => ({ OREB: 'OR', DREB: 'DR', PF: 'F' }[key] || key);
  const cell = (value, key = '') => `<td ${key === 'PTS' ? 'class="pts-cell"' : ''}>${mode === 'average' ? average(value, games.length) : value}</td>`;
  const row = player => `<tr><th scope="row"><button data-action="aggregate-player-detail" data-id="${esc(player.id)}"><b>${esc(player.number)}</b><span>${esc(player.name)}</span></button></th>${BOX_STAT_KEYS.map(key => cell(player.stats[key], key)).join('')}</tr>`;
  const gameList = games.map(game => {
    const score = aggregate(game, events.filter(event => event.gameId === game.id));
    const labelText = `${game.date} ${game.teamName} vs ${game.opponentName}のBOX SCOREを開く`;
    return `<a class="aggregate-game-score" href="#box/${esc(game.id)}" aria-label="${esc(labelText)}"><span class="aggregate-game-info"><b>${esc(game.date.replaceAll('-', '.'))}</b><small>${esc(game.teamName)} vs. ${esc(game.opponentName)}</small></span><strong class="game-score">${score.team.PTS}<span>–</span>${score.opponent}</strong>${icon('chevron')}</a>`;
  }).join('');
  return shell(s, `${heading('MULTI-GAME REPORT', '合計スタッツ', `<div class="heading-actions">${tag(`${games.length} GAMES`)}${action('cloud-create-aggregate', `${icon('share')}LINEへ共有`, 'button primary small')}${action('back-history', '履歴へ戻る', 'button secondary small')}</div>`)}<div class="report-card"><div class="game-meta"><span>${esc(report.teamName)} · 各試合のスコア</span>${tag(`${games.length} GAMES`)}</div><div class="aggregate-game-scores">${gameList}</div></div><div class="section-heading"><h2>チーム・シューティング</h2><span class="muted">成功率は合計から計算</span></div><div class="panel">${shooting(report.team, games.length)}</div><div class="section-heading"><h2>選手スタッツ</h2><button class="mode-toggle" data-action="toggle-aggregate-mode" aria-label="合計と平均を切り替え">合計 / 平均：${modeText}</button></div><div class="box-table-wrap"><table class="box-table"><thead><tr><th scope="col">PLAYER</th>${BOX_STAT_KEYS.map(key => `<th scope="col">${label(key)}</th>`).join('')}</tr></thead><tbody>${report.players.map(row).join('')}<tr class="total-row"><th scope="row">TEAM</th>${BOX_STAT_KEYS.map(key => cell(report.team[key], key)).join('')}</tr></tbody></table></div><div class="rebound-total"><span>OR <b>${mode === 'average' ? average(report.team.OREB, games.length) : report.team.OREB}</b></span><span>DR <b>${mode === 'average' ? average(report.team.DREB, games.length) : report.team.DREB}</b></span><span>REB <b>${mode === 'average' ? average(report.team.REB, games.length) : report.team.REB}</b></span></div>`);
}
export function aggregateViewUnified(s, games, events) {
  const summary = aggregateGames(games, events);
  const currentGame = games.find(game => game.id === s.aggregateGameId);
  const current = currentGame ? aggregate(currentGame, events.filter(event => event.gameId === currentGame.id)) : null;
  const team = current?.team || summary.team;
  const players = currentGame ? currentGame.roster.map(player => ({ ...player, stats: current.players[player.id] })) : summary.players;
  const mode = currentGame ? 'total' : s.aggregateMode === 'average' ? 'average' : 'total';
  const modeText = mode === 'average' ? '平均' : '合計';
  const label = key => ({ OREB: 'OR', DREB: 'DR', PF: 'F' }[key] || key);
  const cell = (stats, key) => `<td${key === 'PTS' ? ' class="pts-cell"' : ''}>${mode === 'average' ? average(stats[key], games.length) : stats[key]}</td>`;
  const row = player => `<tr><th scope="row"><button data-action="aggregate-player-detail" data-id="${esc(player.id)}"><b>${esc(player.number)}</b><span>${esc(player.name)}</span></button></th>${BOX_STAT_KEYS.map(key => cell(player.stats, key)).join('')}</tr>`;
  const gameList = games.map(game => {
    const score = aggregate(game, events.filter(event => event.gameId === game.id));
    const labelText = `${game.date} ${game.teamName} vs ${game.opponentName}のスタッツを表示`;
    return `<button class="aggregate-game-score ${game.id === s.aggregateGameId ? 'selected' : ''}" type="button" data-action="select-aggregate-game" data-id="${esc(game.id)}" aria-label="${esc(labelText)}"><span class="aggregate-game-info"><b>${esc(game.date.replaceAll('-', '.'))}</b><small>${esc(game.teamName)} vs. ${esc(game.opponentName)}</small></span><strong class="game-score">${score.team.PTS}<span>–</span>${score.opponent}</strong><span class="game-score-arrow">›</span></button>`;
  }).join('');
  const gameCard = currentGame ? `<div class="report-card"><div class="game-meta"><span>${esc(currentGame.date.replaceAll('-', '.'))} · ${esc(formatGame(currentGame))}</span>${tag(currentGame.status === 'live' ? '記録中' : 'FINAL')}</div><div class="report-score"><div><span>MY TEAM</span><h2>${esc(currentGame.teamName)}</h2></div><strong>${current.team.PTS}<span>–</span>${current.opponent}</strong><div><span>OPPONENT</span><h2>${esc(currentGame.opponentName)}</h2></div></div><div class="period-scores"><div><span>PERIOD</span><b>自チーム</b><b>相手</b></div>${current.periods.map(period => `<div><span>${esc(period.label)}</span><b>${period.home}</b><b>${period.away}</b></div>`).join('')}</div></div>` : '';
  return shell(s, `${heading('MULTI-GAME REPORT', '合計スタッツ', `<div class="heading-actions">${tag(`${games.length} GAMES`)}${action('cloud-create-aggregate', `${icon('share')}LINEへ共有`, 'button primary small')}${action('back-history', '履歴へ戻る', 'button secondary small')}</div>`)}<div class="report-card"><div class="game-meta"><span>${esc(summary.teamName)} · 各試合のスコア</span>${currentGame ? action('select-aggregate-game', '全試合集計', 'mode-toggle', 'type="button" data-id=""') : tag(`${games.length} GAMES`)}</div><div class="aggregate-game-scores">${gameList}</div></div>${gameCard}<div class="section-heading"><h2>チーム・シューティング</h2>${games.length > 1 ? '<span class="muted">成功率は合計から計算</span>' : ''}</div><div class="panel">${shooting(team, currentGame ? 1 : games.length)}</div><div class="rebound-total"><span>OR <b>${mode === 'average' ? average(team.OREB, games.length) : team.OREB}</b></span><span>DR <b>${mode === 'average' ? average(team.DREB, games.length) : team.DREB}</b></span><span>REB <b>${mode === 'average' ? average(team.REB, games.length) : team.REB}</b></span></div><div class="section-heading"><h2>選手スタッツ</h2>${games.length > 1 && !currentGame ? `<button class="mode-toggle" type="button" data-action="toggle-aggregate-mode" aria-label="合計と平均を切り替え">合計 / 平均：${modeText}</button>` : '<span class="muted">選手をタップで詳細</span>'}</div><div class="box-table-wrap"><table class="box-table"><thead><tr><th scope="col">PLAYER</th>${BOX_STAT_KEYS.map(key => `<th scope="col">${label(key)}</th>`).join('')}</tr></thead><tbody>${players.map(row).join('')}<tr class="total-row"><th scope="row">TEAM</th>${BOX_STAT_KEYS.map(key => cell(team, key)).join('')}</tr></tbody></table></div>`);
}
export function aggregatePlayerDetail(report, id, mode = 'total') {
  const player = report.players.find(candidate => candidate.id === id);
  if (!player) return '<p class="empty-message">選手が見つかりません。</p>';
  const stats = player.stats;
  const label = mode === 'average' ? '平均' : '合計';
  const value = number => mode === 'average' ? average(number, report.games.length) : number;
  return `<div class="detail-mode-row"><span>表示</span><button class="mode-toggle" data-action="toggle-aggregate-player-mode" data-id="${esc(id)}" aria-label="合計と平均を切り替え">合計 / 平均：${label}</button></div><p class="shared-game-context">${esc(report.teamName)} · ${report.games.length}試合</p><div class="player-detail-name"><span class="jersey">${esc(player.number)}</span><h3>${esc(player.name)}</h3><div class="detail-points"><b>${value(stats.PTS)}</b> PTS</div></div>${shooting(stats, report.games.length)}<div class="detail-stats">${DETAIL_STAT_KEYS.map(key => `<div><span>${({ OREB: 'OR', DREB: 'DR', PF: 'F' }[key] || key)}</span><strong>${value(stats[key])}</strong></div>`).join('')}</div>`;
}
export function aggregatePlayerDetailWithGames(report, id, mode = 'total', games = [], events = [], selected = 'total') {
  const basePlayer = report.players.find(candidate => candidate.id === id);
  if (!basePlayer) return '<p class="empty-message">選手が見つかりません。</p>';
  const details = games.map(game => ({ game, report: aggregate(game, events.filter(event => event.gameId === game.id)) }));
  const selectedDetail = details.find(detail => detail.game.id === selected);
  const source = selectedDetail?.report || report;
  const playerStats = selectedDetail ? source.players[id] : source.players.find(player => player.id === id)?.stats;
  if (!playerStats) return '<p class="empty-message">選手が見つかりません。</p>';
  const averageMode = selected === 'average';
  const value = number => averageMode ? average(number, games.length) : number;
  const context = selectedDetail ? `${selectedDetail.game.teamName} vs. ${selectedDetail.game.opponentName} · ${selectedDetail.game.date.replaceAll('-', '.')}` : `${report.teamName} · ${averageMode ? '1試合平均' : '全試合集計'}`;
  const options = games.length > 1 ? `<div class="detail-mode-row"><span>表示する試合</span><select data-action="select-aggregate-player-game" data-id="${esc(id)}" aria-label="選手スタッツの対象試合"><option value="total" ${selected === 'total' ? 'selected' : ''}>全試合集計</option><option value="average" ${selected === 'average' ? 'selected' : ''}>1試合平均</option>${games.map((game, index) => `<option value="${esc(game.id)}" ${selected === game.id ? 'selected' : ''}>${index + 1}試合目：${esc(game.date.replaceAll('-', '.'))} vs. ${esc(game.opponentName)}</option>`).join('')}</select></div>` : '';
  return `${options}<p class="shared-game-context">${esc(context)}</p><div class="player-detail-name"><span class="jersey">${esc(basePlayer.number)}</span><h3>${esc(basePlayer.name)}</h3><div class="detail-points"><b>${value(playerStats.PTS)}</b> PTS</div></div>${shooting(playerStats, averageMode ? games.length : selectedDetail ? 1 : games.length)}<div class="detail-stats">${DETAIL_STAT_KEYS.map(key => `<div><span>${({ OREB: 'OR', DREB: 'DR', PF: 'F' }[key] || key)}</span><strong>${value(playerStats[key])}</strong></div>`).join('')}</div>`;
}
export function settingsView(s) {
  return shell(s, `${heading('PREFERENCES', '設定とデータ')}<section class="panel settings-panel"><h2>入力・表示</h2><label class="setting-row"><span><strong>連続入力</strong><small>標準・Proでシュート後にAST / OR・DRを提案</small></span><input type="checkbox" role="switch" id="continuous" ${s.preferences.continuous ? 'checked' : ''}></label><label class="setting-row"><span><strong>外観</strong><small>見やすい明るさを選択</small></span><select id="theme" aria-label="外観">${[['system', '端末に合わせる'], ['light', 'ライト'], ['dark', 'ダーク']].map(([v, label]) => `<option value="${v}" ${s.preferences.theme === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label></section><section class="panel settings-panel"><h2>受け取った共有レポート</h2><p class="help">共有された1試合のファイルを、データへ取り込まず読み取り専用で開きます。</p><label class="button primary full" for="shared-report-file">${icon('share')}共有レポートを開く</label><input type="file" id="shared-report-file" accept=".json,application/json" class="sr-only"></section><section class="panel settings-panel"><h2>バックアップ</h2><p class="help">試合・チーム・設定を1つのJSONに保存します。定期的に「ファイル」などへ書き出してください。</p>${action('export-json', `${icon('download')}全データを書き出す`, 'button primary full')}<label class="button secondary full spaced" for="restore-file">JSONから復元</label><input type="file" id="restore-file" accept=".json,application/json" class="sr-only"><p class="help">復元前に内容を検証し、件数を表示します。復元すると現在の全データが置き換わります。</p></section><section class="panel settings-panel"><h2>この端末の保存状態</h2><div class="storage-status">${statusChip(s)}<span>${s.data.teams.length}チーム / ${s.data.games.length}試合 / ${activeEvents(s.data.events).length}記録</span></div><p class="help">${s.pwa.error ? esc(s.pwa.error) : s.pwa.ready ? 'アプリ本体のキャッシュが完了しました。通信がなくても利用できます。' : '初回のキャッシュ完了までオンラインでお待ちください。'}</p>${s.pwa.update ? '<p class="notice">更新があります。下のボタンから適用できます。</p>' + action('apply-update', '最新版に更新', 'button primary full') : action('check-update', '最新版を確認', 'button secondary full')}${action('persist', '保存領域の保持をリクエスト', 'button secondary full')}<p class="help" id="persist-status">ブラウザのデータ削除や端末の故障に備え、JSONバックアップもご利用ください。</p></section><section class="panel settings-panel"><h2>iPhoneのホーム画面に追加</h2><ol class="install-steps"><li>Safariでこのアプリを開く</li><li>共有メニューから「ホーム画面に追加」</li><li>表示される場合は「Webアプリとして開く」をONにし、追加</li><li>追加したアプリを起動し、「オフライン利用OK」を確認</li></ol></section><p class="version-note">COURTSIDE 2.2.3 · BUILT FOR THE SIDELINES</p>`);
}
export function pickerHTML(g, events, type, options = {}) {
  const on = lineup(g, events); const tracked = g.starters.length === 5 && !options.plain;
  const players = (options.players || g.roster).filter(p => p.id !== options.exclude && (!options.only || options.only.includes(p.id)));
  const totals = aggregate(g, events || []).players;
  const group = (list, label) => list.length ? `<p class="picker-label">${label}</p><div class="player-grid">${list.map(p => { const stats = totals[p.id] || {}; return action(options.action || 'pick-player', `<span class="player-button-name"><strong>${esc(p.number)}</strong><span>${esc(p.name)}</span></span><small class="player-button-stats">${stats.PTS ?? 0}点 · F${stats.PF ?? 0}</small>`, 'player-button', `data-id="${p.id}"`); }).join('')}</div>` : '';
  return `<p class="picker-instruction">${esc(options.instruction || '記録する選手をタップ')}</p>${group(tracked ? players.filter(p => on.includes(p.id)) : players, tracked ? 'ON COURT' : 'PLAYERS')}${tracked ? `<details ${options.only || options.showBench ? 'open' : ''} class="bench-list"><summary>ベンチの選手を表示</summary>${group(players.filter(p => !on.includes(p.id)), 'BENCH')}</details>` : ''}`;
}
const SHOT_MAP_ZONES = [
  { id: 'three-left-corner', path: 'M10 10H65V138H10Z', labelX: 38, labelY: 72 },
  { id: 'three-left-wing', path: 'M10 138H65C75 190 95 230 122 264C150 295 185 315 220 323C223 324 227 325 231 326L92 465H10Z', labelX: 52, labelY: 218 },
  { id: 'three-top', path: 'M231 326C255 332 280 337 310 337C340 337 365 332 389 326L528 465H92Z', labelX: 310, labelY: 420 },
  { id: 'three-right-wing', path: 'M389 326C392 325 396 324 400 323C435 315 470 295 498 264C525 230 545 190 555 138H610V465H528Z', labelX: 568, labelY: 218 },
  { id: 'three-right-corner', path: 'M555 10H610V138H555Z', labelX: 582, labelY: 72 },
  { id: 'two-left-corner', path: 'M65 10H220V138H65Z', labelX: 142, labelY: 72 },
  { id: 'two-left-wing', path: 'M65 138H220V228L175 306C155.9 295.6 137.8 281.5 122 264C95 230 75 190 65 138Z', labelX: 132, labelY: 220 },
  { id: 'two-top', path: 'M220 228H400L445 306C430.4 313.8 415.2 319.5 400 323C370 332 340 337 310 337C280 337 250 332 220 323C204.8 319.5 189.6 313.8 175 306Z', labelX: 310, labelY: 278 },
  { id: 'two-right-wing', path: 'M400 138H555C545 190 525 230 498 264C482.2 281.5 464.1 295.6 445 306L400 228Z', labelX: 488, labelY: 220 },
  { id: 'two-right-corner', path: 'M400 10H555V138H400Z', labelX: 478, labelY: 72 },
  { id: 'paint', path: 'M220 10H400V228H220Z', labelX: 310, labelY: 160 },
  { id: 'rim', path: 'M268 10H352V90A42 42 0 0 1 268 90Z', labelX: 310, labelY: 72 },
];
export function shotZonePicker(playerName, stat) {
  const isThreePoint = stat?.type?.startsWith('3');
  const active = zone => zone.id.startsWith('three-') === isThreePoint;
  const zones = SHOT_MAP_ZONES.map(zone => {
    const label = SHOT_ZONES.find(candidate => candidate.id === zone.id)?.label || zone.id;
    const interaction = active(zone) ? `data-action="shot-zone" role="button" tabindex="0" aria-label="${esc(label)}"` : 'aria-hidden="true"';
    return `<path class="shot-map-zone ${zone.id.startsWith('three-') ? 'three-point' : 'two-point'} ${active(zone) ? 'active' : 'disabled'}" data-zone="${zone.id}" d="${zone.path}" ${interaction}><title>${esc(label)}</title></path>`;
  }).join('');
  const target = isThreePoint ? '3Pエリアをタップ' : '2Pエリアをタップ';
  return `<p class="picker-instruction">${esc(playerName)} · ${esc(stat?.name)}。コート上の位置をタップ</p><div class="shot-zone-legend"><span class="target-zone">${target}</span><span>薄いエリアは選べません</span></div><svg class="shot-court-map" viewBox="0 0 620 475" role="group" aria-label="ハーフコートのシュート位置。${target}"><defs><pattern id="court-wood" width="48" height="475" patternUnits="userSpaceOnUse"><rect width="48" height="475" fill="#f1dfb0"/><path d="M47 0V475M0 118H48M0 356H48" fill="none" stroke="#e4ce98" stroke-width="1" opacity=".58"/></pattern></defs><rect class="court-surface" x="10" y="10" width="600" height="455" rx="2"/>${zones}<g class="court-markings"><path d="M10 10H610V465H10ZM65 10V138M555 10V138M65 138C75 190 95 230 122 264C150 295 185 315 220 323C250 332 280 337 310 337C340 337 370 332 400 323C435 315 470 295 498 264C525 230 545 190 555 138M220 10V228H400V10M250 228A60 60 0 1 0 370 228M268 90A42 42 0 0 0 352 90M275 48H345M310 48V56"/><circle cx="310" cy="70" r="13"/><path class="lane-marks" d="M210 70H220M210 112H220M210 154H220M210 196H220M400 70H410M400 112H410M400 154H410M400 196H410"/></g></svg><button type="button" class="button secondary full spaced" data-action="cancel-shot-zone">入力をやめる</button>`;
}
function chartShot(shot) {
  const zone = shotZoneForEvent(shot);
  if (!SHOT_ZONES.some(candidate => candidate.id === zone)) return null;
  const made = shot?.result ? shot.result === 'made' : shot?.eventType?.endsWith('M');
  const x = Number.isFinite(shot?.x) ? shot.x : Number.isFinite(shot?.shotX) ? shot.shotX : null;
  const y = Number.isFinite(shot?.y) ? shot.y : Number.isFinite(shot?.shotY) ? shot.shotY : null;
  return { zone, made, ...(x !== null && y !== null && [x, y].every(value => value >= 0 && value <= 1) ? { x, y } : {}) };
}
function shotChartTotals(shots, playerId) {
  const totals = Object.fromEntries(SHOT_ZONES.map(zone => [zone.id, { made: 0, attempts: 0 }]));
  for (const shot of shots) {
    if (playerId && shot?.playerId !== playerId) continue;
    const normalized = chartShot(shot);
    if (!normalized) continue;
    totals[normalized.zone].attempts += 1;
    if (normalized.made) totals[normalized.zone].made += 1;
  }
  return totals;
}
function fullCourtShotChartMapHTML(shots, playerId) {
  const totals = shotChartTotals(shots, playerId);
  if (!Object.values(totals).some(stats => stats.attempts)) return '';
  const markerHTML = shots.filter(shot => !playerId || shot?.playerId === playerId).map(shot => ({ raw: shot, normalized: chartShot(shot) })).filter(({ normalized }) => normalized?.x !== undefined && normalized?.y !== undefined).map(({ raw, normalized }) => `<g class="pro-shot-chart-marker ${normalized.made ? 'made' : 'miss'}" transform="translate(${(normalized.x * 940).toFixed(1)} ${(normalized.y * 500).toFixed(1)})"><text text-anchor="middle" dy=".36em">${normalized.made ? '○' : '×'}</text><title>${esc(shotZoneLabel(normalized.zone) || 'シュート')}</title></g>`).join('');
  const summary = SHOT_ZONES.map(zone => { const stats = totals[zone.id]; return `<div class="pro-shot-zone-summary-item"><span>${esc(zone.label)}</span><strong>${stats.made}/${stats.attempts}</strong><b>${percent(stats.made, stats.attempts)}</b></div>`; }).join('');
  return `<svg class="shot-court-map shot-chart-map pro-shot-chart-map" viewBox="0 0 940 500" role="img" aria-label="ショットチャート。○×で各シュートの成功・失敗を表示"><rect class="pro-chart-court-surface" x="24" y="24" width="892" height="452"></rect><g class="pro-chart-court-markings">${PRO_COURT_MARKINGS}</g><g class="pro-shot-chart-markers">${markerHTML}</g></svg><div class="pro-shot-zone-summary">${summary}</div>`;
}
function zoneShotChartMapHTML(shots, playerId) {
  const totals = shotChartTotals(shots, playerId);
  if (!Object.values(totals).some(stats => stats.attempts)) return '';
  const zones = SHOT_MAP_ZONES.map(zone => {
    const label = SHOT_ZONES.find(candidate => candidate.id === zone.id)?.label || zone.id;
    return `<path class="shot-map-zone shot-chart-map-zone ${zone.id.startsWith('three-') ? 'three-point' : 'two-point'}" data-zone="${zone.id}" d="${zone.path}"><title>${esc(label)}</title></path>`;
  }).join('');
  const labels = SHOT_MAP_ZONES.map(zone => {
    const stats = totals[zone.id];
    return `<g class="shot-chart-zone-label" transform="translate(${zone.labelX} ${zone.labelY})"><text class="shot-chart-zone-rate" text-anchor="middle" y="0">${esc(percent(stats.made, stats.attempts))}</text><text class="shot-chart-zone-count" text-anchor="middle" y="18">${stats.made}/${stats.attempts}</text></g>`;
  }).join('');
  return `<svg class="shot-court-map shot-chart-map" viewBox="0 0 620 475" role="img" aria-label="ショットチャート。シュートエリアごとの成功率と成功数・試投数を表示"><rect class="court-surface" x="10" y="10" width="600" height="455" rx="2"/>${zones}<g class="court-markings"><path d="M10 10H610V465H10ZM65 10V138M555 10V138M65 138C75 190 95 230 122 264C150 295 185 315 220 323C250 332 280 337 310 337C340 337 370 332 400 323C435 315 470 295 498 264C525 230 545 190 555 138M220 10V228H400V10M250 228A60 60 0 1 0 370 228M268 90A42 42 0 0 0 352 90M275 48H345M310 48V56"/><circle cx="310" cy="70" r="13"/><path class="lane-marks" d="M210 70H220M210 112H220M210 154H220M210 196H220M400 70H410M400 112H410M400 154H410M400 196H410"/></g>${labels}</svg>`;
}
function shotDisplayToggleHTML(displayMode) {
  const selected = displayMode === 'zones' ? 'zones' : 'points';
  return `<div class="shot-display-toggle" role="group" aria-label="シュート表示方法"><button type="button" class="mode-toggle ${selected === 'points' ? 'active' : ''}" data-action="toggle-shot-display" data-mode="points" aria-pressed="${selected === 'points'}">○× 点</button><button type="button" class="mode-toggle ${selected === 'zones' ? 'active' : ''}" data-action="toggle-shot-display" data-mode="zones" aria-pressed="${selected === 'zones'}">エリア</button></div>`;
}
export function shotChartMapHTML(shots = [], playerId = null, displayMode = 'points') {
  const hasCoordinates = shots.some(shot => { const normalized = chartShot(shot); return normalized?.x !== undefined && normalized?.y !== undefined && (!playerId || shot?.playerId === playerId); });
  if (!hasCoordinates) return zoneShotChartMapHTML(shots, playerId);
  const selected = displayMode === 'zones' ? 'zones' : 'points';
  return `<div class="shot-display" data-shot-display-root data-shot-display-mode="${selected}">${shotDisplayToggleHTML(selected)}<div class="shot-display-view shot-display-view-points">${fullCourtShotChartMapHTML(shots, playerId)}</div><div class="shot-display-view shot-display-view-zones">${zoneShotChartMapHTML(shots, playerId)}</div></div>`;
}
export function eventsHTML(g, events) {
  const active = activeEvents(events).reverse();
  return `<p class="help">タップして選手・項目・ピリオドを修正、または個別削除できます。</p><div class="event-list">${active.map(e => action('edit-event', `<span class="event-period">${esc(g.periods.find(p => p.id === e.periodId)?.label)}</span><span>${esc(eventLabel(g, e))}</span>${icon('chevron')}`, 'event-row', `data-id="${e.id}"`)).join('') || '<p class="empty-message">まだ記録がありません。</p>'}</div>`;
}
export function editEventHTML(g, e) {
  const zoneField = e.eventType && shotType(e.eventType) ? `<label class="spaced">シュート位置<select name="shotZone"><option value="">位置なし</option>${SHOT_ZONES.map(zone => `<option value="${zone.id}" ${zone.id === shotZoneForEvent(e) ? 'selected' : ''}>${esc(zone.label)}</option>`).join('')}</select></label>` : '';
  return `<form id="event-form" data-id="${e.id}"><p class="help">${esc(eventLabel(g, e))}</p><label>ピリオド<select name="periodId">${g.periods.map(p => `<option value="${p.id}" ${p.id === e.periodId ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>${e.eventType === 'SUB' ? '<p class="notice">交代の選手を変更する場合は、この記録を削除して再入力してください。</p>' : e.eventType === 'OPP' ? `<label class="spaced">相手得点<select name="points">${[1, 2, 3].map(n => `<option ${e.points === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : `<label class="spaced">スタッツ<select name="eventType">${STAT_DEFS.map(d => `<option value="${d.type}" ${e.eventType === d.type ? 'selected' : ''}>${d.label} · ${d.name}</option>`).join('')}</select></label><label class="spaced">選手<select name="playerId">${g.roster.map(p => `<option value="${p.id}" ${p.id === e.playerId ? 'selected' : ''}>${esc(p.number)} ${esc(p.name)}</option>`).join('')}</select></label>${zoneField}`}<button type="submit" class="button primary full spaced">変更を保存</button>${action('delete-event', 'この記録を削除', 'button danger full spaced', `type="button" data-id="${e.id}"`)}</form>`;
}
