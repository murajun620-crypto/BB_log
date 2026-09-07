# Project Status

バスケットボールの試合記録・共有を行うPWA。`Documents/Github/BB_log` がGitHub同期対象の正規リポジトリで、`main` と `origin/main` が同期している。

# Recent Changes

- LIFFログイン後に別ブラウザへ遷移しても、URLフラグメント内の共有ペイロードからLINEカードを復元・送信できるようにした。
- `AGENTS.md` に、プッシュ後のGitHub Pages公開確認を追加した。

# Current Issues

- `Documents/ChatGPT/BB_log_` はGit管理を無効化した退避フォルダー。以後の開発対象にしない。

# Next Tasks

1. 正規リポジトリ `Documents/Github/BB_log` を開いて作業する。
2. 変更後は `AGENTS.md` の方針に従い、確認・テスト後にコミットして `origin` へプッシュする。
3. 既存のPWA実装とテストを確認しながら、次の機能改善に進む。
4. iPhoneのホーム画面PWAと実機LINEで、初回ログインを含むLINEカード共有を確認する。

# Important Decisions

- このファイルは過去ログではなく、次のセッションが判断に使う現在状態を簡潔に記録する。
- 重要な実装・設計変更や作業終了時には、古い情報を置き換えて更新する。
- 長期的な開発ルールやコーディング規約は、必要になった時点で `AGENTS.md` に分離する。
- LINEカード共有の試合データはサーバーへ送らず、LIFFログインをまたぐURLフラグメント内のペイロードから再構築する。

# Environment / Testing Notes

- Windows環境。Node.js/npmを使用し、詳細な実行・テスト手順は正規リポジトリの `README.md` と `package.json` を参照する。
- Playwright同梱ブラウザがないPCでは、既存Chromeを `BROWSER_EXECUTABLE` に指定してブラウザテストを実行できる。
- GitHub同期を前提に、自宅PC・職場PCの両方で作業する。
