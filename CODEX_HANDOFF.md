# Project Status

バスケットボールの試合記録・共有を行うオフライン対応PWA。正規リポジトリは `Documents/Github/BB_log`、公開先は `https://murajun620-crypto.github.io/BB_log/`。アプリは2.0.1。Advancedモードで2P・3Pのシュート位置を13ゾーン記録し、結果画面・選手詳細・共有Readerにショットチャートを表示する。

# Recent Changes

- LIFF/LINEカード共有を廃止し、OSの共有シートによる従来リンク・ファイル・画像共有を維持。
- Cloudflare Workers + D1の短縮共有を実装・公開。Workerは `https://courtside-share.murajun620.workers.dev`、D1は `courtside-share`。
- 共有リンクは `reader/#s/<22文字ID>`。集計スナップショットのみ保存し、期限（7/30/90/365日または無期限、初期30日）、任意パスワード、管理画面からの停止、レート制限を実装。
- 履歴画面で同じ自チームの複数試合を選択し、チーム合計・相手合計・シューティング・選手別合計を表示できる。選手詳細も開ける。
- 合計レポートのLINE共有に対応。受信側Readerにも合計・1試合平均・合計ベースのシュート率を表示する。
- 選手一覧・選手詳細の合計/平均をボタンで切り替え可能。共有リンクの期限に無期限を追加し、D1の既存テーブルを移行済み。
- 複数試合の共有時に大会名を任意入力でき、共有スナップショット・LINE本文・Reader・管理一覧へ表示する。
- 複数試合共有で単一試合用の未定義データを参照していたエラーを修正。設定画面に更新適用ボタンを追加した。
- 集計画面上部に試合ごとのスコア一覧を表示し、各試合からBOX SCOREへ移動できるようにした。
- 複数試合の共有データに各試合の詳細スタッツを含め、Readerでも試合別スコア・ピリオド・選手スタッツを切り替えられるようにした。選手詳細は全試合集計・1試合平均・各試合を選択できる。
- Readerをライトモード固定にし、選手詳細の試合選択を修正した。
- Readerの結果閲覧画面を本体のBOX SCORE構成へ統一し、選手ポップアップの横余白も調整した。
- Advancedモードを追加。2P・3P入力後に13ゾーンを選択し、位置付きイベントを保存。バックアップ、ファイル共有、圧縮リンク、Cloudflare共有、Reader表示にも位置情報を引き継ぐ。
- シュート位置入力をSVGのハーフコート図へ変更。コーナー3Pはベースライン脇、ウイング／正面3Pは3Pライン外、ミドル／ショート／ペイントはライン内の形状でタップする。2P入力時は3P領域、3P入力時は2P領域を選択不可にする。バージョンを2.0.1に統一。
- 本体の「合計を見る」画面をReaderと同じ試合選択・試合別スタッツ・選手詳細の対象試合切り替えに統一した。
- Readerの「前の画面に戻る」ボタンを削除し、共有結果表示に専念する構成へ戻した。
- 起動時に `pwa` 状態の初期化が抜けていた不具合を修正。更新後の「s.pwa.ready」エラーを防止。
- Worker secrets `PUBLISHER_TOKEN` / `PASSWORD_PEPPER` はCloudflareへ登録済み。管理キーの控えはローカルの無視ファイル `cloudflare/.publisher-token` にあり、GitHubへは送らない。
- ローカルAPI・ブラウザ・回帰テストは通過。公開後の実環境はこの環境からQUIC/TLSエラーが出るため、ユーザー環境で疎通確認が必要。

# Current Issues

- ブラウザ回帰テストは、このPCにPlaywright依存がないため未実行。単体テストと構文チェックは通過。
- Advancedモードは任意設定。既存の位置なしイベントは従来どおり表示される。新しいコート図は実機で2P・3P両方のタップ感を確認する。
- 今回のReader変更後も、古い単一試合・旧形式の共有リンクは従来どおり詳細表示する。複数試合の詳細共有を返すWorker変更は本番反映済み。
- `Documents/ChatGPT/BB_log_` は退避フォルダーで開発対象外。
- 管理キーは各端末の「設定 → 共有リンク」で初回入力し、ブラウザの保存領域に保持する。共用端末では解除する。

# Next Tasks

1. iPhoneでAdvancedモードの2P・3P入力を確認し、コート図のゾーン位置・タップのしやすさを必要に応じて調整する。
2. 位置付き試合をファイル共有・従来リンク・Cloudflare短縮リンクでReaderから開き、チャートと選手詳細を確認。
3. 必要に応じてゾーン名・配置・見た目を調整。Cloudflare無料プランの利用量も確認する。

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
