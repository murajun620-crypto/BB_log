const SDK_URL = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
const MAX_CARD_URL_LENGTH = 1000;
let sdkPromise;

export function isLiffId(value) {
  return typeof value === 'string' && /^\d{5,20}-[A-Za-z0-9_-]{4,80}$/.test(value);
}

function validPayload(value) {
  return typeof value === 'string' && /^v[123]\.[A-Za-z0-9_-]+$/.test(value);
}

export function lineShareLiffUrl({ liffId, payload }) {
  if (!isLiffId(liffId) || !validPayload(payload)) throw new Error('LINEカード共有のリンクを作成できませんでした。');
  const url = new URL(`https://liff.line.me/${liffId}`);
  url.hash = `line-share/${liffId}/${payload}`;
  if (url.href.length > MAX_CARD_URL_LENGTH) throw new Error('この試合はLINEカードのリンク上限を超えています。通常のLINE共有またはファイル共有を使ってください。');
  return url.href;
}

export function lineShareRedirectUri({ liffId, payload, locationHref = location.href }) {
  if (!isLiffId(liffId) || !validPayload(payload)) throw new Error('LINEカード共有のリンクを作成できませんでした。');
  const url = new URL(locationHref);
  url.hash = `line-share/${liffId}/${payload}`;
  if (url.href.length > MAX_CARD_URL_LENGTH) throw new Error('この試合はLINEカードのリンク上限を超えています。通常のLINE共有またはファイル共有を使ってください。');
  return url.href;
}

function text(value, max = 500) {
  return String(value ?? '').slice(0, max);
}

function formatLabel(game) {
  if (typeof game.formatLabel === 'string' && game.formatLabel) return text(game.formatLabel, 40);
  const format = game.format === 'quarters' ? '4Q' : game.format === 'halves' ? '2H' : `${game.regulationCount}P`;
  return `${format} × ${game.minutes}分`;
}

export function createLineCardMessage({ game, summary, url }) {
  if (typeof url !== 'string' || url.length > MAX_CARD_URL_LENGTH) throw new Error('この試合はLINEカードのリンク上限を超えています。通常のLINE共有またはファイル共有を使ってください。');
  const date = text(game.date).replaceAll('-', '/');
  const team = text(game.teamName, 40);
  const opponent = text(game.opponentName, 40);
  const score = `${summary.team.PTS} - ${summary.opponent}`;
  return [{
    type: 'flex',
    altText: `🏀 ${date} ${team} ${score} ${opponent}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#173F35', paddingAll: '18px',
        contents: [
          { type: 'text', text: 'COURTSIDE', color: '#FFFFFF', weight: 'bold', size: 'sm' },
          { type: 'text', text: 'GAME REPORT', color: '#BDE3D5', size: 'xxs', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '18px',
        contents: [
          { type: 'text', text: date, color: '#65736E', size: 'xs' },
          {
            type: 'box', layout: 'horizontal', margin: 'md', alignItems: 'center',
            contents: [
              { type: 'text', text: team, size: 'sm', weight: 'bold', wrap: true, flex: 4, align: 'start' },
              { type: 'text', text: score, size: 'xl', weight: 'bold', align: 'center', flex: 3 },
              { type: 'text', text: opponent, size: 'sm', weight: 'bold', wrap: true, flex: 4, align: 'end' },
            ],
          },
          { type: 'separator', margin: 'lg', color: '#E7ECE9' },
          { type: 'text', text: `${game.status === 'finished' ? 'FINAL' : '記録時点'} · ${formatLabel(game)}`, color: '#65736E', size: 'xs', margin: 'lg', align: 'center' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '14px',
        contents: [{ type: 'button', style: 'primary', color: '#1E6755', action: { type: 'uri', label: 'BOX SCOREを見る', uri: url } }],
      },
    },
  }];
}

function loadLiff() {
  if (globalThis.liff) return Promise.resolve(globalThis.liff);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL; script.async = true;
    script.onload = () => globalThis.liff ? resolve(globalThis.liff) : reject(new Error('LINE共有の読み込みに失敗しました。'));
    script.onerror = () => reject(new Error('LINEカード共有には通信が必要です。接続を確認してもう一度お試しください。'));
    document.head.append(script);
  });
  return sdkPromise;
}

export async function shareLineCard({ liffId, game, summary, url, payload, launchInLiff = false, redirectUri = location.href }) {
  if (!isLiffId(liffId)) throw new Error('設定でLINEのLIFF IDを入力してください。');
  const messages = createLineCardMessage({ game, summary, url });
  const liff = await loadLiff();
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    if (launchInLiff && validPayload(payload)) {
      location.href = lineShareLiffUrl({ liffId, payload });
      return 'login';
    }
    liff.login({ redirectUri });
    return 'login';
  }
  if (!liff.isApiAvailable?.('shareTargetPicker') || typeof liff.shareTargetPicker !== 'function') throw new Error('この環境ではLINEカード共有を開けません。LINEアプリから開くか、通常のLINE共有を使ってください。');
  const result = await liff.shareTargetPicker(messages, { isMultiple: true });
  return result?.status === 'success' ? 'shared' : 'cancelled';
}
