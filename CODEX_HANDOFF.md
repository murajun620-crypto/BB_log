# Project Status

バスケットボールの試合記録・共有を行うオフライン対応PWA。正規リポジトリは `Documents/Github/BB_log`。GitHub Pages公開先は `https://murajun620-crypto.github.io/BB_log/`。

# Recent Changes

- LIFFとLINEカード共有を廃止し、通常の「LINEへ共有」（本文＋閲覧リンク）を正式な共有導線にした。
- LIFF ID設定、LIFF SDK、カード送信処理、関連テストと説明を削除。旧バックアップに残る `lineShare` 設定は復元時に無視する。
- リリース番号は `1.0.18` に統一。LIFF廃止版はコミット `c5adf03` としてプッシュ・GitHub Pages反映確認済み。

# Current Issues

- 通常のLINE共有リンクが長い。提示例は456文字。現在は1試合の集計をDeflate圧縮し、URLフラグメントへ全量格納しているため、試合の情報量に応じて長くなる。
- `Documents/ChatGPT/BB_log_` は退避フォルダーで開発対象外。

# Next Tasks

1. 短い共有リンクの設計をユーザーと決定する。検討案は、共有時点の1試合の集計だけをCloudflare Workers + D1へ保存し、Readerの `#s/<22文字のランダムID>` で取得する方式（現在のドメインで75文字）。クラウド保存は未承認・未実装。
2. 採用する場合は、作成者の認証・共有停止・保存期間を決める。閲覧者はログイン不要でリンクを知る人が閲覧可能。作成と初回閲覧は通信必須。従来リンクとファイル・画像共有は維持する。

# Important Decisions

- LINE共有はOSの共有シートを使う。共有内容は日付・チーム名・スコア・閲覧専用BOX SCOREリンク。
- LINE Developers、LIFF ID、LINEログイン、Flexカード送信には依存しない。
- 現行の共有データはサーバーへ保存せず、閲覧リンクのURLフラグメントから復元する。クラウド保存への変更は設計案の段階であり、まだ採用していない。
- ファイル変更後は原則コミット・プッシュし、GitHub Pagesの公開更新を確認する。長期ルールは `AGENTS.md` に置く。

# Environment / Testing Notes

- Windows。正規リポジトリで作業する。
- ユニットテスト：`node tests/domain.test.mjs`。
- ブラウザテスト：既存Chromeを `BROWSER_EXECUTABLE` に指定して `tests/browser.mjs` を実行。
- GitHub Pages反映は `sw.js?commit=<hash>` のバージョンと公開 `app.js` を確認する。
