import { cloudShareEnabled, publisherKey, savePublisherKey, verifyPublisherKey, createCloudShare, listCloudShares, getCloudShare, deleteCloudShare, shortShareLink } from './cloud-share.js';
import { createSharedReport } from './shared-report.js';
import { shareUrl } from './transfer.js';
import { esc } from './views.js';

export function cloudSettingsHTML() {
  return `<section class="panel settings-panel" id="cloud-settings"><h2>共有リンク</h2><p class="help">${cloudShareEnabled() ? 'Cloudflare接続済み。共有した1試合の集計だけをクラウドに保存します。' : 'Cloudflareの初期設定待ちです。従来のリンク・ファイル・画像共有は使えます。'}</p><button class="button secondary full" data-action="cloud-key" ${cloudShareEnabled() ? '' : 'disabled'}>${publisherKey() ? '共有用管理キーを変更' : '共有用管理キーを設定'}</button><button class="button secondary full spaced" data-action="cloud-manage" ${cloudShareEnabled() && publisherKey() ? '' : 'disabled'}>共有したリンクを管理</button><p class="help">管理キーはこのブラウザだけに保存し、試合のJSONバックアップには含めません。別PCでも同じキーを設定すると、保存内容の確認や共有リンク・データの削除ができます。</p></section>`;
}

export function setupCloudShareUI({ showSheet, closeSheet, toast, refreshView, getGame, getEvents, getAggregate, message }) {
  let created = null, working = false;
  const date = ms => ms === null ? '無期限' : new Date(ms).toLocaleDateString('ja-JP');
  async function work(fn) {
    if (working) return;
    working = true;
    const buttons = [...document.querySelectorAll('#sheet button')];
    buttons.forEach(b => { b.disabled = true; });
    try { await fn(); }
    catch (error) { toast(error.message, true); }
    finally { working = false; buttons.forEach(b => { b.disabled = false; }); }
  }
  function openCreate(context = null) {
    if (!publisherKey()) { openKey(); return; }
    const g = getGame();
    if (!g && !context) throw new Error('試合が見つかりません。');
    const snapshot = context?.snapshot || createSharedReport(g, getEvents(g));
    const title = context?.title || context?.getTitle?.('') || (g ? `${g.date} ${g.teamName} vs ${g.opponentName}` : '共有レポート');
    const shareMessage = context?.message || context?.getMessage?.('') || (g ? message(g) : 'Courtside Readerで合計スタッツを見る');
    const description = context?.description || (g ? `${g.teamName} vs ${g.opponentName}の集計・選手名` : '選択した試合の集計・選手名');
    created = null;
    const tournamentField = context?.aggregate ? '<label>大会名（任意）<input name="tournamentName" maxlength="40" placeholder="例：夏季総体、○○カップ"></label>' : '';
    showSheet('共有リンクを作成', `<form id="cloud-create-form"><p class="help">${esc(description)}をCloudflareに保存します。後から元の試合を編集しても、この共有結果は変わりません。</p>${tournamentField}<label class="spaced">有効期限<select name="days"><option value="7">7日間</option><option value="30" selected>30日間</option><option value="90">90日間</option><option value="365">365日間</option><option value="unlimited">無期限</option></select></label><label class="spaced">閲覧パスワード（任意）<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="設定する場合は8文字以上"></label><p class="help">パスワードなし：リンクを知る人が閲覧できます。設定する場合は、パスワードをリンクとは別に伝えてください。</p><button type="submit" class="button primary full spaced">リンクを作成</button><p class="help">作成・閲覧には通信が必要です。「設定」で共有を停止できます。</p></form>`);
    document.querySelector('#cloud-create-form').addEventListener('submit', event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      void work(async () => {
        const selectedDays = String(values.get('days'));
        const tournamentName = context?.aggregate ? String(values.get('tournamentName') || '').trim() : '';
        const report = context?.makeSnapshot ? context.makeSnapshot(tournamentName) : snapshot;
        const result = await createCloudShare(report, { days: selectedDays === 'unlimited' ? null : Number(selectedDays), password: String(values.get('password')) });
        form.reset();
        created = { ...result, title: context?.getTitle ? context.getTitle(tournamentName) : title, link: shortShareLink(result.id), message: context?.getMessage ? context.getMessage(tournamentName) : shareMessage };
        showReady();
      });
    });
  }
  function showReady() {
    if (!created) return;
    showSheet('共有リンクができました', `<p class="help">有効期限：${date(created.expiresAt)} / ${created.passwordRequired ? 'パスワードあり（別途伝えてください）' : 'リンクを知る人が閲覧可能'}</p><label>共有リンク<input readonly value="${esc(created.link)}" aria-label="共有リンク"></label><button class="button primary full spaced" data-action="cloud-send">LINEへ共有</button><p class="help">LINEなどの共有先を選んで送信してください。送信をキャンセルしてもリンクは作成済みです。「設定」から再送・停止できます。</p>`);
  }
  function openKey() {
    showSheet('共有用管理キー', `<form id="cloud-key-form"><p class="help">Cloudflareへの接続時に用意した共有用管理キーを入力します。CloudflareのログインパスワードやAPIトークンではありません。このブラウザに保存するため、共用PCでは使用後に解除してください。</p><label>共有用管理キー<input type="password" name="key" autocomplete="off" spellcheck="false" required minlength="43" maxlength="128"></label><button class="button primary full spaced" type="submit">接続を確認して保存</button></form>${publisherKey() ? '<button class="button secondary full spaced" data-action="cloud-forget">このブラウザの管理キーを解除</button>' : ''}`);
    document.querySelector('#cloud-key-form').addEventListener('submit', event => {
      event.preventDefault(); const form = event.currentTarget;
      void work(async () => {
        const key = String(new FormData(form).get('key')).trim();
        if (!/^[A-Za-z0-9_-]{43,128}$/.test(key)) throw new Error('共有用管理キーの形式を確認してください。');
        await verifyPublisherKey(key); savePublisherKey(key); form.reset(); closeSheet(); refreshView(); toast('共有用管理キーを保存しました。');
      });
    });
  }
  async function viewShare(entry) {
    await work(async () => {
      const detail = await getCloudShare(entry.id);
      const report = detail.report || {};
      const players = Array.isArray(report.players) ? report.players : [];
      const createdAt = detail.createdAt ? new Date(detail.createdAt).toLocaleString('ja-JP') : '不明';
      const json = JSON.stringify(report, null, 2);
      showSheet('共有データを確認', `<p class="help">Cloudflareに保存されている共有用スナップショットです。元の試合データのイベントや管理キーは含まれません。</p><div class="cloud-share-preview"><dl><dt>タイトル</dt><dd>${esc(detail.title || entry.title)}</dd><dt>大会名</dt><dd>${esc(report.tournamentName || 'なし')}</dd><dt>作成日時</dt><dd>${esc(createdAt)}</dd><dt>試合数</dt><dd>${esc(report.gameCount ?? 1)}試合</dd><dt>チーム</dt><dd>${esc(report.teamName || '')}</dd><dt>対戦相手</dt><dd>${esc(report.opponentName || '')}</dd><dt>選手</dt><dd>${players.map(p => `#${esc(p.number)} ${esc(p.name)}`).join('、') || 'なし'}</dd><dt>有効期限</dt><dd>${date(detail.expiresAt)}</dd><dt>パスワード</dt><dd>${detail.passwordRequired ? 'あり' : 'なし'}</dd></dl><details><summary>保存されているJSONを表示</summary><pre class="cloud-share-json">${esc(json)}</pre></details></div><button class="button danger-solid full" id="cloud-detail-delete">共有停止・データ削除</button><p class="help">削除するとこのリンクは開けなくなり、Cloudflare上の共有データ本体も即時削除されます。すでに相手が保存した画像やコピーは消せません。</p>`);
      document.querySelector('#cloud-detail-delete').addEventListener('click', () => confirmDelete(entry));
    });
  }
  function confirmDelete(entry) {
    showSheet('共有データを削除しますか？', `<p class="confirm-body">「${esc(entry.title)}」の共有リンクを停止し、Cloudflare上のデータ本体を完全に削除します。この操作は元に戻せません。</p><button class="button danger-solid full" id="cloud-delete-confirm">共有停止・データ削除</button>`);
    document.querySelector('#cloud-delete-confirm').addEventListener('click', () => void work(async () => { await deleteCloudShare(entry.id); toast('共有リンクと保存データを削除しました。'); await manage(); }));
  }
  async function manage() {
    const { shares } = await listCloudShares();
    showSheet('共有したリンクを管理', `<p class="help">同じ管理キーで作成した有効な共有です。「データを確認」で保存内容を確認できます。削除するとCloudflare上の共有データ本体も消去されます。</p><div class="card-list">${shares.length ? shares.map(s => `<section class="panel"><h3>${esc(s.title)}</h3><p class="help">${date(s.expiresAt)}まで / ${s.passwordRequired ? 'パスワードあり' : 'パスワードなし'}</p><button class="button secondary full" data-cloud-view="${esc(s.id)}">データを確認</button><button class="button secondary full spaced" data-cloud-resend="${esc(s.id)}">リンクを再共有</button><button class="button danger-solid full spaced" data-cloud-delete="${esc(s.id)}">共有停止・データ削除</button></section>`).join('') : '<p>有効な共有はありません。</p>'}</div>`);
    const sheet = document.querySelector('#sheet');
    sheet.querySelectorAll('[data-cloud-view]').forEach(b => b.addEventListener('click', () => {
      const entry = shares.find(s => s.id === b.dataset.cloudView);
      if (entry) void viewShare(entry);
    }));
    sheet.querySelectorAll('[data-cloud-resend]').forEach(b => b.addEventListener('click', () => {
      const entry = shares.find(s => s.id === b.dataset.cloudResend);
      if (!entry) return;
      void work(async () => {
        const result = await shareUrl(shortShareLink(entry.id), entry.title, `${entry.title}\nCourtside ReaderでBOX SCOREを見る`);
        if (result === 'copied') toast('共有リンクをコピーしました。');
        if (result === 'copy-failed') throw new Error('リンクをコピーできませんでした。');
      });
    }));
    sheet.querySelectorAll('[data-cloud-delete]').forEach(b => b.addEventListener('click', () => {
      const entry = shares.find(s => s.id === b.dataset.cloudDelete);
      if (entry) confirmDelete(entry);
    }));
  }
  return {
    'cloud-create': openCreate,
    'cloud-create-aggregate': () => work(() => openCreate(getAggregate?.())),
    'cloud-key': openKey,
    'cloud-manage': () => work(manage),
    'cloud-forget': () => { savePublisherKey(''); closeSheet(); refreshView(); toast('このブラウザの管理キーを解除しました。'); },
    'cloud-send': () => work(async () => {
      if (!created) return;
      // A second tap after upload keeps native sharing inside a fresh user gesture on iOS.
      const result = await shareUrl(created.link, created.title, created.message);
      if (result === 'copied') toast('共有リンクをコピーしました。LINEに貼り付けてください。');
      if (result === 'copy-failed') throw new Error('リンクをコピーできませんでした。表示中のリンクを選択してコピーしてください。');
      if (result === 'shared') closeSheet();
    }),
  };
}
