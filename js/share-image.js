import { aggregate, formatGame, percent } from './domain.js';

const WIDTH = 900;
const PAD = 48;
const COLORS = {
  bg: '#f4f7f5',
  surface: '#ffffff',
  text: '#18312b',
  muted: '#687972',
  line: '#dce6e1',
  accent: '#24584b',
  accentSoft: '#e5f0e9',
};
const FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif';

function makeCanvas(height) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = 'middle';
  return { canvas, ctx };
}

function setFont(ctx, size, weight = 500) {
  ctx.font = `${weight} ${size}px ${FAMILY}`;
}

function text(ctx, value, x, y, size, weight = 500, color = COLORS.text, align = 'left') {
  setFont(ctx, size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(String(value), x, y);
}

function fittedText(ctx, value, x, y, maxWidth, size, weight = 500, color = COLORS.text, align = 'left') {
  const original = String(value);
  setFont(ctx, size, weight);
  let output = original;
  if (ctx.measureText(output).width > maxWidth) {
    while (output.length > 1 && ctx.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1);
    output += '…';
  }
  text(ctx, output, x, y, size, weight, color, align);
}

function roundedRect(ctx, x, y, width, height, radius, fill) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function rule(ctx, y, x = PAD, width = WIDTH - PAD * 2) {
  ctx.fillStyle = COLORS.line;
  ctx.fillRect(x, y, width, 1);
}

function brand(ctx) {
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(PAD + 19, 52, 18, 0, Math.PI * 2);
  ctx.moveTo(PAD + 1, 52);
  ctx.lineTo(PAD + 37, 52);
  ctx.moveTo(PAD + 19, 34);
  ctx.lineTo(PAD + 19, 70);
  ctx.stroke();
  text(ctx, 'COURTSIDE', PAD + 53, 52, 28, 800, COLORS.accent);
}

function card(ctx, x, y, width, height) {
  roundedRect(ctx, x, y, width, height, 22, COLORS.surface);
}

function shooting(ctx, stats, y) {
  text(ctx, 'SHOOTING', PAD, y, 20, 750, COLORS.muted);
  const top = y + 28;
  const width = (WIDTH - PAD * 2) / 4;
  card(ctx, PAD, top, WIDTH - PAD * 2, 120);
  [['FG', 'FGM', 'FGA'], ['2P', 'P2M', 'P2A'], ['3P', 'P3M', 'P3A'], ['FT', 'FTM', 'FTA']].forEach(([label, made, attempted], index) => {
    const cx = PAD + width * index + width / 2;
    if (index) rule(ctx, top + 20, PAD + width * index, 80);
    text(ctx, label, cx, top + 27, 18, 700, COLORS.muted, 'center');
    text(ctx, `${stats[made]}/${stats[attempted]}`, cx, top + 65, 31, 750, COLORS.text, 'center');
    text(ctx, percent(stats[made], stats[attempted]), cx, top + 96, 18, 650, COLORS.accent, 'center');
  });
  return top + 120;
}

function footer(ctx, height) {
  rule(ctx, height - 60);
  text(ctx, 'COURTSIDE  ·  BASKETBALL STATS', PAD, height - 30, 17, 700, COLORS.muted);
}

export function boxScoreImage(game, events) {
  const stats = aggregate(game, events);
  const periodsPerRow = 6;
  const periodRows = Math.max(1, Math.ceil(stats.periods.length / periodsPerRow));
  const periodHeight = 34 + periodRows * 68;
  const tableRows = game.roster.length + 1;
  const rowHeight = game.roster.length > 40 ? 42 : 52;
  const height = 318 + periodHeight + 188 + 58 + 54 + tableRows * rowHeight + 82;
  const { canvas, ctx } = makeCanvas(height);

  brand(ctx);
  text(ctx, 'BOX SCORE', PAD, 105, 18, 750, COLORS.muted);
  text(ctx, `${game.date.replaceAll('-', '.')}  ·  ${formatGame(game)}`, WIDTH - PAD, 105, 18, 600, COLORS.muted, 'right');
  fittedText(ctx, game.teamName, PAD, 165, 260, 24, 700);
  fittedText(ctx, game.opponentName, WIDTH - PAD, 165, 260, 24, 700, COLORS.text, 'right');
  text(ctx, `${stats.team.PTS}  –  ${stats.opponent}`, WIDTH / 2, 196, 62, 800, COLORS.text, 'center');
  text(ctx, game.status === 'live' ? 'LIVE' : 'FINAL', WIDTH / 2, 250, 18, 750, COLORS.accent, 'center');

  let y = 300;
  text(ctx, 'PERIOD SCORE', PAD, y, 20, 750, COLORS.muted);
  y += 28;
  for (let row = 0; row < periodRows; row++) {
    const chunk = stats.periods.slice(row * periodsPerRow, (row + 1) * periodsPerRow);
    const width = (WIDTH - PAD * 2) / chunk.length;
    card(ctx, PAD, y, WIDTH - PAD * 2, 58);
    chunk.forEach((period, index) => {
      const cx = PAD + width * index + width / 2;
      text(ctx, period.label, cx, y + 17, 16, 700, COLORS.muted, 'center');
      text(ctx, `${period.home} – ${period.away}`, cx, y + 41, 22, 750, COLORS.text, 'center');
    });
    y += 68;
  }

  y = shooting(ctx, stats.team, y + 16) + 36;
  text(ctx, 'PLAYER STATS', PAD, y, 20, 750, COLORS.muted);
  y += 30;
  const columns = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'F'];
  const playerWidth = 270;
  const statWidth = (WIDTH - PAD * 2 - playerWidth) / columns.length;
  roundedRect(ctx, PAD, y, WIDTH - PAD * 2, 54, 14, COLORS.accent);
  text(ctx, 'PLAYER', PAD + 16, y + 27, 18, 750, '#ffffff');
  columns.forEach((label, index) => text(ctx, label, PAD + playerWidth + statWidth * (index + .5), y + 27, 16, 750, '#ffffff', 'center'));
  y += 54;

  const drawRow = (player, rowStats, total = false) => {
    ctx.fillStyle = total ? COLORS.accentSoft : COLORS.surface;
    ctx.fillRect(PAD, y, WIDTH - PAD * 2, rowHeight);
    const playerLabel = total ? 'TEAM TOTAL' : `#${player.number}  ${player.name}`;
    fittedText(ctx, playerLabel, PAD + 16, y + rowHeight / 2, playerWidth - 28, rowHeight < 52 ? 17 : 20, total ? 750 : 600, total ? COLORS.accent : COLORS.text);
    const values = [rowStats.PTS, rowStats.REB, rowStats.AST, rowStats.STL, rowStats.BLK, rowStats.TO, rowStats.PF];
    values.forEach((value, index) => text(ctx, value, PAD + playerWidth + statWidth * (index + .5), y + rowHeight / 2, rowHeight < 52 ? 18 : 21, index === 0 || total ? 750 : 550, index === 0 ? COLORS.accent : COLORS.text, 'center'));
    rule(ctx, y + rowHeight - 1);
    y += rowHeight;
  };
  game.roster.forEach(player => drawRow(player, stats.players[player.id]));
  drawRow(null, stats.team, true);
  footer(ctx, height);
  return canvas;
}

export function playerStatsImage(game, events, playerId) {
  const player = game.roster.find(candidate => candidate.id === playerId);
  if (!player) throw new Error('選手が見つかりません。');
  const aggregateStats = aggregate(game, events);
  const stats = aggregateStats.players[playerId];
  const height = 1080;
  const { canvas, ctx } = makeCanvas(height);

  brand(ctx);
  text(ctx, 'PLAYER STATS', PAD, 105, 18, 750, COLORS.muted);
  text(ctx, `${game.date.replaceAll('-', '.')}  ·  ${formatGame(game)}`, WIDTH - PAD, 105, 18, 600, COLORS.muted, 'right');
  fittedText(ctx, `${game.teamName}  ${aggregateStats.team.PTS} – ${aggregateStats.opponent}  ${game.opponentName}`, PAD, 148, WIDTH - PAD * 2, 22, 650, COLORS.muted);

  card(ctx, PAD, 190, WIDTH - PAD * 2, 218);
  roundedRect(ctx, PAD + 30, 224, 104, 104, 20, COLORS.accentSoft);
  text(ctx, `#${player.number}`, PAD + 82, 276, 38, 800, COLORS.accent, 'center');
  fittedText(ctx, player.name, PAD + 165, 257, 390, 39, 750);
  text(ctx, game.teamName, PAD + 165, 304, 20, 550, COLORS.muted);
  text(ctx, stats.PTS, WIDTH - PAD - 47, 269, 78, 800, COLORS.text, 'center');
  text(ctx, 'PTS', WIDTH - PAD - 47, 335, 20, 750, COLORS.muted, 'center');
  text(ctx, game.status === 'live' ? 'LIVE' : 'FINAL', PAD + 30, 373, 18, 750, COLORS.accent);

  let y = shooting(ctx, stats, 455) + 46;
  text(ctx, 'GAME STATS', PAD, y, 20, 750, COLORS.muted);
  y += 30;
  const values = [
    ['OR', stats.OREB], ['DR', stats.DREB], ['REB', stats.REB], ['AST', stats.AST],
    ['STL', stats.STL], ['BLK', stats.BLK], ['TO', stats.TO], ['F', stats.PF],
  ];
  const gap = 12;
  const width = (WIDTH - PAD * 2 - gap * 3) / 4;
  values.forEach(([label, value], index) => {
    const row = Math.floor(index / 4);
    const column = index % 4;
    const x = PAD + column * (width + gap);
    const top = y + row * 112;
    card(ctx, x, top, width, 98);
    text(ctx, label, x + width / 2, top + 26, 17, 700, COLORS.muted, 'center');
    text(ctx, value, x + width / 2, top + 66, 35, 750, COLORS.text, 'center');
  });
  footer(ctx, height);
  return canvas;
}

function canvasFile(canvas, filename) {
  const encoded = canvas.toDataURL('image/png').split(',')[1];
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], filename, { type: 'image/png' });
}

export async function shareImage(canvas, filename, title) {
  const file = canvasFile(canvas, filename);
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title, files: [file] });
      return 'shared';
    } catch (error) {
      if (error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

export function safeFilename(value) {
  return String(value).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 56);
}
