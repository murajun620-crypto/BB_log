export const STAT_DEFS = [
  ['2PM', '2P ○', '2ポイント成功', 2, 'made'], ['2PX', '2P ×', '2ポイント失敗', 0, 'miss'],
  ['3PM', '3P ○', '3ポイント成功', 3, 'made'], ['3PX', '3P ×', '3ポイント失敗', 0, 'miss'],
  ['FTM', 'FT ○', 'フリースロー成功', 1, 'made'], ['FTX', 'FT ×', 'フリースロー失敗', 0, 'miss'],
  ['OREB', 'OREB', 'オフェンスリバウンド', 0, 'other'], ['DREB', 'DREB', 'ディフェンスリバウンド', 0, 'other'],
  ['AST', 'AST', 'アシスト', 0, 'other'], ['STL', 'STL', 'スティール', 0, 'other'],
  ['BLK', 'BLK', 'ブロック', 0, 'other'], ['TO', 'TO', 'ターンオーバー', 0, 'other'],
  ['PF', 'PF', 'ファウル', 0, 'foul'],
].map(([type, label, name, points, tone]) => ({ type, label, name, points, tone }));
export const STATS = Object.fromEntries(STAT_DEFS.map(s => [s.type, s]));
export const uid = () => crypto.randomUUID();
export const activeEvents = events => events.filter(e => !e.deletedAt).sort((a, b) => a.seq - b.seq);
export const percent = (made, attempts) => attempts ? `${(made / attempts * 100).toFixed(1)}%` : '—';
export const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const formatGame = g => `${g.format === 'quarters' ? '4Q' : g.format === 'halves' ? '2H' : `${g.regulationCount}P`} × ${g.minutes}分`;
export function makePeriods(format, count, minutes) {
  const n = format === 'quarters' ? 4 : format === 'halves' ? 2 : Number(count);
  return Array.from({ length: n }, (_, i) => ({ id: uid(), label: format === 'quarters' ? `Q${i + 1}` : format === 'halves' ? `${i + 1}H` : `P${i + 1}`, minutes: Number(minutes), overtime: false }));
}
export function blankStats() {
  return { PTS: 0, FGM: 0, FGA: 0, P2M: 0, P2A: 0, P3M: 0, P3A: 0, FTM: 0, FTA: 0, OREB: 0, DREB: 0, REB: 0, AST: 0, STL: 0, BLK: 0, TO: 0, PF: 0 };
}
function accumulate(s, type) {
  s.PTS += STATS[type]?.points || 0;
  if (/^[23]P[MX]$/.test(type)) {
    const made = type.endsWith('M') ? 1 : 0;
    s.FGM += made; s.FGA++;
    s[type.startsWith('2') ? 'P2M' : 'P3M'] += made;
    s[type.startsWith('2') ? 'P2A' : 'P3A']++;
  } else if (type === 'FTM' || type === 'FTX') { s.FTA++; s.FTM += type === 'FTM' ? 1 : 0; }
  else if (Object.hasOwn(s, type)) { s[type]++; if (type === 'OREB' || type === 'DREB') s.REB++; }
}
export function aggregate(game, events) {
  const players = Object.fromEntries(game.roster.map(p => [p.id, blankStats()]));
  const team = blankStats();
  const periods = game.periods.map(p => ({ ...p, home: 0, away: 0 }));
  let opponent = 0;
  for (const e of activeEvents(events)) {
    const p = periods.find(p => p.id === e.periodId);
    if (e.eventType === 'OPP') { opponent += e.points; if (p) p.away += e.points; }
    else if (STATS[e.eventType] && players[e.playerId]) {
      accumulate(players[e.playerId], e.eventType); accumulate(team, e.eventType);
      if (p) p.home += STATS[e.eventType].points;
    }
  }
  return { players, team, opponent, periods };
}
export function lineup(game, events, strict = false) {
  const on = new Set(game.starters);
  for (const e of activeEvents(events)) if (e.eventType === 'SUB') {
    if (strict && (on.size !== 5 || !on.has(e.outPlayerId) || on.has(e.inPlayerId))) throw new Error('交代履歴が成立しません。後の交代を取り消してから変更してください。');
    on.delete(e.outPlayerId); on.add(e.inPlayerId);
  }
  return [...on];
}
export function eventLabel(game, event) {
  const player = id => { const p = game.roster.find(p => p.id === id); return p ? `#${p.number} ${p.name}` : '不明'; };
  if (event.eventType === 'OPP') return `相手 +${event.points}`;
  if (event.eventType === 'SUB') return `${player(event.outPlayerId)} → ${player(event.inPlayerId)}`;
  return `${player(event.playerId)} · ${STATS[event.eventType]?.label || event.eventType}`;
}
function ensure(ok, message) { if (!ok) throw new Error(message); }
const isText = (s, max = 80) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const isId = s => isText(s, 100) && /^[\w-]+$/.test(s) && !['__proto__', 'constructor', 'prototype'].includes(s);
const validTime = s => typeof s === 'string' && Number.isFinite(Date.parse(s));
const unique = list => new Set(list).size === list.length;
export function validatePlayers(players) {
  ensure(Array.isArray(players) && players.length >= 1 && players.length <= 60, '選手は1〜60人登録してください。');
  for (const p of players) ensure(p && isId(p.id) && typeof p.number === 'string' && /^\d{1,3}$/.test(p.number) && isText(p.name, 40), '選手の背番号（0〜999）と名前を確認してください。');
  ensure(unique(players.map(p => p.id)) && unique(players.map(p => p.number)), '選手IDまたは背番号が重複しています。');
}
export function validateTeam(t) {
  ensure(t && isId(t.id) && isText(t.name, 40) && Number.isInteger(t.revision) && t.revision >= 0, 'チーム情報が不正です。');
  validatePlayers(t.players);
}
export function validateGame(g, events) {
  ensure(g && isId(g.id) && isId(g.teamId) && isText(g.teamName, 40) && isText(g.opponentName, 40), '試合のチーム情報が不正です。');
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(g.date) && Number.isFinite(Date.parse(g.date)) && new Date(g.date).toISOString().slice(0, 10) === g.date, '試合の日付が不正です。');
  ensure(['quarters', 'halves', 'custom'].includes(g.format) && ['live', 'finished'].includes(g.status), '試合形式または状態が不正です。');
  ensure(Number.isInteger(g.regulationCount) && g.regulationCount >= 1 && g.regulationCount <= 12 && (g.format === 'custom' || g.regulationCount === (g.format === 'quarters' ? 4 : 2)), 'ピリオド数が不正です。');
  ensure(Number.isFinite(g.minutes) && g.minutes >= 1 && g.minutes <= 60, 'ピリオド時間は1〜60分にしてください。');
  ensure(Number.isInteger(g.revision) && g.revision >= 0 && Number.isInteger(g.nextSeq) && g.nextSeq >= 1 && validTime(g.createdAt) && validTime(g.updatedAt), '試合メタデータが不正です。');
  validatePlayers(g.roster);
  const ids = new Set(g.roster.map(p => p.id));
  ensure(Array.isArray(g.starters) && (g.starters.length === 0 || g.starters.length === 5) && unique(g.starters) && g.starters.every(id => ids.has(id)), '先発は未設定または5人を選択してください。');
  ensure(Array.isArray(g.periods) && g.periods.length >= g.regulationCount && g.periods.length <= 50, 'ピリオド情報が不正です。');
  for (const p of g.periods) ensure(p && isId(p.id) && isText(p.label, 16) && Number.isFinite(p.minutes) && p.minutes >= 1 && p.minutes <= 60 && typeof p.overtime === 'boolean', 'ピリオド情報が不正です。');
  ensure(unique(g.periods.map(p => p.id)) && g.periods.some(p => p.id === g.currentPeriodId), '現在のピリオドが不正です。');
  ensure(Array.isArray(events) && unique(events.map(e => e.id)) && unique(events.map(e => e.seq)), 'イベントが重複しています。');
  for (const e of events) {
    ensure(e && isId(e.id) && e.gameId === g.id && g.periods.some(p => p.id === e.periodId) && validTime(e.timestamp) && Number.isInteger(e.seq) && e.seq > 0 && e.seq < g.nextSeq && (!e.deletedAt || validTime(e.deletedAt)), 'イベント情報が不正です。');
    if (e.eventType === 'OPP') ensure([1, 2, 3].includes(e.points) && e.playerId == null, '相手得点が不正です。');
    else if (e.eventType === 'SUB') ensure(ids.has(e.outPlayerId) && ids.has(e.inPlayerId) && e.outPlayerId !== e.inPlayerId && e.points === 0, '交代選手が不正です。');
    else ensure(Object.hasOwn(STATS, e.eventType) && ids.has(e.playerId) && e.points === STATS[e.eventType].points, 'スタッツイベントが不正です。');
  }
  lineup(g, events, true);
}
