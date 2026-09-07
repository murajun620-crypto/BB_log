import test from 'node:test';
import assert from 'node:assert/strict';
import { STATS, aggregate, percent, lineup, validateGame, validateTeam, makePeriods, uid } from '../js/domain.js';
import { backupObject, parseBackup, gameCSV } from '../js/transfer.js';
import { createSharedReport, createSharePayload, createCardSharePayload, createCompressedSharePayload, parseSharePayload, parseSharedReport } from '../js/shared-report.js';
import { createLineCardMessage, isLiffId, lineShareRedirectUri } from '../js/line-share.js';

const fixture = () => {
  const players = Array.from({ length: 6 }, (_, i) => ({ id: `player-${i}`, number: `${i + 4}`, name: `選手${i + 1}` }));
  const team = { id: 'team-1', name: 'HOOPS', revision: 0, players };
  const game = { id: 'game-1', teamId: team.id, teamName: team.name, opponentName: 'VISITORS', date: '2026-09-05', format: 'quarters', regulationCount: 4, minutes: 8, periods: makePeriods('quarters', 4, 8), roster: structuredClone(players), starters: players.slice(0, 5).map(p => p.id), currentPeriodId: '', status: 'live', revision: 0, nextSeq: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  game.currentPeriodId = game.periods[0].id;
  const events = [];
  const add = (type, extra = {}) => { const e = { id: uid(), gameId: game.id, periodId: game.currentPeriodId, eventType: type, playerId: ['OPP', 'SUB'].includes(type) ? null : players[0].id, points: STATS[type]?.points || 0, timestamp: new Date().toISOString(), seq: game.nextSeq++, ...extra }; events.push(e); return e; };
  return { team, game, events, add };
};

test('all 13 stat types aggregate accurately, independently of event input order', () => {
  const { game, events, add } = fixture();
  Object.keys(STATS).forEach(t => add(t)); add('OPP', { points: 3 });
  validateGame(game, events);
  const a = aggregate(game, [...events].reverse());
  assert.deepEqual(a.players['player-0'], { PTS: 6, FGM: 2, FGA: 4, P2M: 1, P2A: 2, P3M: 1, P3A: 2, FTM: 1, FTA: 2, OREB: 1, DREB: 1, REB: 2, AST: 1, STL: 1, BLK: 1, TO: 1, PF: 1 });
  assert.deepEqual(a.team, a.players['player-0']); assert.equal(a.opponent, 3);
  assert.equal(a.periods[0].home, 6); assert.equal(a.periods[0].away, 3);
  assert.equal(percent(24, 53), '45.3%'); assert.equal(percent(0, 0), '—'); assert.equal(percent(0, 1), '0.0%');
});
test('edits and soft deletions change score, player totals and periods without destroying the log', () => {
  const { game, events, add } = fixture();
  const shot = add('3PM'); add('2PM', { playerId: 'player-1' });
  add('OPP', { points: 2, deletedAt: new Date().toISOString() });
  shot.eventType = '2PX'; shot.points = 0; shot.periodId = game.periods[1].id;
  validateGame(game, events); const a = aggregate(game, events);
  assert.equal(a.team.PTS, 2); assert.equal(a.team.FGA, 2); assert.equal(a.team.FGM, 1);
  assert.equal(a.opponent, 0); assert.equal(events.length, 3);
});
test('substitutions support undo; deleting a prerequisite substitution is rejected', () => {
  const { game, events, add } = fixture();
  const first = add('SUB', { outPlayerId: 'player-0', inPlayerId: 'player-5' });
  const second = add('SUB', { outPlayerId: 'player-5', inPlayerId: 'player-0' });
  validateGame(game, events);
  first.deletedAt = new Date().toISOString();
  assert.throws(() => validateGame(game, events), /交代履歴/);
  delete first.deletedAt; second.deletedAt = new Date().toISOString();
  assert.deepEqual(lineup(game, events), ['player-1', 'player-2', 'player-3', 'player-4', 'player-5']);
  first.deletedAt = new Date().toISOString(); assert.deepEqual(lineup(game, events), game.starters);
});
test('halves, custom periods and overtime contribute to per-period scores', () => {
  const { game, events, add } = fixture();
  game.format = 'halves'; game.regulationCount = 2; game.minutes = 20; game.periods = makePeriods('halves', 2, 20);
  game.periods.push({ id: uid(), label: 'OT1', minutes: 5, overtime: true });
  game.currentPeriodId = game.periods[2].id; add('FTM'); add('OPP', { points: 2 });
  validateGame(game, events); const a = aggregate(game, events);
  assert.deepEqual(a.periods.map(p => p.label), ['1H', '2H', 'OT1']);
  assert.equal(a.periods[2].home, 1); assert.equal(a.periods[2].away, 2);
  assert.deepEqual(makePeriods('custom', 3, 7).map(p => p.label), ['P1', 'P2', 'P3']);
});
test('backup round trip preserves events, snapshots and settings', () => {
  const { team, game, events, add } = fixture(); add('3PM');
  const data = { teams: [team], games: [game], events, settings: [{ key: 'preferences', value: { continuous: false, theme: 'dark' } }, { key: 'lineShare', value: { liffId: '1234567890-AbCdEfgh' } }, { key: '_epoch', value: 23 }] };
  const restored = parseBackup(JSON.stringify(backupObject(data)));
  assert.deepEqual(restored.events, events); assert.deepEqual(restored.games, [game]);
  assert.equal(restored.settings.length, 2);
});
test('corrupt, mismatched, duplicate, unsupported and invalid lineup backups are rejected', () => {
  const { team, game, events, add } = fixture(); add('3PM');
  const original = backupObject({ teams: [team], games: [game], events, settings: [] });
  for (const corrupt of [
    d => { d.schemaVersion = 999; }, d => { d.events[0].points = 100; },
    d => { d.events[0].gameId = 'missing'; }, d => { d.events[0].playerId = 'missing'; },
    d => { d.events.push(d.events[0]); }, d => { d.games[0].date = '2026-02-30'; },
    d => { d.games[0].starters.pop(); }, d => { d.teams[0].players[0].id = '__proto__'; },
    d => { d.events[0].seq = d.games[0].nextSeq; }, d => { d.games[0].currentPeriodId = 'absent'; },
    d => { d.settings = [{ key: 'preferences', value: { theme: 'pink', continuous: false } }]; },
    d => { d.settings = [{ key: 'lineShare', value: { liffId: 'not-a-liff-id' } }]; },
  ]) {
    const copy = structuredClone(original); corrupt(copy); assert.throws(() => parseBackup(JSON.stringify(copy)));
  }
  assert.throws(() => parseBackup('{invalid'));
});
test('CSV includes every shooting metric, Japanese BOM, totals and safe escaping', () => {
  const { game, events, add } = fixture(); add('3PM');
  game.roster[0].name = '=HYPERLINK("bad")'; game.opponentName = '相手,チーム';
  const csv = gameCSV(game, events);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"2PM","2PA","2P%"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"')); assert.ok(csv.includes('"相手,チーム"'));
  assert.ok(csv.includes('"TEAM TOTAL"')); assert.ok(csv.includes('"Period"'));
});
test('private shared report contains aggregate stats without source IDs or event logs', async () => {
  const { game, events, add } = fixture(); add('3PM'); add('OREB'); add('OPP', { points: 2 });
  const shared = createSharedReport(game, events);
  const text = JSON.stringify(shared);
  assert.equal(text.includes(game.id), false); assert.equal(text.includes(game.roster[0].id), false); assert.equal(text.includes('events'), false);
  const report = parseSharedReport(text);
  assert.equal(report.team.PTS, 3); assert.equal(report.opponentScore, 2); assert.equal(report.players[0].stats.OREB, 1);
  const corrupt = structuredClone(shared); corrupt.report.team.PTS = 99;
  assert.throws(() => parseSharedReport(JSON.stringify(corrupt)), /形式が不正/);
  const payload = createSharePayload(game, events);
  const fromLink = await parseSharePayload(payload);
  assert.equal(fromLink.team.PTS, 3); assert.equal(fromLink.opponentScore, 2); assert.equal(fromLink.players[0].stats.OREB, 1);
  await assert.rejects(() => parseSharePayload(`${payload}x`));
});
test('compressed share payloads round trip and keep legacy payloads readable', async () => {
  const { game, events, add } = fixture();
  add('3PM'); add('OREB'); add('OPP', { points: 2 });
  const payload = await createCompressedSharePayload(game, events);
  assert.match(payload, /^v[12]\./);
  const report = await parseSharePayload(payload);
  assert.equal(report.team.PTS, 3); assert.equal(report.opponentScore, 2); assert.equal(report.players[0].stats.OREB, 1);
  const cardPayload = await createCardSharePayload(game, events);
  assert.match(cardPayload, /^v[123]\./);
  const cardReport = await parseSharePayload(cardPayload);
  assert.deepEqual(cardReport, report);
});
test('LINE card contains score, tap action and valid LIFF IDs only', () => {
  const { game, events, add } = fixture(); add('3PM'); add('OPP', { points: 2 });
  const [card] = createLineCardMessage({ game, summary: aggregate(game, events), url: 'https://example.com/#share/v3.abc' });
  assert.equal(card.type, 'flex'); assert.match(card.altText, /HOOPS 3 - 2 VISITORS/);
  assert.equal(card.contents.footer.contents[0].action.uri, 'https://example.com/#share/v3.abc');
  assert.throws(() => createLineCardMessage({ game, summary: aggregate(game, events), url: `https://example.com/${'x'.repeat(1000)}` }), /上限/);
  assert.equal(isLiffId('1234567890-AbCdEfgh'), true); assert.equal(isLiffId('bad'), false);
  assert.equal(lineShareRedirectUri({ liffId: '1234567890-AbCdEfgh', payload: 'v3.abc', locationHref: 'https://example.com/BB_log/#box/game-1' }), 'https://example.com/BB_log/#line-share/1234567890-AbCdEfgh/v3.abc');
  assert.throws(() => lineShareRedirectUri({ liffId: 'bad', payload: 'v3.abc', locationHref: 'https://example.com/' }), /作成できません/);
});
test('duplicate jersey numbers and incomplete player data cannot be saved', () => {
  const { team } = fixture(); validateTeam(team);
  team.players[1].number = team.players[0].number;
  assert.throws(() => validateTeam(team), /重複/);
});
