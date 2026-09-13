import { STATS, uid } from './domain.js';

// Cloud shares intentionally contain a summary rather than the private event
// log. Rebuild a local, finished game from that summary so it can be searched
// and displayed in the normal history/BOX SCORE views on the device.
const MAX_IMPORTED_EVENTS = 20000;
const NON_SCORING_TYPES = ['OREB', 'DREB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FD'];

function ensure(ok, message = '共有データを端末へ取り込めませんでした。') {
  if (!ok) throw new Error(message);
}

function gameFormat(format, periodCount) {
  const value = String(format || '');
  const match = value.match(/^(\d+)(Q|H|P)\s*[×x]\s*([\d.]+)分/);
  const count = Number(match?.[1]);
  const minutes = Number(match?.[3]);
  if (match && Number.isInteger(count) && count >= 1 && count <= 12 && Number.isFinite(minutes) && minutes >= 1 && minutes <= 60) {
    if (match[2] === 'Q' && count === 4) return { format: 'quarters', regulationCount: count, minutes };
    if (match[2] === 'H' && count === 2) return { format: 'halves', regulationCount: count, minutes };
    return { format: 'custom', regulationCount: count, minutes };
  }
  const fallbackCount = Math.min(Math.max(Number(periodCount) || 1, 1), 12);
  return { format: 'custom', regulationCount: fallbackCount, minutes: 8 };
}

function importedPeriods(detail) {
  const info = gameFormat(detail.format, detail.periods.length);
  return { ...info, periods: detail.periods.map((period, index) => ({
    id: uid(),
    label: period.label,
    minutes: info.minutes,
    overtime: index >= info.regulationCount,
  })) };
}

function shotType(shot) {
  return shot.zone?.startsWith('three-') ? '3' : '2';
}

function eventDescriptor(type, playerId, extra = {}) {
  return { eventType: type, playerId, points: STATS[type]?.points || 0, ...extra };
}

function addRepeated(list, type, count, playerId) {
  ensure(Number.isSafeInteger(count) && count >= 0, '共有データのスタッツが不正です。');
  for (let index = 0; index < count; index += 1) list.push(eventDescriptor(type, playerId));
}

function shotCounts(shots, playerId) {
  const counts = { twoMade: 0, twoMiss: 0, threeMade: 0, threeMiss: 0 };
  for (const shot of shots || []) {
    if (shot.playerId !== playerId) continue;
    const prefix = shotType(shot);
    const key = `${prefix === '3' ? 'three' : 'two'}${shot.result === 'made' ? 'Made' : 'Miss'}`;
    counts[key] += 1;
  }
  return counts;
}

function playerEvents(detail, playerIds) {
  const shots = Array.isArray(detail.shots) ? detail.shots : [];
  const result = [];
  for (const player of detail.players) {
    const localId = playerIds.get(player.id);
    ensure(localId, '共有データの選手が見つかりません。');
    const stats = player.stats;
    const counts = shotCounts(shots, player.id);
    ensure(counts.twoMade <= stats.P2M && counts.twoMade + counts.twoMiss <= stats.P2A && counts.threeMade <= stats.P3M && counts.threeMade + counts.threeMiss <= stats.P3A, '共有データのシュート内訳がスタッツと一致しません。');
    for (const shot of shots.filter(candidate => candidate.playerId === player.id)) {
      const type = `${shotType(shot)}P${shot.result === 'made' ? 'M' : 'X'}`;
      result.push(eventDescriptor(type, localId, {
        shotZone: shot.zone,
        ...(Number.isFinite(shot.x) && Number.isFinite(shot.y) ? { shotX: shot.x, shotY: shot.y } : {}),
        ...(shot.direction ? { shotDirection: shot.direction } : {}),
      }));
    }
    addRepeated(result, '2PM', stats.P2M - counts.twoMade, localId);
    addRepeated(result, '2PX', stats.P2A - stats.P2M - counts.twoMiss, localId);
    addRepeated(result, '3PM', stats.P3M - counts.threeMade, localId);
    addRepeated(result, '3PX', stats.P3A - stats.P3M - counts.threeMiss, localId);
    addRepeated(result, 'FTM', stats.FTM, localId);
    addRepeated(result, 'FTX', stats.FTA - stats.FTM, localId);
    for (const type of NON_SCORING_TYPES) addRepeated(result, type, stats[type], localId);
  }
  return result;
}

function scorePieces(score) {
  ensure(Number.isSafeInteger(score) && score >= 0 && score <= MAX_IMPORTED_EVENTS * 3, '共有データの得点が大きすぎるため、端末へ取り込めません。');
  let remaining = score;
  const pieces = [];
  while (remaining >= 3) { pieces.push(3); remaining -= 3; }
  if (remaining >= 2) { pieces.push(2); remaining -= 2; }
  if (remaining === 1) pieces.push(1);
  return pieces;
}

function pointCounts(descriptors) {
  return {
    1: descriptors.filter(event => event.points === 1).length,
    2: descriptors.filter(event => event.points === 2).length,
    3: descriptors.filter(event => event.points === 3).length,
  };
}

function countKey(counts) {
  return `${counts[1]},${counts[2]},${counts[3]}`;
}

function candidateValues(min, max, target) {
  if (max < min) return [];
  if (max - min <= 180) return Array.from({ length: max - min + 1 }, (_, index) => max - index);
  const values = new Set([min, max, Math.floor((min + max) / 2), Math.min(max, Math.max(min, Math.floor(target / 2))) ]);
  for (let offset = 1; offset <= 24; offset += 1) { values.add(Math.max(min, max - offset)); values.add(Math.min(max, min + offset)); }
  return [...values].sort((a, b) => b - a);
}

// Find how many 1/2/3-point events belong to each period. The bounded search
// keeps ordinary games exact while avoiding an expensive search on corrupted
// or hostile snapshots.
function allocatePointCounts(targets, initial) {
  let visited = 0;
  const memo = new Set();
  const solve = (index, counts) => {
    if (++visited > 12000) return null;
    const key = `${index}|${countKey(counts)}`;
    if (memo.has(key)) return null;
    memo.add(key);
    if (index === targets.length - 1) {
      return counts[1] + counts[2] * 2 + counts[3] * 3 === targets[index] ? [counts] : null;
    }
    const target = targets[index];
    const maxThrees = Math.min(counts[3], Math.floor(target / 3));
    for (const threes of candidateValues(0, maxThrees, target)) {
      const remainder = target - threes * 3;
      const minTwos = Math.max(0, Math.ceil((remainder - counts[1]) / 2));
      const maxTwos = Math.min(counts[2], Math.floor(remainder / 2));
      for (const twos of candidateValues(minTwos, maxTwos, remainder)) {
        const ones = remainder - twos * 2;
        if (ones < 0 || ones > counts[1]) continue;
        const next = { 1: counts[1] - ones, 2: counts[2] - twos, 3: counts[3] - threes };
        const tail = solve(index + 1, next);
        if (tail) return [{ 1: ones, 2: twos, 3: threes }, ...tail];
      }
    }
    return null;
  };
  return solve(0, initial);
}

function assignHomePeriods(descriptors, periods) {
  const scoring = descriptors.filter(event => event.points > 0);
  const targets = periods.map(period => period.home);
  const counts = pointCounts(scoring);
  const plan = allocatePointCounts(targets, counts);
  ensure(plan, '共有データのピリオド得点を端末内記録へ変換できません。');
  const buckets = { 1: [], 2: [], 3: [] };
  for (const event of scoring) buckets[event.points].push(event);
  const assigned = new Set();
  plan.forEach((periodPlan, periodIndex) => {
    for (const points of [1, 2, 3]) {
      for (let index = 0; index < periodPlan[points]; index += 1) {
        const event = buckets[points].shift();
        ensure(event, '共有データの得点イベントを割り当てられません。');
        event.periodIndex = periodIndex;
        assigned.add(event);
      }
    }
  });
  ensure(assigned.size === scoring.length, '共有データの得点イベントが不足しています。');
  let nonScoringIndex = 0;
  for (const event of descriptors) if (!assigned.has(event)) event.periodIndex = nonScoringIndex++ % periods.length;
}

function materializeEvents(descriptors, game, detail, now) {
  const events = [];
  assignHomePeriods(descriptors, detail.periods);
  descriptors.forEach((descriptor, index) => events.push({
    id: uid(), gameId: game.id, periodId: game.periods[descriptor.periodIndex].id,
    eventType: descriptor.eventType, playerId: descriptor.playerId, points: descriptor.points,
    timestamp: now, seq: index + 1, ...(descriptor.shotZone ? { shotZone: descriptor.shotZone } : {}),
    ...(descriptor.shotX !== undefined ? { shotX: descriptor.shotX, shotY: descriptor.shotY } : {}),
    ...(descriptor.shotDirection ? { shotDirection: descriptor.shotDirection } : {}),
  }));
  let sequence = events.length;
  detail.periods.forEach((period, periodIndex) => {
    for (const points of scorePieces(period.away)) events.push({
      id: uid(), gameId: game.id, periodId: game.periods[periodIndex].id, eventType: 'OPP', playerId: null,
      points, timestamp: now, seq: ++sequence,
    });
  });
  ensure(events.length <= MAX_IMPORTED_EVENTS, '共有データが大きすぎるため、端末へ取り込めません。');
  return events;
}

function localPlayersFor(report, existingTeam) {
  if (!existingTeam) return report.players.map(player => ({ id: uid(), number: player.number, name: player.name }));
  const byIdentity = new Map(existingTeam.players.map(player => [`${player.number}\u0000${player.name}`, player]));
  return report.players.map(player => {
    const existing = byIdentity.get(`${player.number}\u0000${player.name}`);
    ensure(existing, '既存チームの選手構成と共有データが一致しません。');
    return structuredClone(existing);
  });
}

function buildGame(detail, team, players, playerIds, sourceId, sourceTitle, now) {
  const setup = importedPeriods(detail);
  const game = {
    id: uid(), teamId: team.id, teamName: detail.teamName, opponentName: detail.opponentName,
    date: detail.date, format: setup.format, regulationCount: setup.regulationCount, minutes: setup.minutes,
    periods: setup.periods, currentPeriodId: setup.periods.at(-1).id, roster: structuredClone(players),
    starters: players.length >= 5 ? players.slice(0, 5).map(player => player.id) : [],
    mode: 'standard', opponentTracking: 'score', status: 'finished', nextSeq: 1, revision: 0,
    createdAt: now, updatedAt: now, importedFromShareId: sourceId, importedShareTitle: sourceTitle,
  };
  const descriptors = playerEvents(detail, playerIds);
  const events = materializeEvents(descriptors, game, detail, now);
  game.nextSeq = events.length + 1;
  return { game, events };
}

export function buildImportedRecords(report, { existingTeam = null, sourceId = '', sourceTitle = '' } = {}) {
  ensure(report && Array.isArray(report.players) && report.players.length >= 1, '共有データの選手情報が不正です。');
  const details = Array.isArray(report.games) && report.games.length ? report.games : [report];
  const players = localPlayersFor(report, existingTeam);
  const team = existingTeam ? structuredClone(existingTeam) : { id: uid(), name: report.teamName, revision: 0, players: structuredClone(players) };
  const playerIds = new Map(report.players.map((player, index) => [player.id, players[index].id]));
  const now = new Date().toISOString();
  const games = [];
  const events = [];
  for (const detail of details) {
    const built = buildGame(detail, team, players, playerIds, sourceId, sourceTitle, now);
    games.push(built.game); events.push(...built.events);
  }
  return { team: existingTeam ? null : team, games, events };
}
