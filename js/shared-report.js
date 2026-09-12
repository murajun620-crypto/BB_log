import { aggregate, aggregateGames, blankStats, formatGame, normalizeShotZone, shotZoneForEvent, SHOT_ZONE_IDS } from './domain.js';

const STAT_KEYS = Object.keys(blankStats());
const BASE_STAT_KEYS = ['P2M', 'P2A', 'P3M', 'P3A', 'FTM', 'FTA', 'OREB', 'DREB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FD'];
const MAX_FILE_SIZE = 1024 * 1024;
const MAX_PAYLOAD_SIZE = 120000;

const statsCopy = stats => Object.fromEntries(STAT_KEYS.map(key => [key, stats[key]]));
function shotsCopy(game, events) {
  const playerIds = new Map(game.roster.map((player, index) => [player.id, `p${index + 1}`]));
  return events.filter(event => !event.deletedAt && playerIds.has(event.playerId) && ['2PM', '2PX', '3PM', '3PX'].includes(event.eventType)).map(event => {
    const zone = shotZoneForEvent(event);
    if (!SHOT_ZONE_IDS.has(zone)) return null;
    const shot = { playerId: playerIds.get(event.playerId), zone, result: event.eventType.endsWith('M') ? 'made' : 'miss' };
    if ([event.shotX, event.shotY].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) { shot.x = event.shotX; shot.y = event.shotY; }
    return shot;
  }).filter(Boolean);
}

export function createSharedReport(game, events) {
  const summary = aggregate(game, events);
  return {
    app: 'courtside-report',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    report: {
      date: game.date,
      format: formatGame(game),
      status: game.status,
      gameCount: 1,
      teamName: game.teamName,
      opponentName: game.opponentName,
      opponentScore: summary.opponent,
      periods: summary.periods.map(period => ({ label: period.label, home: period.home, away: period.away })),
      team: statsCopy(summary.team),
      shots: shotsCopy(game, events),
      players: game.roster.map((player, index) => ({
        id: `p${index + 1}`,
        number: player.number,
        name: player.name,
        stats: statsCopy(summary.players[player.id]),
      })),
    },
  };
}
export function createAggregateSharedReport(games, events, tournamentName = '') {
  const summary = aggregateGames(games, events);
  const date = [...games].map(game => game.date).sort().at(-1) || new Date().toISOString().slice(0, 10);
  const gameReports = games.map(game => {
    const gameSummary = aggregate(game, events.filter(event => event.gameId === game.id));
    return {
      date: game.date,
      format: formatGame(game),
      status: game.status,
      gameCount: 1,
      teamName: game.teamName,
      opponentName: game.opponentName,
      opponentScore: gameSummary.opponent,
      periods: gameSummary.periods.map(period => ({ label: period.label, home: period.home, away: period.away })),
      team: statsCopy(gameSummary.team),
      shots: shotsCopy(game, events.filter(event => event.gameId === game.id)),
      players: summary.players.map((player, index) => ({ id: `p${index + 1}`, number: player.number, name: player.name, stats: statsCopy(gameSummary.players[player.id] || blankStats()) })),
    };
  });
  return {
    app: 'courtside-report',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    report: {
      date,
      format: `${games.length}試合合計`,
      status: games.some(game => game.status === 'live') ? 'live' : 'finished',
      gameCount: games.length,
      tournamentName: String(tournamentName || '').trim(),
      games: gameReports,
      teamName: summary.teamName,
      opponentName: '相手合計',
      opponentScore: summary.opponent,
      periods: [{ label: '合計', home: summary.team.PTS, away: summary.opponent }],
      team: statsCopy(summary.team),
      shots: games.flatMap(game => shotsCopy(game, events.filter(event => event.gameId === game.id))),
      players: summary.players.map((player, index) => ({ id: `p${index + 1}`, number: player.number, name: player.name, stats: statsCopy(player.stats) })),
    },
  };
}

function ensure(ok) {
  if (!ok) throw new Error('共有レポートの形式が不正です。');
}

function validText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function validateStats(stats) {
  ensure(stats && typeof stats === 'object' && STAT_KEYS.every(key => key === 'FD' && stats[key] === undefined || Number.isSafeInteger(stats[key]) && stats[key] >= 0 && stats[key] <= 999999));
  ensure(stats.FGM === stats.P2M + stats.P3M && stats.FGA === stats.P2A + stats.P3A);
  ensure(stats.FGM <= stats.FGA && stats.P2M <= stats.P2A && stats.P3M <= stats.P3A && stats.FTM <= stats.FTA);
  ensure(stats.REB === stats.OREB + stats.DREB && stats.PTS === stats.P2M * 2 + stats.P3M * 3 + stats.FTM);
}
function validDate(value) {
  const parsedDate = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsedDate.valueOf()) && parsedDate.toISOString().slice(0, 10) === value;
}
function validatePlayers(players) {
  ensure(Array.isArray(players) && players.length >= 1);
  ensure(new Set(players.map(player => player?.id)).size === players.length);
  for (const player of players) {
    ensure(player && /^p\d{1,2}$/.test(player.id) && /^\d{1,3}$/.test(player.number) && validText(player.name, 40));
    validateStats(player.stats);
  }
}
function validateShots(shots, players) {
  if (shots === undefined) return;
  ensure(Array.isArray(shots) && shots.length <= 2000);
  const ids = new Set(players.map(player => player.id));
  for (const shot of shots) {
    ensure(shot && ids.has(shot.playerId) && SHOT_ZONE_IDS.has(shot.zone) && ['made', 'miss'].includes(shot.result));
    if (shot.x !== undefined || shot.y !== undefined) ensure([shot.x, shot.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  }
}

export function parseSharedReport(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE_SIZE) throw new Error('共有レポートは1MB以下にしてください。');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('共有レポートを読み取れませんでした。'); }
  ensure(data?.app === 'courtside-report' && data.schemaVersion === 1 && data.report && typeof data.report === 'object');
  const report = data.report;
  const parsedDate = new Date(`${report.date}T00:00:00Z`);
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(report.date) && !Number.isNaN(parsedDate.valueOf()) && parsedDate.toISOString().slice(0, 10) === report.date);
  ensure(validText(report.format, 40) && ['live', 'finished'].includes(report.status));
  ensure(report.gameCount === undefined || (Number.isSafeInteger(report.gameCount) && report.gameCount >= 1 && report.gameCount <= 999));
  ensure(report.tournamentName === undefined || (typeof report.tournamentName === 'string' && report.tournamentName.length <= 40));
  ensure(validText(report.teamName, 40) && validText(report.opponentName, 40));
  ensure(Number.isSafeInteger(report.opponentScore) && report.opponentScore >= 0 && report.opponentScore <= 999999);
  ensure(Array.isArray(report.periods) && report.periods.length >= 1 && report.periods.length <= 50);
  for (const period of report.periods) ensure(period && validText(period.label, 12) && Number.isSafeInteger(period.home) && period.home >= 0 && period.home <= 999999 && Number.isSafeInteger(period.away) && period.away >= 0 && period.away <= 999999);
  ensure(Array.isArray(report.players) && report.players.length >= 1);
  ensure(new Set(report.players.map(player => player?.id)).size === report.players.length);
  for (const player of report.players) {
    ensure(player && /^p\d{1,2}$/.test(player.id) && /^\d{1,3}$/.test(player.number) && validText(player.name, 40));
    validateStats(player.stats);
  }
  validateShots(report.shots, report.players);
  if (report.games !== undefined) {
    ensure(Array.isArray(report.games) && report.games.length === (report.gameCount || 1) && report.games.length <= 999);
    for (const detail of report.games) {
      ensure(detail && validDate(detail.date) && validText(detail.format, 40) && ['live', 'finished'].includes(detail.status));
      ensure(validText(detail.teamName, 40) && validText(detail.opponentName, 40));
      ensure(Number.isSafeInteger(detail.opponentScore) && detail.opponentScore >= 0 && detail.opponentScore <= 999999);
      ensure(Array.isArray(detail.periods) && detail.periods.length >= 1 && detail.periods.length <= 50);
      for (const period of detail.periods) ensure(period && validText(period.label, 12) && Number.isSafeInteger(period.home) && period.home >= 0 && period.home <= 999999 && Number.isSafeInteger(period.away) && period.away >= 0 && period.away <= 999999);
      ensure(detail.team && typeof detail.team === 'object');
      validateStats(detail.team);
      validatePlayers(detail.players);
      validateShots(detail.shots, detail.players);
      ensure(detail.players.length === report.players.length && detail.players.every((player, index) => player.id === report.players[index].id));
      for (const key of STAT_KEYS) ensure(detail.players.reduce((sum, player) => sum + (player.stats[key] ?? 0), 0) === (detail.team[key] ?? 0));
      ensure(detail.periods.reduce((sum, period) => sum + period.home, 0) === detail.team.PTS);
      ensure(detail.periods.reduce((sum, period) => sum + period.away, 0) === detail.opponentScore);
    }
  }
  validateStats(report.team);
  for (const key of STAT_KEYS) ensure(report.players.reduce((sum, player) => sum + (player.stats[key] ?? 0), 0) === (report.team[key] ?? 0));
  ensure(report.periods.reduce((sum, period) => sum + period.home, 0) === report.team.PTS);
  ensure(report.periods.reduce((sum, period) => sum + period.away, 0) === report.opponentScore);
  const normalized = structuredClone(report);
  normalized.gameCount = report.gameCount || 1;
  const normalizeStats = stats => { if (stats && stats.FD === undefined) stats.FD = 0; };
  normalizeStats(normalized.team);
  normalized.players.forEach(player => normalizeStats(player.stats));
  normalized.games?.forEach(detail => { normalizeStats(detail.team); detail.players.forEach(player => normalizeStats(player.stats)); });
  if (Array.isArray(normalized.shots)) normalized.shots = normalized.shots.map(shot => ({ ...shot, zone: normalizeShotZone(shot.zone) }));
  if (Array.isArray(normalized.games)) for (const detail of normalized.games) if (Array.isArray(detail.shots)) detail.shots = detail.shots.map(shot => ({ ...shot, zone: normalizeShotZone(shot.zone) }));
  return normalized;
}

function statsArray(stats) {
  return STAT_KEYS.map(key => stats[key]);
}

function statsObject(values) {
  ensure(Array.isArray(values) && (values.length === STAT_KEYS.length || values.length === STAT_KEYS.length - 1));
  return Object.fromEntries(STAT_KEYS.map((key, index) => [key, values[index] || 0]));
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64ToBytes(value) {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function compactReport(game, events) {
  const report = createSharedReport(game, events).report;
  return {
    v: 1,
    d: report.date,
    f: report.format,
    s: report.status,
    t: report.teamName,
    o: report.opponentName,
    q: report.opponentScore,
    p: report.periods.map(period => [period.label, period.home, period.away]),
    a: statsArray(report.team),
    r: report.players.map(player => [player.number, player.name, statsArray(player.stats)]),
    z: report.shots?.map(shot => [Number(shot.playerId.slice(1)) - 1, shot.zone, shot.result === 'made' ? 1 : 0, shot.x, shot.y]),
  };
}

function compactBytes(game, events) {
  return new TextEncoder().encode(JSON.stringify(compactReport(game, events)));
}

export function createSharePayload(game, events) {
  return `v1.${bytesToBase64(compactBytes(game, events))}`;
}

async function deflate(bytes) {
  const stream = new CompressionStream('deflate');
  const output = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(bytes); await writer.close();
  return new Uint8Array(await output);
}

async function inflate(bytes) {
  if (!globalThis.DecompressionStream) throw new Error('このブラウザは圧縮リンクに対応していません。');
  const stream = new DecompressionStream('deflate');
  const output = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(bytes); await writer.close();
  return new Uint8Array(await output);
}

export async function createCompressedSharePayload(game, events) {
  const bytes = compactBytes(game, events);
  if (!globalThis.CompressionStream) return createSharePayload(game, events);
  try {
    const compressed = await deflate(bytes);
    return compressed.length < bytes.length ? `v2.${bytesToBase64(compressed)}` : createSharePayload(game, events);
  } catch { return createSharePayload(game, events); }
}

function formatLabel(format, count, minutes) {
  const prefix = format === 'quarters' ? '4Q' : format === 'halves' ? '2H' : `${count}P`;
  return `${prefix} × ${minutes}分`;
}

function periodLabel(format, regulationCount, index) {
  if (index >= regulationCount) return `OT${index - regulationCount + 1}`;
  if (format === 'quarters') return `Q${index + 1}`;
  if (format === 'halves') return `${index + 1}H`;
  return `P${index + 1}`;
}

function expandBaseStats(values) {
  ensure(Array.isArray(values) && (values.length === BASE_STAT_KEYS.length || values.length === BASE_STAT_KEYS.length - 1));
  const stats = Object.fromEntries(BASE_STAT_KEYS.map((key, index) => [key, values[index] || 0]));
  stats.FGM = stats.P2M + stats.P3M;
  stats.FGA = stats.P2A + stats.P3A;
  stats.PTS = stats.P2M * 2 + stats.P3M * 3 + stats.FTM;
  stats.REB = stats.OREB + stats.DREB;
  return stats;
}

function totalStats(players) {
  const team = blankStats();
  for (const player of players) for (const key of STAT_KEYS) team[key] += player.stats[key];
  return team;
}

function parseCardCompact(compact) {
  ensure(Array.isArray(compact) && compact.length === 10 && compact[0] === 3);
  const [, date, format, regulationCount, minutes, status, teamName, opponentName, periodScores, compactPlayers] = compact;
  ensure(['quarters', 'halves', 'custom'].includes(format) && Number.isInteger(regulationCount) && regulationCount >= 1 && regulationCount <= 12 && (format === 'custom' || regulationCount === (format === 'quarters' ? 4 : 2)) && Number.isFinite(minutes) && minutes >= 1 && minutes <= 60 && [0, 1].includes(status));
  ensure(Array.isArray(periodScores) && periodScores.length >= regulationCount && periodScores.length <= 50 && Array.isArray(compactPlayers));
  const players = compactPlayers.map((player, index) => ({
    id: `p${index + 1}`,
    number: player?.[0],
    name: player?.[1],
    stats: expandBaseStats(player?.[2]),
  }));
  const periods = periodScores.map((score, index) => ({ label: periodLabel(format, regulationCount, index), home: score?.[0], away: score?.[1] }));
  const report = {
    date,
    format: formatLabel(format, regulationCount, minutes),
    status: status ? 'finished' : 'live',
    teamName,
    opponentName,
    opponentScore: periods.reduce((sum, period) => sum + period.away, 0),
    periods,
    team: totalStats(players),
    players,
  };
  return parseSharedReport(JSON.stringify({ app: 'courtside-report', schemaVersion: 1, report }));
}

export async function parseSharePayload(payload) {
  if (typeof payload !== 'string' || payload.length < 4 || payload.length > MAX_PAYLOAD_SIZE || !/^v[123]\./.test(payload)) throw new Error('共有リンクの形式が不正です。');
  let compact;
  try {
    let bytes = base64ToBytes(payload.slice(3));
    if (payload.startsWith('v2.') || payload.startsWith('v3.')) bytes = await inflate(bytes);
    compact = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error.message === 'このブラウザは圧縮リンクに対応していません。') throw error;
    throw new Error('共有リンクを読み取れませんでした。');
  }
  if (payload.startsWith('v3.')) return parseCardCompact(compact);
  ensure(compact?.v === 1 && Array.isArray(compact.p) && Array.isArray(compact.r));
  const report = {
    date: compact.d,
    format: compact.f,
    status: compact.s,
    teamName: compact.t,
    opponentName: compact.o,
    opponentScore: compact.q,
    periods: compact.p.map(period => ({ label: period[0], home: period[1], away: period[2] })),
    team: statsObject(compact.a),
    players: compact.r.map((player, index) => ({ id: `p${index + 1}`, number: player[0], name: player[1], stats: statsObject(player[2]) })),
    shots: Array.isArray(compact.z) ? compact.z.map(shot => ({ playerId: `p${shot[0] + 1}`, zone: shot[1], result: shot[2] ? 'made' : 'miss', ...(Number.isFinite(shot[3]) && Number.isFinite(shot[4]) ? { x: shot[3], y: shot[4] } : {}) })) : undefined,
  };
  return parseSharedReport(JSON.stringify({ app: 'courtside-report', schemaVersion: 1, report }));
}

export function sharedReportFile(data, filename) {
  return new File([JSON.stringify(data)], filename, { type: 'application/json' });
}
