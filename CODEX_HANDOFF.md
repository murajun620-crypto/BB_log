# Project Status

バスケットボールの試合記録・共有を行うオフライン対応PWA。正規リポジトリは `Documents/Github/BB_log`、公開先は `https://murajun620-crypto.github.io/BB_log/`。現在のアプリ版は2.1.4。標準記録、Advanced（Bリーグ式12ゾーン）、iPad横向き中心のPro記録モードを実装済み。

# Recent Changes

- Pro LIVEとProショットチャートのコート線を、標準モードのハーフコート線を左右反転して構成。3Pの直線部分、円弧、フリースローレーンを左右対称に表示し、ゾーン境界は塗り分けなし・薄線にした。
- Proのスコアとゲームクロックを7セグメント風の角形数字に変更。ショットクロックは実装しない。
- LIVE中の試合メニューから、標準／Pro、ゲームクロック有無、相手記録（総得点／個人）を変更可能。選手得点・ファウル、交代順、シュート後の選択解除、クロック編集にも対応。
- アプリ本体、Reader、Service Worker、package metadataのバージョンを2.1.4へ更新。

# Current Issues

- Proの相手個人スタッツは本体の試合・BOX SCOREには保存／表示するが、共有レポートでは自チーム中心の共有仕様を維持しており、相手個人表は共有対象外。
- 自動ブラウザ回帰テストは、この環境にPlaywright依存がないため未実行。単体テストとローカルブラウザ操作確認は完了している。
- iPhone実機でのPro横長／縦長の最終的なタップ感は、ユーザー環境で確認が必要。

# Next Tasks

1. GitHub Pagesの2.1.4反映後、iPad／iPhone実機でProコート、クロック、シュート位置、交代、共有Readerを確認する。
2. 必要ならPro画面のボタン密度・コート表示を実機に合わせて微調整する。

# Important Decisions

- 通常記録は端末内保存。共有時は集計データと自チームのシュート情報だけを共有し、元のイベントログや端末IDは出さない。
- 旧共有リンク、旧形式の共有ファイル、旧記録の位置なしイベントを壊さない。FD欠落や旧統計配列は0として補完する。
- Proの正確な位置は0〜1の正規化座標で保存し、表示時にコートへ変換する。エリア集計は同じ座標から算出する。
- Cloudflareは無料プラン運用。有料化、支払い情報操作、課金対象サービス追加はユーザーの明示承認なしに行わない。
- 変更後は原則コミット・プッシュし、GitHub Pagesの反映を確認する。長期ルールは `AGENTS.md` に置く。

# Environment / Testing Notes

- Windows。Cloudflare Worker関連は `cloudflare/`。共有Workerは `https://courtside-share.murajun620.workers.dev`。
- 単体／Workerテスト：`node --test tests/domain.test.mjs tests/cloud-share.test.mjs`（25件成功）。今回も `node --test tests/*.test.mjs`（25件成功）と変更JSの構文チェックに成功。
- 自動ブラウザテスト：`node tests/browser.mjs`。実行にはPlaywrightが必要だが、この環境では未導入。
- 手動確認用ローカルサーバーは `node scripts/serve.mjs`。Pro LIVEで左右コート、3P直線・円弧、フリースローレーン、7セグメント風スコア／クロックを確認済み。
- `Documents/ChatGPT/BB_log_` は退避フォルダーで開発対象外。管理キーなどの秘密情報はGitへ追加しない。
