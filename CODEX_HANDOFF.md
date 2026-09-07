# Project Status

バスケットボールの試合記録・共有を行うオフライン対応PWA。正規リポジトリは `Documents/Github/BB_log` で、`main` と `origin/main` を同期して運用する。GitHub Pages公開先は `https://murajun620-crypto.github.io/BB_log/`。

# Recent Changes

- LINEカード共有のLIFF認証フローを修正。初回だけ共有ペイロード付きLIFF URLを開き、LIFFから戻った後は現在の `#line-share/...` URLをログイン復帰先にする。未認証時にLIFF URLへ戻り続けるループを防止した。
- リリース番号を `1.0.16` に統一（設定画面、`package.json`、`package-lock.json`、`sw.js`）。
- ブラウザテストに、認証後の共有URL保持とループ防止の確認を追加。

# Current Issues

- 実機LINEで、初回または未認証時に「接続できません。ネット接続を確認してください」相当の表示が出た後、ブラウザのCourtsideが空になる現象が報告されている。今回の原因候補（LIFF遷移ループ）は修正済みだが、実機で再確認が必要。
- LIFF設定は確認済み：ID `2011471812-TxdJwwfB`、エンドポイントはGitHub Pages、Full、Scope `openid`、シェアターゲットピッカーON。LINE Login設定のコールバックURL欄は空だが、現在のLIFF実装では通常のLIFFログインを使用している。
- `Documents/ChatGPT/BB_log_` は退避フォルダーで、開発対象外。

# Next Tasks

1. 公開版が `1.0.16` へ更新された後、実機LINEで「LINEカードへ共有」を再試行する。
2. 再発時はLINEの正確なエラー文と、戻った時のURL（アドレスバーの `#line-share/...` を含むか）を確認する。
3. 実機でカード送信まで成功したら、通常機能の変更へ戻る。

# Important Decisions

- カード共有データはサーバーへ送らず、URLフラグメント内の圧縮ペイロードから復元する。
- LIFF URL起動は初回共有時だけ。認証後の共有ルートでは `liff.login({ redirectUri: location.href })` を使い、共有状態を同じURLへ戻す。
- ファイル変更後は原則コミット・プッシュし、GitHub Pagesの公開更新を確認する。長期ルールは `AGENTS.md` に置く。

# Environment / Testing Notes

- Windows。正規リポジトリで作業する。
- ユニットテスト：`node tests/domain.test.mjs`。
- ブラウザテスト：既存Chromeを `BROWSER_EXECUTABLE` に指定して `tests/browser.mjs` を実行。今回、全シナリオ通過。
- GitHub Pagesの公開反映は、`sw.js?commit=<hash>` がHTTP 200で `v1.0.16` を返すこと、および公開 `app.js` に最新LIFF処理が含まれることを確認する。
