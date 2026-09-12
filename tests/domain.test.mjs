import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATS, SHOT_ZONES, aggregate, aggregateGames, attackDirectionForPeriod, eventLabel, fullCourtPointFromHalf, halfCourtPointFromFull, isBackcourtPoint, normalizeShotZone, opponentLineup, oppositeDirection, percent, lineup, validateGame, validateTeam, makePeriods, shotPointsFromPoint, shotZoneForEvent, shotZoneFromPoint, uid } from '../js/domain.js';
import { backupObject, parseBackup, gameCSV } from '../js/transfer.js';
import { createSharedReport, createAggregateSharedReport, createSharePayload, createCompressedSharePayload, parseSharePayload, parseSharedReport } from '../js/shared-report.js';
import { gameFormView, isIPhonePortrait, isIPhoneUserAgent, PRO_HALF_COURT_MARKINGS, liveSettingsHTML, proLiveView, shotZonePicker, shotChartMapHTML, strategyBoardHTML } from '../js/views.js';

const fixture = () => {
  const players = Array.from({ length: 6 }, (_, i) => ({ id: `player-${i}`, number: `${i + 4}`, name: `選手${i + 1}` }));
  const team = { id: 'team-1', name: 'HOOPS', revision: 0, players };
  const game = { id: 'game-1', teamId: team.id, teamName: team.name, opponentName: 'VISITORS', date: '2026-09-05', format: 'quarters', regulationCount: 4, minutes: 8, periods: makePeriods('quarters', 4, 8), roster: structuredClone(players), starters: players.slice(0, 5).map(p => p.id), currentPeriodId: '', status: 'live', revision: 0, nextSeq: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  game.currentPeriodId = game.periods[0].id;
  const events = [];
  const add = (type, extra = {}) => { const e = { id: uid(), gameId: game.id, periodId: game.currentPeriodId, eventType: type, playerId: ['OPP', 'SUB'].includes(type) ? null : players[0].id, points: STATS[type]?.points || 0, timestamp: new Date().toISOString(), seq: game.nextSeq++, ...extra }; events.push(e); return e; };
  return { team, game, events, add };
};
const proLiveCss = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

test('all 14 stat types aggregate accurately, independently of event input order', () => {
  const { game, events, add } = fixture();
  Object.keys(STATS).forEach(t => add(t)); add('OPP', { points: 3 });
  validateGame(game, events);
  const a = aggregate(game, [...events].reverse());
  assert.deepEqual(a.players['player-0'], { PTS: 6, FGM: 2, FGA: 4, P2M: 1, P2A: 2, P3M: 1, P3A: 2, FTM: 1, FTA: 2, OREB: 1, DREB: 1, REB: 2, AST: 1, STL: 1, BLK: 1, TO: 1, PF: 1, FD: 1 });
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
test('Pro games preserve clock, opponent player stats and exact shot positions', async () => {
  const { game, events, add } = fixture();
  game.mode = 'pro'; game.clockEnabled = true; game.clockSeconds = 480; game.clockRunning = false; game.clockStartedAt = null;
  game.attackDirection = 'right';
  game.opponentTracking = 'player'; game.opponentRoster = [{ id: 'opponent-1', number: '8', name: '相手選手' }];
  add('3PM', { shotX: .68, shotY: .5, shotZone: shotZoneFromPoint('3PM', .68, .5), clockSeconds: 431 });
  events.push({ id: uid(), gameId: game.id, periodId: game.currentPeriodId, eventType: '2PM', playerId: 'opponent-1', side: 'opponent', points: 2, timestamp: new Date().toISOString(), seq: game.nextSeq++, shotX: .1, shotY: .5, shotZone: shotZoneFromPoint('2PM', .1, .5), clockSeconds: 420 });
  validateGame(game, events);
  const a = aggregate(game, events);
  assert.equal(a.team.PTS, 3); assert.equal(a.opponent, 2); assert.equal(a.opponentPlayers['opponent-1'].PTS, 2);
  assert.equal(events[0].shotZone, 'three-top'); assert.equal(events[0].shotX, .68); assert.equal(events[1].shotZone, 'rim');
  assert.equal(shotZoneFromPoint('3PM', .5, .25), 'three-left-wing');
  assert.equal(shotZoneFromPoint('3PM', .3, 56 / 500), 'three-left-wing');
  assert.equal(shotZoneFromPoint('3PM', .3, 60 / 500), 'three-left-wing');
  assert.equal(shotZoneFromPoint(null, .27, 176 / 500), 'two-left-wing');
  assert.equal(shotZoneFromPoint(null, .27, 180 / 500), 'two-left-wing');
  assert.equal(shotZoneFromPoint(null, 170 / 940, 90 / 500), 'two-left-corner');
  assert.equal(shotZoneFromPoint(null, 210 / 940, 90 / 500), 'two-left-corner');
  assert.equal(shotZoneFromPoint(null, 211 / 940, 90 / 500), 'two-left-wing');
  assert.equal(shotZoneFromPoint(null, 170 / 940, 100 / 500), 'two-left-wing');
  assert.equal(shotZoneFromPoint(null, 240 / 940, 120 / 500), 'two-left-wing');
  assert.equal(shotZoneFromPoint('3PM', 140 / 940, 35 / 500), 'three-left-corner');
  assert.equal(shotZoneFromPoint('3PM', 140 / 940, 50 / 500), 'three-left-wing');
  assert.equal(shotZoneFromPoint('3PM', 145 / 940, 48 / 500), 'three-left-corner');
  assert.equal(shotZoneFromPoint('3PM', 210 / 940, 48 / 500), 'three-left-corner');
  assert.equal(shotZoneFromPoint('3PM', 211 / 940, 48 / 500), 'three-left-wing');
  assert.equal(shotZoneFromPoint(null, 140 / 940, 40 / 500), 'three-left-corner');
  assert.equal(shotZoneFromPoint(null, 300 / 940, 40 / 500), 'three-left-wing');
  assert.equal(shotZoneForEvent({ eventType: '3PM', shotZone: 'three-left-corner', shotX: .3, shotY: .15 }), 'three-left-wing');
  const correctedShared = createSharedReport(game, [{ ...events[0], shotX: .3, shotY: .15, shotZone: 'three-left-corner' }]);
  assert.equal(correctedShared.report.shots[0].zone, 'three-left-wing');
  assert.equal(shotPointsFromPoint(.5, .5), 3); assert.equal(shotPointsFromPoint(.2, .5), 2);
  assert.equal(shotPointsFromPoint(.12, .08), 3); assert.equal(shotPointsFromPoint(.3, .5), 2);
  assert.equal(shotPointsFromPoint(.31, .5), 2); assert.equal(shotPointsFromPoint(.33, .5), 3); assert.equal(shotPointsFromPoint(.7, .5), 2);
  assert.equal(shotZoneFromPoint(null, 74 / 940, .5), 'rim'); assert.equal(shotZoneFromPoint(null, 180 / 940, .5), 'paint');
  const pointShared = createSharedReport(game, [events[0]]);
  assert.deepEqual(pointShared.report.shots[0], { playerId: 'p1', zone: 'two-top', result: 'made', x: .68, y: .5 });
  const pointPayload = await createCompressedSharePayload(game, [events[0]]);
  const parsedPointPayload = await parseSharePayload(pointPayload);
  assert.deepEqual(parsedPointPayload.shots, pointShared.report.shots);
  assert.equal((shotChartMapHTML(parsedPointPayload.shots).match(/data-action="toggle-shot-display"/g) || []).length, 2);
  assert.equal(attackDirectionForPeriod(game), 'right'); assert.equal(attackDirectionForPeriod(game, game.periods[2].id), 'left');
  game.attackDirection = 'left'; assert.equal(attackDirectionForPeriod(game, game.periods[2].id), 'right');
});
test('phone landscape half-court mapping puts either attacking basket at the top', () => {
  const leftBasket = halfCourtPointFromFull(74 / 940, .5, 'left');
  const rightBasket = halfCourtPointFromFull(866 / 940, .5, 'right');
  assert.deepEqual(leftBasket, { x: 250, y: 74 });
  assert.deepEqual(rightBasket, { x: 250, y: 74 });
  const leftShot = fullCourtPointFromHalf(250, 74, 'left');
  const rightShot = fullCourtPointFromHalf(250, 74, 'right');
  assert.ok(Math.abs(leftShot.x - 74 / 940) < 1e-12); assert.equal(leftShot.y, .5);
  assert.ok(Math.abs(rightShot.x - 866 / 940) < 1e-12); assert.equal(rightShot.y, .5);
  assert.equal(oppositeDirection('left'), 'right'); assert.equal(oppositeDirection('right'), 'left');
});
test('only portrait iPhones use the Pro half court and its markings face the upper basket', () => {
  assert.equal(isIPhoneUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), true);
  assert.equal(isIPhoneUserAgent('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)'), true);
  assert.equal(isIPhoneUserAgent('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'), false);
  assert.equal(isIPhoneUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)'), false);
  assert.equal(isIPhonePortrait('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', true), true);
  assert.equal(isIPhonePortrait('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', false), false);
  assert.equal(isIPhonePortrait('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', true), false);
  assert.match(PRO_HALF_COURT_MARKINGS, /M0 24H500V476H0ZM48 24V145M452 24V145M452 145A230 230 0 0 1 48 145/);
  const fullCourt = proLiveView({}, fixture().game, []);
  assert.match(fullCourt, /pro-court-surface" x="24" y="0" width="892" height="500"/);
  assert.match(fullCourt, /M24 0H916V500H24ZM470 0V500M24 48H145/);
  assert.match(PRO_HALF_COURT_MARKINGS, /M304 210A54 54 0 0 1 196 210/);
  assert.match(PRO_HALF_COURT_MARKINGS, /M287 74A37 37 0 0 1 213 74/);
});
test('Pro shot selection treats the center line and the defending half as backcourt', () => {
  assert.equal(isBackcourtPoint('right', .5), true);
  assert.equal(isBackcourtPoint('right', .49), true);
  assert.equal(isBackcourtPoint('right', .51), false);
  assert.equal(isBackcourtPoint('left', .5), true);
  assert.equal(isBackcourtPoint('left', .51), true);
  assert.equal(isBackcourtPoint('left', .49), false);
  assert.equal(isBackcourtPoint('right', .25, true), false);
  assert.equal(isBackcourtPoint('right', .75, true), true);
});
test('advanced shot zones validate and survive file and link sharing', async () => {
  const { game, events, add } = fixture();
  add('2PM', { shotZone: 'rim' }); add('2PX', { shotZone: 'paint-left' }); add('3PX', { shotZone: 'three-top' });
  validateGame(game, events);
  const shared = parseSharedReport(JSON.stringify(createSharedReport(game, events)));
  assert.deepEqual(shared.shots, [{ playerId: 'p1', zone: 'rim', result: 'made' }, { playerId: 'p1', zone: 'paint', result: 'miss' }, { playerId: 'p1', zone: 'three-top', result: 'miss' }]);
  const legacyReport = createSharedReport(game, events); legacyReport.report.shots[1].zone = 'paint-right';
  assert.equal(parseSharedReport(JSON.stringify(legacyReport)).shots[1].zone, 'paint');
  const payload = await createCompressedSharePayload(game, events);
  assert.deepEqual((await parseSharePayload(payload)).shots, shared.shots);
  const invalid = structuredClone(events); invalid[0].shotZone = 'not-a-zone';
  assert.throws(() => validateGame(game, invalid), /シュート位置/);
  assert.equal(SHOT_ZONES.length, 12);
  assert.equal(normalizeShotZone('mid-left'), 'two-left-wing');
});
test('sharing a legacy game ignores an unknown shot position without losing its stats', () => {
  const { game, events, add } = fixture();
  add('2PM', { shotZone: 'old-zone-name' });
  const shared = createSharedReport(game, events);
  assert.equal(shared.report.team.PTS, 2);
  assert.deepEqual(shared.report.shots, []);
  assert.doesNotThrow(() => parseSharedReport(JSON.stringify(shared)));
});
test('shared reports created before FD was added remain readable', () => {
  const { game, events, add } = fixture(); add('3PM');
  const legacy = createSharedReport(game, events);
  delete legacy.report.team.FD;
  legacy.report.players.forEach(player => delete player.stats.FD);
  const parsed = parseSharedReport(JSON.stringify(legacy));
  assert.equal(parsed.team.FD, 0); assert.equal(parsed.players[0].stats.FD, 0);
});
test('shot court map enables only matching two- or three-point zones', () => {
  const twoPoint = shotZonePicker('選手1', STATS['2PM']);
  const threePoint = shotZonePicker('選手1', STATS['3PM']);
  assert.equal((twoPoint.match(/data-action="shot-zone"/g) || []).length, 7);
  assert.equal((threePoint.match(/data-action="shot-zone"/g) || []).length, 5);
  assert.equal((twoPoint.match(/data-zone=/g) || []).length, 12);
  assert.match(twoPoint, /shot-map-zone three-point disabled/);
  assert.match(threePoint, /shot-map-zone two-point disabled/);
  assert.match(twoPoint, /data-zone="rim"/);
  assert.match(threePoint, /data-zone="three-top"/);
  assert.match(twoPoint, /viewBox="0 0 620 475"/);
  assert.doesNotMatch(twoPoint, /<text/);
});
test('shot chart map shows each zone as made-attempts and percentage', () => {
  const chart = shotChartMapHTML([
    { playerId: 'player-0', zone: 'two-top', result: 'made' },
    { playerId: 'player-0', zone: 'two-top', result: 'miss' },
    { playerId: 'player-0', zone: 'three-left-corner', result: 'made' },
  ]);
  assert.match(chart, /class="shot-court-map shot-chart-map"/);
  assert.equal((chart.match(/class="shot-map-zone shot-chart-map-zone/g) || []).length, 12);
  assert.match(chart, /50\.0%/);
  assert.match(chart, /1\/2/);
  assert.doesNotMatch(chart, /shot-marker|○|×/);
});
test('exact Pro shot positions render as markers with an area summary', () => {
  const chart = shotChartMapHTML([
    { playerId: 'player-0', zone: 'three-top', result: 'made', x: .5, y: .15 },
    { playerId: 'player-0', zone: 'three-top', result: 'miss', x: .6, y: .2 },
  ]);
  assert.match(chart, /pro-shot-chart-map/);
  assert.equal((chart.match(/class="pro-shot-chart-marker [^"]+/g) || []).length, 2);
  assert.match(chart, /pro-shot-zone-summary/);
  assert.equal((chart.match(/data-action="toggle-shot-display"/g) || []).length, 2);
  assert.match(chart, /shot-display-view-zones/);
  assert.doesNotMatch(chart, /pro-court-zone-boundaries/);
  assert.match(chart, /1\/2/);
  assert.match(chart, /50\.0%/);
});
test('shot chart display can start in area mode while keeping point and area views', () => {
  const chart = shotChartMapHTML([
    { playerId: 'player-0', zone: 'three-top', result: 'made', x: .5, y: .15 },
  ], null, 'zones');
  assert.match(chart, /data-shot-display-mode="zones"/);
  assert.match(chart, /shot-display-view-points/);
  assert.match(chart, /shot-display-view-zones/);
  assert.match(chart, /data-mode="zones" aria-pressed="true"/);
});
test('Pro shot input uses result buttons, auto-selects points and skips the court for FT', () => {
  const { game, events } = fixture(); game.mode = 'pro'; game.clockEnabled = false; game.opponentTracking = 'score';
  const state = { proSelection: { type: 'FGM', playerId: 'player-0' }, proSub: null, proOpponentSelection: null };
  const field = proLiveView(state, game, events);
  assert.match(field, /data-type="FGM"/); assert.match(field, /data-type="FGX"/);
  assert.doesNotMatch(field, /data-type="2PM"|data-type="3PM"/); assert.match(field, /data-action="pro-shot-point"/);
  assert.match(field, /pro-history-button/); assert.match(field, /pro-player on-court/); assert.doesNotMatch(field, /<strong>#/);
  assert.match(field, /pro-player-stat-score/); assert.match(field, /pro-player-stat-foul/); assert.match(field, /<em>PTS<\/em><span class="pro-player-stat-value">0<\/span>/); assert.match(field, /<em>F<\/em><span class="pro-player-stat-value">0<\/span>/); assert.doesNotMatch(field, /class="pro-player-stat pro-player-stat-score"[^>]*>.*digital-display/); assert.match(field, /aria-label="0点、ファウル0"/);
  assert.match(field, /data-action="toggle-pro-attack"/); assert.match(field, /→ 右ゴール/);
  assert.match(field, /pro-await-own-court/); assert.match(field, /pro-court-wrap/);
  assert.doesNotMatch(field, /選手をタップ|プレーを選択|相手選手をタップ/);
  assert.match(field, /pro-backcourt-overlay/); assert.match(field, /BACK COURT/);
  assert.doesNotMatch(field, /pro-court-zone-boundaries/);
  const feedback = proLiveView({ ...state, proShotFeedback: { gameId: game.id, eventId: 'feedback-1', eventType: '3PM', shotX: 140 / 940, shotY: 35 / 500, shotZone: 'three-left-corner' } }, game, events);
  assert.match(feedback, /class="pro-shot-area-feedback" data-shot-area="左コーナー3P"/);
  assert.match(feedback, /シュートエリア/);
  assert.match(proLiveView(state, { ...game, currentPeriodId: game.periods[2].id }, events), /← 左ゴール/);
  const freeThrow = proLiveView({ ...state, proSelection: { type: 'FTM', playerId: 'player-0' } }, game, events);
  assert.doesNotMatch(freeThrow, /data-action="pro-shot-point"/);
  const awaitingPlayer = proLiveView({ proSelection: { type: 'FGM', playerId: null }, proOpponentSelection: null }, game, events);
  assert.match(awaitingPlayer, /pro-await-own-player/); assert.match(awaitingPlayer, /data-action="add-member"/);
});
test('Pro LIVE keeps substitution and play changes available while guiding the next tap', () => {
  assert.match(proLiveCss, /\.pro-live-screen\.pro-step-ready \.pro-court \{ pointer-events: none; \}/);
  assert.doesNotMatch(proLiveCss, /\.pro-live-screen\.pro-step-ready \.pro-court \{[^}]*opacity/);
  assert.equal(proLiveCss.includes('.pro-live-screen.pro-step-ready .pro-sub-button'), false);
  assert.equal(proLiveCss.includes('.pro-live-screen.pro-await-own-player .pro-center'), false);
  assert.equal(proLiveCss.includes('.pro-live-screen.pro-await-opponent-player .pro-center'), false);
  assert.equal(proLiveCss.includes('.pro-live-screen.pro-await-own-court .pro-action-panel'), false);
  assert.equal(proLiveCss.includes('.pro-live-screen.pro-await-opponent-court .pro-action-panel'), false);
  assert.match(proLiveCss, /\.pro-shot-area-feedback \{[^}]*animation: pro-shot-area-feedback-fade 3\.2s/);
  assert.match(proLiveCss, /@keyframes pro-shot-area-feedback-fade/);
});
test('opponent players require a jersey number but can optionally include a name', () => {
  const { game } = fixture();
  game.mode = 'pro'; game.clockEnabled = false; game.opponentTracking = 'player'; game.opponentRoster = [{ id: 'opponent-1', number: '8' }];
  validateGame(game, []);
  assert.equal(eventLabel(game, { eventType: 'PF', playerId: 'opponent-1', side: 'opponent' }), '相手 8 · F');
  const html = proLiveView({ proSelection: null, proOpponentSelection: { type: 'FGM', playerId: 'opponent-1' } }, game, []);
  assert.match(html, /data-action="pro-select-opponent" data-id="opponent-1"/);
  assert.match(html, /<span class="pro-player-name"><strong>8<\/strong><\/span>/);
  assert.match(html, /<b>OPPONENT · 8 · フィールドゴール成功<\/b>/);
  assert.match(html, /data-action="pro-opponent-sub"/);
  assert.match(html, /data-action="add-opponent-player"/);
  assert.match(html, /pro-player on-court/);
  game.opponentRoster[0].name = '相手選手';
  assert.equal(eventLabel(game, { eventType: 'PF', playerId: 'opponent-1', side: 'opponent' }), '相手 8 相手選手 · F');
  assert.match(proLiveView({ proSelection: null, proOpponentSelection: { type: 'FGM', playerId: 'opponent-1' } }, game, []), /<strong>8<\/strong><span>相手選手<\/span>/);
});
test('opponent substitutions keep five players on court and use opponent numbers', () => {
  const { game, events } = fixture();
  game.mode = 'pro'; game.clockEnabled = false; game.opponentTracking = 'player';
  game.opponentRoster = Array.from({ length: 6 }, (_, i) => ({ id: `opponent-${i}`, number: `${i + 4}` }));
  game.opponentStarters = game.opponentRoster.slice(0, 5).map(player => player.id);
  const substitution = { id: uid(), gameId: game.id, periodId: game.currentPeriodId, eventType: 'SUB', side: 'opponent', playerId: null, outPlayerId: 'opponent-0', inPlayerId: 'opponent-5', points: 0, timestamp: new Date().toISOString(), seq: game.nextSeq++ };
  events.push(substitution);
  validateGame(game, events);
  assert.deepEqual(opponentLineup(game, events), ['opponent-1', 'opponent-2', 'opponent-3', 'opponent-4', 'opponent-5']);
  assert.equal(eventLabel(game, substitution), '相手 4 → 9');
});
test('opponent roster uses one row with separate number and name boxes', () => {
  const { game } = fixture();
  game.mode = 'pro'; game.clockEnabled = false; game.opponentTracking = 'player'; game.opponentRoster = [{ id: 'opponent-1', number: '8', name: '相手選手' }];
  const html = liveSettingsHTML(game);
  assert.equal((html.match(/data-opponent-roster-row/g) || []).length, 1);
  assert.match(html, /data-opponent-roster-editor/);
  assert.match(html, /name="opponentRosterNumber"[^>]*value="8"/);
  assert.match(html, /name="opponentRosterName"[^>]*value="相手選手"/);
  assert.match(html, /data-action="add-opponent-roster-player"/);
  assert.match(html, /data-action="remove-opponent-roster-player"/);
  assert.match(html, /半角数字1〜3桁/);
  assert.doesNotMatch(html, /<textarea/);
  assert.doesNotMatch(html, /name="opponentRosterNumbersText"/);
  assert.doesNotMatch(html, /name="opponentRosterNamesText"/);
  assert.doesNotMatch(html, /ローラー/);
});
test('opponent roster rows are also used in Pro game creation', () => {
  const { team } = fixture();
  const html = gameFormView({ data: { teams: [team] }, preferences: { advancedMode: false } }, { teamId: team.id, date: '2026-09-05', opponentName: 'VISITORS', format: 'quarters', count: 4, minutes: 8, participants: team.players.map(player => player.id), starters: team.players.slice(0, 5).map(player => player.id), mode: 'pro', clockEnabled: false, opponentTracking: 'player', opponentRosterNumbersText: '8\n12', opponentRosterNamesText: '相手A\n相手B' });
  assert.equal((html.match(/data-opponent-roster-row/g) || []).length, 2);
  assert.match(html, /name="opponentRosterNumber"[^>]*value="8"/);
  assert.match(html, /name="opponentRosterName"[^>]*value="相手A"/);
  assert.match(html, /name="opponentRosterNumber"[^>]*value="12"/);
  assert.match(html, /name="opponentRosterName"[^>]*value="相手B"/);
  assert.match(html, /data-action="add-opponent-roster-player"/);
});
test('team and opponent rosters have no registration count cap and still reject full-width numbers', () => {
  const manyPlayers = Array.from({ length: 61 }, (_, i) => ({ id: `large-player-${i}`, number: String(i % 1000), name: `選手${i}` }));
  validateTeam({ id: 'large-team', name: 'LARGE', revision: 0, players: manyPlayers });
  const { game } = fixture();
  game.mode = 'pro'; game.clockEnabled = false; game.opponentTracking = 'player'; game.roster = structuredClone(manyPlayers); game.starters = manyPlayers.slice(0, 5).map(player => player.id);
  game.opponentRoster = manyPlayers.map((player, i) => ({ id: `large-opponent-${i}`, number: player.number }));
  game.opponentStarters = game.opponentRoster.slice(0, 5).map(player => player.id);
  assert.doesNotThrow(() => validateGame(game, []));
  game.opponentRoster = [{ id: 'opponent-full-width', number: '８' }]; game.opponentStarters = [];
  assert.throws(() => validateGame(game, []), /相手選手の背番号/);
});
test('strategy board exposes court tools and preserves placed items in its view', () => {
  const board = { tool: 'away', items: [
    { id: 'home-1', kind: 'athlete', team: 'home', label: '1', x: 240, y: 300 },
    { id: 'away-1', kind: 'athlete', team: 'away', label: '1', x: 420, y: 300 },
    { id: 'ball-1', kind: 'ball', x: 330, y: 300 },
    { id: 'arrow-1', kind: 'arrow', startX: 240, startY: 300, endX: 520, endY: 300 },
  ] };
  const html = strategyBoardHTML(board);
  assert.match(html, /作戦ボードの道具/);
  assert.equal((html.match(/data-action="strategy-tool"/g) || []).length, 6);
  assert.match(html, /data-tool="away" aria-pressed="true"/);
  assert.match(html, /味方 <b>1\/5<\/b>/);
  assert.match(html, /相手 <b>1\/5<\/b>/);
  assert.match(html, /ボール <b>1\/1<\/b>/);
  assert.match(html, /data-strategy-board-items/);
  assert.match(html, /strategy-board-side-left/);
  assert.match(html, /strategy-board-side-right/);
  assert.match(html, /strategy-board-bottom/);
  assert.match(html, /strategy-board-uniform strategy-board-home/);
  assert.match(html, /strategy-board-uniform strategy-board-away/);
  assert.match(html, /strategy-board-ball/);
  assert.equal((html.match(/data-strategy-movable="true"/g) || []).length, 3);
  assert.match(html, /ドラッグで移動/);
  assert.match(html, /data-strategy-item="home-1"/);
  assert.match(html, /data-strategy-item="arrow-1"/);
});
test('selected games aggregate team and player stats by stable player identity', () => {
  const first = fixture(); first.add('3PM'); first.add('AST', { playerId: 'player-1' });
  const second = structuredClone(first.game);
  second.id = 'game-2'; second.date = '2026-09-06'; second.opponentName = 'VISITORS 2';
  second.periods = makePeriods('quarters', 4, 8); second.currentPeriodId = second.periods[0].id;
  const events = [
    { id: uid(), gameId: second.id, periodId: second.currentPeriodId, eventType: '2PM', playerId: 'player-1', points: 2, timestamp: new Date().toISOString(), seq: 1 },
    { id: uid(), gameId: second.id, periodId: second.currentPeriodId, eventType: 'OPP', playerId: null, points: 4, timestamp: new Date().toISOString(), seq: 2 },
  ];
  const report = aggregateGames([first.game, second], [...first.events, ...events]);
  assert.equal(report.team.PTS, 5); assert.equal(report.opponent, 4);
  assert.equal(report.team.FGM, 2); assert.equal(report.team.FGA, 2);
  assert.equal(report.players.find(p => p.id === 'player-0').stats.PTS, 3);
  assert.equal(report.players.find(p => p.id === 'player-1').stats.PTS, 2);
  const shared = parseSharedReport(JSON.stringify(createAggregateSharedReport([first.game, second], [...first.events, ...events], '夏季総体')));
  assert.equal(shared.gameCount, 2); assert.equal(shared.format, '2試合合計'); assert.deepEqual(shared.periods, [{ label: '合計', home: 5, away: 4 }]);
  assert.equal(shared.games.length, 2);
  assert.deepEqual(shared.games.map(game => game.opponentScore), [0, 4]);
  assert.equal(shared.games[0].players.find(player => player.id === 'p1').stats.PTS, 3);
  assert.equal(shared.games[1].players.find(player => player.id === 'p2').stats.PTS, 2);
  assert.equal(shared.tournamentName, '夏季総体');
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
  const data = { teams: [team], games: [game], events, settings: [{ key: 'preferences', value: { continuous: false, theme: 'dark' } }, { key: '_epoch', value: 23 }] };
  const restored = parseBackup(JSON.stringify(backupObject(data)));
  assert.deepEqual(restored.events, events); assert.deepEqual(restored.games, [game]);
  assert.equal(restored.settings.length, 1);
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
});
test('duplicate jersey numbers and incomplete player data cannot be saved', () => {
  const { team } = fixture(); validateTeam(team);
  team.players[1].number = team.players[0].number;
  assert.throws(() => validateTeam(team), /重複/);
});
