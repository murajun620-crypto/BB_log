import { CLOUD_SHARE_API } from './cloud-config.js';
import { parseSharedReport } from './shared-report.js';

const KEY = 'courtside.cloud.publisher.v1';
export const cloudShareEnabled = () => !!CLOUD_SHARE_API;
export function publisherKey() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
export function savePublisherKey(value) {
  const token = value.trim();
  if (token && !/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error('共有用管理キーの形式を確認してください。');
  if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY);
}
export class CloudShareError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}
async function request(path, { method = 'GET', data, token } = {}) {
  if (!CLOUD_SHARE_API) throw new CloudShareError('Cloudflareの初期設定がまだ完了していません。', 'not_configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${CLOUD_SHARE_API}${path}`, {
      method, headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: data !== undefined ? JSON.stringify(data) : undefined,
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) throw new CloudShareError(body.message || '共有処理に失敗しました。', body.code);
    return body;
  } catch (error) {
    if (error instanceof CloudShareError) throw error;
    throw new CloudShareError('共有サービスに接続できません。インターネット接続を確認して再試行してください。', 'network');
  } finally { clearTimeout(timeout); }
}
const admin = () => {
  const token = publisherKey();
  if (!token) throw new CloudShareError('「設定」で共有用管理キーを入力してください。', 'unauthorized');
  return token;
};
export const verifyPublisherKey = token => request('/v1/shares', { token });
export const listCloudShares = () => request('/v1/shares', { token: admin() });
export const createCloudShare = (report, { password = '', days = 30 } = {}) => request('/v1/shares', { method: 'POST', token: admin(), data: { report, password, days } });
export const stopCloudShare = id => request(`/v1/shares/${validId(id)}`, { method: 'DELETE', token: admin() });
export async function openCloudShare(id, password = '') {
  const body = await request(`/v1/shares/${validId(id)}/open`, { method: 'POST', data: { password } });
  return parseSharedReport(JSON.stringify(body));
}
function validId(id) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) throw new CloudShareError('共有リンクの形式が不正です。', 'invalid_link');
  return id;
}
export function shortShareLink(id, base = location.href) {
  const url = new URL('./reader/', base);
  url.hash = `s/${validId(id)}`;
  return url.href;
}
