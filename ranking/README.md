# 草パチ 24時間ランキング

公開用の `index.html` と旧共有URLの `kusa_named_directory_final.html` が、Cloudflare Workers と D1 のランキングAPIを利用します。ローカルの `test/test.html` も同じAPIを利用しますが、Worker内で公開サイトとテストページの記録を分けています。

- Worker: `kusa-pachi-ranking-test`（既存サービス名を継続）
- URL: `https://kusa-pachi-ranking-test.lordwitekingdom.workers.dev`
- D1: `kusa-pachi-ranking-test`（バインディング名 `DB`）
- Rate Limiter: `RANK_RATE_LIMIT`（IP・操作別に60秒あたり30回）
- Cron: `0 3 * * *` UTC。古い遊技・訪問記録を整理

`schema.sql` はD1のテーブル定義、`worker.js` はWorkerのソースです。ランキングは1・5・10草パチ別に直近24時間の「賞球 − 発射で消費した球」を合計します。補充、球と草の交換、ガチャ券は含めません。ランキング画面を開くと記録を同期し、トップ10、参加プレイヤー数、自分の順位、日本時間の本日の訪問ブラウザ数を表示します。

訪問者はランダムなブラウザ識別子で概算し、ページ表示時に日本時間の日付ごとに一度だけ記録します。ランキング情報は画面を開いた時、掛け金の切り替え時、または利用者が更新ボタンを押した時に取得します。定期的な訪問確認やランキングの自動更新は行いません。持ち球・草・ガチャ券・取得カードはAPIへ送信しません。

現在のスコアはブラウザ側で計算されます。架空の記録を完全には防げないため、競争性の高い賞品などへ利用する場合はサーバー側の遊技台帳が必要です。
