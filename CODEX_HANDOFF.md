# Project Status

バスケットボールの試合記録・共有を行うオフライン対応PWA。正規リポジトリは `Documents/Github/BB_log`、公開先は `https://murajun620-crypto.github.io/BB_log/`。アプリは1.0.20。

# Recent Changes

- LIFF/LINEカード共有を廃止し、OSの共有シートによる従来リンク・ファイル・画像共有を維持。
- Cloudflare Workers + D1の短縮共有を実装・公開。Workerは `https://courtside-share.murajun620.workers.dev`、D1は `courtside-share`。
- 短縮共有は `reader/#s/<22文字ID>`。集計スナップショットのみ保存し、期限（7/30/90/365日、初期30日）、任意パスワード、管理画面からの停止、レート制限を実装。
- 履歴画面で同じ自チームの複数試合を選択し、チーム合計・相手合計・シューティング・選手別合計を表示できる。選手詳細も開ける。
- Worker secrets `PUBLISHER_TOKEN` / `PASSWORD_PEPPER` はCloudflareへ登録済み。管理キーの控えはローカルの無視ファイル `cloudflare/.publisher-token` にあり、GitHubへは送らない。
- ローカルAPI・ブラウザ・回帰テストは通過。公開後の実環境はこの環境からQUIC/TLSエラーが出るため、ユーザー環境で疎通確認が必要。

# Current Issues

- ブラウザ回帰テストは、このPCにPlaywright依存がないため未実行。単体テストと構文チェックは通過。
- `Documents/ChatGPT/BB_log_` は退避フォルダーで開発対象外。
- 管理キーは各端末の「設定 → 短い共有リンク」に入力する必要がある。共用端末では解除する。

# Next Tasks

1. 自宅PC/職場PCのアプリ設定へ同じ管理キーを入力し、テスト用試合で短縮リンク作成・パスワード閲覧・LINE共有を確認。
2. iPhoneのLINEで、短縮リンクがReaderを開き、パスワードあり/なし、期限・停止後の表示を確認。
3. Cloudflare無料プランの利用量を定期確認。無料枠超過時は自動課金せず共有エラーになる方針を維持。

# Important Decisions

- 通常記録は端末内保存。短縮共有を選んだ時だけ対象試合の集計をCloudflareへ送る。閲覧者のログインは不要。
- パスワードはWorker側で検証し、検証前にレポートを返さない。URLを知る人への転送・スクリーンショットは防げない。
- 旧 `#share/v1…` / `v2…` / `v3…` リンク、ファイル、画像共有は壊さない。Cloudflare障害時に旧リンクへ自動フォールバックしない。
- Cloudflareの有料プラン変更・課金情報操作は行わない。新しい権限や秘密情報の外部登録はユーザー承認を得る。
- 変更後は原則コミット・プッシュし、GitHub Pagesの更新を確認する。長期ルールは `AGENTS.md` に置く。

# Environment / Testing Notes

- Windows。Wranglerは `cloudflare/` のローカル依存。初回設定・秘密・運用手順は `cloudflare/README.md`。
- ユニット：`node --test tests/*.test.mjs`。Cloudflareハンドラー：同コマンドに含まれる `cloud-share.test.mjs`。
- ブラウザ：Chromeを `BROWSER_EXECUTABLE` に指定して `node tests/browser.mjs`、`node tests/cloud-browser.mjs`、`node tests/resilience.mjs`。
- 短縮リンク作成/閲覧は通信必須。旧自己完結リンクはオフライン可。GitHub Pages反映は公開 `sw.js` のバージョンと `cloud-config.js` のWorker URLを確認。
