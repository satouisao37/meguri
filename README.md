# めぐり (meguri)

観光ルート最適化 PWA。行きたい場所を登録し、希望到着時刻と滞在時間を考慮した最適な訪問順を**車 / 公共交通**の2モードで計算する。

- 公開 URL: https://satouisao37.github.io/meguri/ (iPhone は Safari で開いて「ホーム画面に追加」)
- 場所の追加は地名検索(Nominatim / © OpenStreetMap contributors)または緯度経度入力
- 車の移動時間は OSRM デモサーバ、公共交通は距離ベースの**目安**。実経路は各区間の Google マップリンクで確認
- データは端末内(localStorage)のみ。JSON エクスポート/インポート対応

## 開発

```bash
python3 -m http.server 8765 -d .   # http://localhost:8765/
bash test/run.sh                    # 構文チェック + ユニットテスト(JXA・node 不要)
```

仕様: `/Users/soshi/dev/vault/Tools/meguri/spec.md`
