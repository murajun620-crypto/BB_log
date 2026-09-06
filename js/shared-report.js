import { aggregate, blankStats, formatGame } from './domain.js';

const STAT_KEYS = Object.keys(blankStats());
const MAX_FILE_SIZE = 1024 * 1024;

const statsCopy = stats => Object.fromEntries(STAT_KEYS.map(key => [key, stats[key]]));

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
      teamName: game.teamName,
      opponentName: game.opponentName,
      opponentScore: summary.opponent,
      periods: summary.periods.map(period => ({ label: period.label, home: period.home, away: period.away })),
      team: statsCopy(summary.team),
      players: game.roster.map((player, index) => ({
        id: `p${index + 1}`,
        number: player.number,
        name: player.name,
        stats: statsCopy(summary.players[player.id]),
      })),
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
  ensure(stats && typeof stats === 'object' && STAT_KEYS.every(key => Number.isSafeInteger(stats[key]) && stats[key] >= 0 && stats[key] <= 999999));
  ensure(stats.FGM === stats.P2M + stats.P3M && stats.FGA === stats.P2A + stats.P3A);
  ensure(stats.FGM <= stats.FGA && stats.P2M <= stats.P2A && stats.P3M <= stats.P3A && stats.FTM <= stats.FTA);
  ensure(stats.REB === stats.OREB + stats.DREB && stats.PTS === stats.P2M * 2 + stats.P3M * 3 + stats.FTM);
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
  ensure(validText(report.teamName, 40) && validText(report.opponentName, 40));
  ensure(Number.isSafeInteger(report.opponentScore) && report.opponentScore >= 0 && report.opponentScore <= 999999);
  ensure(Array.isArray(report.periods) && report.periods.length >= 1 && report.periods.length <= 50);
  for (const period of report.periods) ensure(period && validText(period.label, 12) && Number.isSafeInteger(period.home) && period.home >= 0 && period.home <= 999999 && Number.isSafeInteger(period.away) && period.away >= 0 && period.away <= 999999);
  ensure(Array.isArray(report.players) && report.players.length >= 1 && report.players.length <= 60);
  ensure(new Set(report.players.map(player => player?.id)).size === report.players.length);
  for (const player of report.players) {
    ensure(player && /^p\d{1,2}$/.test(player.id) && /^\d{1,3}$/.test(player.number) && validText(player.name, 40));
    validateStats(player.stats);
  }
  validateStats(report.team);
  for (const key of STAT_KEYS) ensure(report.players.reduce((sum, player) => sum + player.stats[key], 0) === report.team[key]);
  ensure(report.periods.reduce((sum, period) => sum + period.home, 0) === report.team.PTS);
  ensure(report.periods.reduce((sum, period) => sum + period.away, 0) === report.opponentScore);
  return structuredClone(report);
}

export function sharedReportFile(data, filename) {
  return new File([JSON.stringify(data)], filename, { type: 'application/json' });
}
