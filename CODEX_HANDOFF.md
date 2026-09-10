# Project Status

バスケットボールの試合記録・共有を行うオフライン対応PWA。正規リポジトリは `Documents/Github/BB_log`、公開先は `https://murajun620-crypto.github.io/BB_log/`。現在のアプリ版は2.1.1。標準記録とAdvanced（Bリーグ式12ゾーン）に加え、iPad横向き中心のPro記録モードを実装済み。

# Recent Changes

- Proモードを追加。ゲームクロックのON/OFF、フルコート中央表示、自チーム／相手チーム情報、得点、交代、ファールドローン、UNDOを備える。
- Proのシュート入力は、FG成功／失敗 → 選手 → フルコート上の位置の流れ。位置から2P・3Pを自動判定し、FTは位置なしで選手タップ時に記録する。連続入力ON時は標準と同じくシュート後にAST／OR・DRを提案する。
- Proのコート線を3Pライン・キー・フリースローサークル付きのフルコート表示へ修正し、ショットマーカーは色付きのシンプルな○／×に統一した。
- Proの相手記録は「総得点のみ」または「相手選手の個人スタッツ」を試合開始時に選択可能。個人記録時はBOX SCOREに相手選手表を表示する。
- 位置付きシュートは本体のBOX SCORE、選手詳細、自己完結リンク／ファイル共有、Readerで、フルコート上の○×と12エリア別の成功数・試投数・成功率を表示する。
- FD（ファールドローン）をスタッツへ追加。FD追加前の共有レポート・圧縮リンクも読み込み可能。
- アプリ本体、Reader、Service Worker、設定画面、package metadataのバージョンを2.1.1に統一。

# Current Issues

- Proの相手個人スタッツは本体の試合・BOX SCOREには保存／表示するが、共有レポートでは自チームの共有仕様を維持しており、相手個人表は共有対象外。
- 自動ブラウザ回帰テストは、この環境にPlaywright依存がないため未実行。単体テストとローカルブラウザ操作確認は完了している。
- iPhone実機でのPro横長／縦長の最終的なタップ感は、ユーザー環境で確認が必要。

# Next Tasks

1. iPad／iPhone実機で、クロック、シュート位置、交代、共有Readerを確認する。
2. 必要ならPro画面のボタン密度・コート表示を実機に合わせて微調整する。

# Important Decisions

- 通常記録は端末内保存。共有時は集計データと自チームのシュート情報だけを共有し、元のイベントログや端末IDは出さない。
- 旧共有リンク、旧形式の共有ファイル、旧記録の位置なしイベントを壊さない。FD欠落や旧統計配列は0として補完する。
- Proの正確な位置は0〜1の正規化座標で保存し、表示時にコートへ変換する。エリア集計は同じ座標から算出する。
- Cloudflareは無料プラン運用。有料化、支払い情報操作、課金対象サービス追加はユーザーの明示承認なしに行わない。
- 変更後は原則コミット・プッシュし、GitHub Pagesの反映を確認する。長期ルールは `AGENTS.md` に置く。

# Environment / Testing Notes

- Windows。Cloudflare Worker関連は `cloudflare/`。共有Workerは `https://courtside-share.murajun620.workers.dev`。
- 単体／Workerテスト：`node --test tests/domain.test.mjs tests/cloud-share.test.mjs`（現在24件成功）。構文チェックは変更したJS全ファイルで成功。
- 自動ブラウザテスト：`node tests/browser.mjs`。実行にはPlaywrightが必要だが、この環境では未導入。
- 手動確認用ローカルサーバーは `node scripts/serve.mjs`。今回、Pro設定、Pro記録、クロック、相手個人記録、BOX SCORE、位置付きチャート、コンソールエラーなしを確認した。今回の修正は2.1.1として公開する。
- `Documents/ChatGPT/BB_log_` は退避フォルダーで開発対象外。管理キーなどの秘密情報はGitへ追加しない。
