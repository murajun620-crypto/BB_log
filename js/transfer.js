import { aggregate, percent, validateTeam, validateGame } from './domain.js';

export function backupObject(data) {
  return { app: 'courtside-log', schemaVersion: 1, exportedAt: new Date().toISOString(), teams: data.teams, games: data.games, events: data.events, settings: data.settings.filter(s => s.key !== '_epoch') };
}
export function parseBackup(text) {
  if (text.length > 30 * 1024 * 1024) throw new Error('バックアップは30MB以下にしてください。');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('JSONファイルを読み取れませんでした。'); }
  if (data?.app !== 'courtside-log' || data.schemaVersion !== 1) throw new Error('対応するCourtsideのバックアップではありません。');
  for (const key of ['teams', 'games', 'events', 'settings']) if (!Array.isArray(data[key])) throw new Error('バックアップの形式が不正です。');
  for (const name of ['teams', 'games', 'events']) if (new Set(data[name].map(item => item?.id)).size !== data[name].length) throw new Error('バックアップに重複したIDがあります。');
  for (const team of data.teams) validateTeam(team);
  const gameIds = new Set(data.games.map(g => g.id));
  const teamIds = new Set(data.teams.map(t => t.id));
  const grouped = new Map(data.games.map(g => [g.id, []]));
  for (const e of data.events) {
    if (!e || !gameIds.has(e.gameId)) throw new Error('対応する試合のないイベントがあります。');
    grouped.get(e.gameId).push(e);
  }
  for (const game of data.games) {
    if (!teamIds.has(game.teamId)) throw new Error('対応するチームのない試合があります。');
    validateGame(game, grouped.get(game.id));
  }
  const keys = new Set();
  for (const s of data.settings) {
    if (!s || !['preferences', 'teamDraft', 'gameDraft'].includes(s.key) || keys.has(s.key)) throw new Error('設定データが不正です。');
    keys.add(s.key);
    if (s.key === 'preferences' && (!s.value || !['system', 'light', 'dark'].includes(s.value.theme) || typeof s.value.continuous !== 'boolean' || (s.value.keepAwake !== undefined && typeof s.value.keepAwake !== 'boolean'))) throw new Error('表示設定が不正です。');
    if (s.key === 'teamDraft') {
      if (!s.value || typeof s.value.name !== 'string' || !Array.isArray(s.value.players) || s.value.players.length > 60 || s.value.players.some(p => !p || typeof p.id !== 'string' || typeof p.number !== 'string' || typeof p.name !== 'string')) throw new Error('チーム下書きが不正です。');
    }
    if (s.key === 'gameDraft' && (!s.value || !Array.isArray(s.value.participants) || !Array.isArray(s.value.starters))) throw new Error('試合下書きが不正です。');
  }
  return { teams: data.teams, games: data.games, events: data.events, settings: data.settings };
}
function csvCell(value) {
  let s = String(value ?? '');
  // Spreadsheet applications must not execute user-supplied names as formulas.
  if (/^[\s]*[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export function gameCSV(game, events) {
  const summary = aggregate(game, events);
  const header = ['Date', 'Team', 'Opponent', 'Number', 'Player', 'PTS', 'FGM', 'FGA', 'FG%', '2PM', '2PA', '2P%', '3PM', '3PA', '3P%', 'FTM', 'FTA', 'FT%', 'OR', 'DR', 'REB', 'AST', 'STL', 'BLK', 'TO', 'F'];
  const line = (p, s) => [game.date, game.teamName, game.opponentName, p.number, p.name, s.PTS, s.FGM, s.FGA, percent(s.FGM, s.FGA), s.P2M, s.P2A, percent(s.P2M, s.P2A), s.P3M, s.P3A, percent(s.P3M, s.P3A), s.FTM, s.FTA, percent(s.FTM, s.FTA), s.OREB, s.DREB, s.REB, s.AST, s.STL, s.BLK, s.TO, s.PF];
  const rows = [header, ...game.roster.map(p => line(p, summary.players[p.id])), line({ number: '', name: 'TEAM TOTAL' }, summary.team), [], ['Period', game.teamName, game.opponentName], ...summary.periods.map(p => [p.label, p.home, p.away])];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function download(content, name, type) {
  downloadFile(new File([content], name, { type }));
}
export function downloadFile(file) {
  const blob = file;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function shareFile(file, title, message = '') {
  let canShare = false;
  try { canShare = !!navigator.share && !!navigator.canShare?.({ files: [file] }); } catch { canShare = false; }
  if (canShare) {
    try {
      await navigator.share({ title, text: message, files: [file] });
      return 'shared';
    } catch (error) {
      if (error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }
  downloadFile(file);
  return 'downloaded';
}
async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true; }
  } catch {}
  const textarea = document.createElement('textarea');
  textarea.value = value; textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed'; textarea.style.opacity = '0';
  document.body.append(textarea); textarea.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch {}
  textarea.remove();
  return copied;
}
export async function shareUrl(url, title, message = '') {
  if (navigator.share) {
    try {
      await navigator.share({ title, text: message, url });
      return 'shared';
    } catch (error) {
      if (error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }
  return (await copyText(url)) ? 'copied' : 'copy-failed';
}
