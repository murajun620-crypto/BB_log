# Courtsideの短い共有リンク

GitHub Pagesのアプリを維持し、Workers + D1に共有時点の1試合の集計だけを保存する。既存の `#share/v1…` / `v2…` / `v3…` リンクも維持する。新形式は `reader/#s/<128bitランダムID>`。現在の公開ドメインで75文字。

## 初回設定（無料プランのみ）

有料プランへの変更、支払い方法の追加、有料サービスの追加は行わない。公開前にWorkers Freeであることを確認する。無料枠の超過はサービスのエラーとして扱う。アプリに自動課金・アップグレード処理はない。

1. Cloudflareアカウントを作成・メール確認する。
2. このディレクトリで `pnpm install --frozen-lockfile`（Node 22以上）を実行する。Wranglerの公式依存 `esbuild` / `workerd` のビルド許可が必要な環境では、この2つだけを許可する。
3. `pnpm exec wrangler login --scopes account:read user:read workers:write d1:write` を実行し、本人が許可する。Billingの変更権限は要求しない。認証情報はGitへ入れない。
4. `pnpm exec wrangler d1 create courtside-share` で作成したIDを `wrangler.jsonc` の `database_id` に設定。
5. `pnpm exec wrangler d1 migrations apply courtside-share --remote`。
6. `pnpm exec wrangler deploy`。この時点では秘密設定がないため、APIは503を返し共有データを受け付けない。
7. 別々の暗号学的ランダム値（32バイト以上）をWorker secretsの `PUBLISHER_TOKEN` と `PASSWORD_PEPPER` に登録する。`PUBLISHER_TOKEN` は43文字以上のbase64url。`wrangler secret put <NAME>` または `secret bulk` を使い、コマンド引数やGitへ値を入れない。
8. `/health` の正常応答と、認証なしの作成・一覧拒否を確認。架空の試合でパスワード・共有停止まで公開APIを確認する。
9. `../js/cloud-config.js` の `CLOUD_SHARE_API` に公開WorkerのHTTPS URL（末尾スラッシュなし）だけを設定。アプリとReaderのキャッシュバージョンを同時に更新し、GitHub Pagesへ公開する。
10. 利用するブラウザ/PWAの「設定 → 共有用管理キーを設定」に `PUBLISHER_TOKEN` を入力。同じキーを使う端末間で共有の管理ができる。キーは相手へ共有しない。

通常の更新はテスト→必要なD1マイグレーション→Worker公開→API確認→アプリのコミット・プッシュ→Pages確認の順。接続先を変更すると既存短縮リンクの参照先も変わるので、DBを保持・移行せずに変更しない。

## 保護と制限

- 閲覧者はログイン不要。パスワードなしならリンクを知る人、ありならリンクとパスワードを知る人が閲覧可能。転送・スクリーンショットまでは防げない。
- 管理キーを持つ人は、このサービス内の全共有の作成・一覧・停止が可能。一般公開の投稿サービスではなく、管理キーを配った記録者向け。共用PCでは設定画面でキーを解除する。
- 有効期限は7/30/90/365日（初期値30日）。期限切れは即時閲覧不可、期限切れ・停止済みデータは日次処理で削除。停止時は本文・パスワード検証値を即時消去する。Cloudflareのバックアップ保持とは別。
- 共有内容は日付・チーム名・選手名/背番号・集計のみ。元のイベント・内部ID・設定は保存しない。共有は固定スナップショットで、元試合の編集・削除では変更されない。
- パスワードは8〜128文字。Workerの秘密pepperとHMAC-SHA256で処理した後、ランダムsalt付きPBKDF2-SHA256（100,000回）で検証値を保存。平文保存しない。pepperの変更は既存パスワード共有を開けなくするので行わない。
- 本文・パスワードをログに出さない。閲覧はPOST、レスポンスはno-store、Readerも本文やパスワードを永続保存しない。短縮リンクは毎回通信が必要。旧自己完結リンク・画像・ファイルのオフライン共有は残す。
- 1リクエスト128KiB、1日100作成、有効な共有1000件。アクセスはIPのハッシュ単位で120回/分、パスワード試行はIP＋リンク単位で10回/15分。日次で期限切れカウンタを削除する。上限は小規模運用向けの補助対策で、無料枠を保証するものではない。
- CORSはPagesのオリジンだけ許可するが、アクセス制御はランダムID・管理キー・サーバー側のパスワード確認で行う。SQLはプレースホルダーを使用。D1はprimaryを使い、作成直後や停止直後の古い読み取りを防ぐ。
- 作成に失敗してもパスワードなしの旧リンクへ自動で切り替えない。アップロード後に別のタップでOS共有を呼び、iOSのユーザー操作要件に対応する。

## テスト

リポジトリ直下で `node --test tests/*.test.mjs`、`node tests/cloud-browser.mjs`、`node tests/browser.mjs`、`node tests/resilience.mjs`。ブラウザテストにはPlaywrightとChromeが必要。Windowsでは `BROWSER_EXECUTABLE` にChromeの絶対パスを指定できる。

テスト用APIは本番のWorkerハンドラーと一時SQLiteを使用し、本番へ送信しない。Workers環境固有の確認は `wrangler deploy --dry-run` と公開後の架空データ試験を併用する。iPhoneの実際のLINE送信は実機確認が必要。
