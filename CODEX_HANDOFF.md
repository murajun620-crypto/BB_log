# Project Status

バスケットボールの試合記録・共有を行うオフライン対応PWA。正規リポジトリは `Documents/Github/BB_log`。GitHub Pages公開先は `https://murajun620-crypto.github.io/BB_log/`。

# Recent Changes

- LIFFとLINEカード共有を廃止し、通常の「LINEへ共有」（本文＋閲覧リンク）を正式な共有導線にした。
- LIFF ID設定、LIFF SDK、カード送信処理、関連テストと説明を削除。旧バックアップに残る `lineShare` 設定は復元時に無視する。
- リリース番号は `1.0.18` に統一。

# Current Issues

- 実機ではLIFF起動時にLINE接続エラー後、Courtsideが空になる現象が発生したため、LIFFを採用しない判断に変更した。
- `Documents/ChatGPT/BB_log_` は退避フォルダーで開発対象外。

# Next Tasks

1. 通常の「LINEへ共有」がiPhoneの共有シートからLINEへ送れることを実機確認する。
2. 廃止後のバージョンを更新し、テスト・コミット・プッシュ・GitHub Pages反映確認を完了する。

# Important Decisions

- LINE共有はOSの共有シートを使う。共有内容は日付・チーム名・スコア・閲覧専用BOX SCOREリンク。
- LINE Developers、LIFF ID、LINEログイン、Flexカード送信には依存しない。
- カード共有データはサーバーへ送らず、閲覧リンクのURLフラグメントから復元する。
- ファイル変更後は原則コミット・プッシュし、GitHub Pagesの公開更新を確認する。長期ルールは `AGENTS.md` に置く。

# Environment / Testing Notes

- Windows。正規リポジトリで作業する。
- ユニットテスト：`node tests/domain.test.mjs`。
- ブラウザテスト：既存Chromeを `BROWSER_EXECUTABLE` に指定して `tests/browser.mjs` を実行。
- GitHub Pages反映は `sw.js?commit=<hash>` のバージョンと公開 `app.js` を確認する。
