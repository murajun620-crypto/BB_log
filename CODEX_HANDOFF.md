# Project Status

バスケットボールの試合記録・共有を行うPWA。`Documents/Github/BB_log` がGitHub同期対象の正規リポジトリで、`main` と `origin/main` が同期している。

# Recent Changes

- Codex間の開発コンテキスト引き継ぎ用ファイルを正規リポジトリへ移行する準備をした。

# Current Issues

- `Documents/ChatGPT/BB_log_` は引き継ぎファイルだけを持つ不要な別クローン。以後の開発対象にしない。

# Next Tasks

1. 正規リポジトリ `Documents/Github/BB_log` を開いて作業する。
2. 変更後は `AGENTS.md` の方針に従い、確認・テスト後にコミットして `origin` へプッシュする。
3. 既存のPWA実装とテストを確認しながら、次の機能改善に進む。

# Important Decisions

- このファイルは過去ログではなく、次のセッションが判断に使う現在状態を簡潔に記録する。
- 重要な実装・設計変更や作業終了時には、古い情報を置き換えて更新する。
- 長期的な開発ルールやコーディング規約は、必要になった時点で `AGENTS.md` に分離する。

# Environment / Testing Notes

- Windows環境。Node.js/npmを使用し、詳細な実行・テスト手順は正規リポジトリの `README.md` と `package.json` を参照する。
- GitHub同期を前提に、自宅PC・職場PCの両方で作業する。
