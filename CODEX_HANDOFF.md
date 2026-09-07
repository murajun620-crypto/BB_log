# Project Status

バスケットボールの試合記録・共有を行うオフライン対応PWA。正規リポジトリは `Documents/Github/BB_log`。GitHub Pages公開先は `https://murajun620-crypto.github.io/BB_log/`。

# Recent Changes

- LINEカード共有はLIFF URL経由でLINEアプリを起動せず、現在のCourtside画面から明示的に `liff.login()` を開始する方式へ変更。認証後は `#line-share/...` に戻ってカードを送る。
- リリース番号を `1.0.17` に統一（設定画面、`package.json`、`package-lock.json`、`sw.js`）。
- 未認証時の共有URL保持・ログイン復帰をブラウザテストで確認。

# Current Issues

- 実機でLIFF URL経由時に「サーバーへ接続できません。LINEにアクセスできません。インターネット接続を確認してください。」が表示され、ブラウザのCourtsideが空になる現象があった。今回、問題の起点と考えられるLIFF URL経由のLINEアプリ起動を廃止した。実機で1.0.17を再確認する。
- LIFF設定は確認済み：ID `2011471812-TxdJwwfB`、エンドポイントはGitHub Pages、Full、Scope `openid`、シェアターゲットピッカーON。
- `Documents/ChatGPT/BB_log_` は退避フォルダーで開発対象外。

# Next Tasks

1. 公開版1.0.17へ更新後、実機で「LINEカードへ共有」を再試行する。
2. 再発時は、LINEアプリへ切り替わるか、LINEログイン画面が出るか、戻ったURLの `#line-share/...` 有無を確認する。
3. 実機で送信成功後、通常機能の開発へ戻る。

# Important Decisions

- カード共有データはサーバーへ送らず、URLフラグメント内の圧縮ペイロードから復元する。
- 外部ブラウザでは明示的な `liff.login({ redirectUri })` を使い、認証後に `liff.init()` で再初期化する。LIFF URLのユニバーサルリンク起動には依存しない。
- ファイル変更後は原則コミット・プッシュし、GitHub Pagesの公開更新を確認する。長期ルールは `AGENTS.md` に置く。

# Environment / Testing Notes

- Windows。正規リポジトリで作業する。
- ユニットテスト：`node tests/domain.test.mjs`。
- ブラウザテスト：既存Chromeを `BROWSER_EXECUTABLE` に指定して `tests/browser.mjs` を実行。
- GitHub Pages反映は `sw.js?commit=<hash>` のバージョンと公開 `app.js` の最新処理を確認する。
