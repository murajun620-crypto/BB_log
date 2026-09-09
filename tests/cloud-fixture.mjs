import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createSharedReport } from '../js/shared-report.js';
import { makePeriods } from '../js/domain.js';

export function testDB() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../cloudflare/migrations/0001_shares.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../cloudflare/migrations/0002_unlimited_expiry.sql', import.meta.url), 'utf8'));
  const db = {
    sqlite,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { return sqlite.prepare(sql).run(...values); },
      };
    },
    async batch(statements) { return Promise.all(statements.map(s => s.run())); },
    withSession(mode) { if (mode !== 'first-primary') throw new Error('Primary required'); return db; },
  };
  return db;
}
export function fixture() {
  const players = [{ id: 'internal-player-id', number: '4', name: 'テスト選手' }];
  const team = { id: 'test-team', name: '共有テスト', revision: 0, players };
  const periods = makePeriods('quarters', 4, 8), now = new Date().toISOString();
  const game = { id: 'test-game', teamId: team.id, teamName: team.name, opponentName: 'TEST AWAY', date: '2026-09-09', format: 'quarters', regulationCount: 4, minutes: 8, periods, currentPeriodId: periods[0].id, roster: players, starters: [], status: 'finished', revision: 0, nextSeq: 2, createdAt: now, updatedAt: now };
  const events = [{ id: 'test-event', gameId: game.id, playerId: players[0].id, periodId: periods[0].id, eventType: '3PM', points: 3, seq: 1, timestamp: now }];
  return { team, game, events, report: createSharedReport(game, events) };
}
export const testToken = 't'.repeat(43);
export const testEnv = (db = testDB()) => ({ DB: db, PUBLISHER_TOKEN: testToken, PASSWORD_PEPPER: 'test-only-pepper-'.repeat(4), ALLOWED_ORIGINS: 'https://app.example' });
