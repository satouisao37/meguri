# めぐり (meguri)

観光で行きたい場所を登録し、希望到着時刻・滞在時間を考慮した最適訪問順を車/公共交通の2モードで計算する PWA。
詳細仕様は末尾の `@import`(spec.md)で読み込む。リポジトリ: `satouisao37/meguri`(**public** — GitHub Pages 配信のための例外)。

> Issue 作成 → 実装 → 日本語コミット → close の**共通フロー・コミット規約・禁止事項は親 `/Users/soshi/dev/CLAUDE.md`「全ツール共通の作業フロー」に集約**。ここには再掲せず、**このツール固有の前提とコマンドだけ**を書く。

## 最重要の前提(壊さないこと)

- **資産参照は相対パスのみ**(Pages サブパス `/meguri/` 配信。`href="/..."` 等の先頭 `/` は禁止)。
- **sw.js を変更したら `CACHE_VERSION` を bump** し、画面フッターのバージョン表記も同時に上げる。
- `js/logic.js` は純粋関数のみ(DOM・fetch・localStorage 禁止)。JXA テストの対象なので ES modules も使わない(plain script + `globalThis.MeguriLogic`)。
- **API キー・課金 API は導入しない**(Nominatim / OSRM デモ / Google マップ深リンクのゼロコスト構成を維持)。
- localStorage スキーマ変更時は旧データからのマイグレーションを書く(ユーザーの登録済みプランを消さない)。
- 公共交通の所要時間は目安式。UI の「目安」表示を消さない。

## 作業フロー(ツール固有)

- ロジックは **まず `js/logic.js`** に純粋関数として実装し、`test/test_logic.js` にテストを追加する。副作用(fetch・DOM・保存)は `js/net.js` / `js/app.js` に閉じ込める。
- コードは素の JS(ビルド無し・依存ゼロ)、コメント・UI 文言は**日本語**。
- デザインは rosenzu フォーマット厳守: `/Users/soshi/dev/vault/Tools/knowhow/design-formats/rosenzu.md`(色は必ずトークンの hex 値。確認: `grep -c '#0089A3' style.css` 等の機械照合)。
- 実装後に必ず実行する構文チェック＋テスト(正確なコマンド):

  ```bash
  bash test/run.sh   # JXA: 全 .js の new Function 構文チェック + logic.js ユニットテスト(node 不使用)
  python3 -c "import ast; ast.parse(open('tools/gen_icons.py',encoding='utf-8').read())"
  ```

- 動作確認: `python3 -m http.server 8765 -d .` → `http://localhost:8765/`(localhost は secure context 扱いなので位置情報も可)。停止はポート特定 `lsof -ti tcp:8765 | xargs kill`。ヘッドレス確認は headless Chrome + CDP(共通ノウハウ [[2026-07-04_07-36_headlessChromeはCDPで回収]])。

## Obsidian Vault 連携

### 仕様ノート(必読)
@/Users/soshi/dev/vault/Tools/meguri/spec.md

### ツール固有ノウハウフォルダ
過去のノウハウを参照したくなったら `Glob`/`Read`:
- `/Users/soshi/dev/vault/Tools/meguri/knowhow/`

(共通ノウハウ・ユーザー好み・キャプチャルール・作業フローは親 `/Users/soshi/dev/CLAUDE.md` で読み込み済み)
