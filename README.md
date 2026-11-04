# DirtRelay

ORCA から SuperCollider の SuperDirt を鳴らすための中継アプリ（2026-11-04 に旧仮称 SuperDirt-SynthApp から改名）。ORCA の `;`（UDP 文字列）を受け、スロット 0〜f の割り当てに従って SuperDirt へ `/dirt/play` を送る。将来は汎用の OSC/UDP 受け口にする。

## 状況（2026-11-04）

| 段階 | 状態 |
|---|---|
| 1. 環境構築 | 済（SC 3.12.2 / SuperDirt v1.7.3 / ORCA desktop） |
| 2. 通信テスト | 済（ORCA → SuperDirt、実測結果は docs/01・00） |
| 3. 仕様ドキュメント | SuperDirt 受信仕様・比較ページ・要件メモまで |
| 4. プロトタイプ | **v0.1 動作中**（hub/）。スロット一覧・編集・LFO・orbit ミキサー・キーボード操作 |

## フォルダ

| パス | 中身 |
|---|---|
| `docs/00_通信仕様比較.html` | ORCA と SuperDirt の通信仕様比較（Artifact でも公開） |
| `docs/01_SuperDirt受信仕様.md` | SuperDirt の受信仕様（ソース＋実測） |
| `docs/02_ハブ要件メモ.md` | ハブの要件（G1'〜G8） |
| `docs/mock_スロット画面.html` | 画面モック |
| `sc/start_dirt.scd` | SuperDirt 起動（入力0ch、sc3plugins なしで使える super* を個別ロード） |
| `sc/listen.scd` / `run_listen.scd` | 0〜f 既定シンセの試聴 |
| `hub/` | ハブ本体（Node.js、依存なし） |
| `vendor/Orca/` | ORCA（hundredrabbits/Orca の clone） |

## 起動手順

1. **SuperDirt**: SuperCollider IDE で `sc/start_dirt.scd` を開いて実行（Cmd+Enter）。`HUB: SuperDirt ready` が出ればOK
2. **ハブ**:
   ```bash
   cd hub && npm start
   ```
   ブラウザで http://127.0.0.1:49170/ を開く（右上の ● が水色なら SuperDirt と疎通）
3. **ORCA**:
   ```bash
   cd vendor/Orca/desktop && npm start
   ```
   （初回は `npm_config_arch=x64 npm install` が必要。Electron 8 に Apple Silicon 版が無いため）

環境変数: `IN_PORT`(49161) `DIRT_HOST`(127.0.0.1) `DIRT_PORT`(57120) `HTTP_PORT`(49170) `LATENCY`(0.2)

## ORCA からの書き方（Pilot 互換）

`;[slot][octave][note][velocity][length]` — `D` の真下の行に置く（bang は上から当てる）

```
D4....D8....
............
;04C..;c3C..
```

- slot: `0`〜`f`、octave: `0`〜`8`、note: `C D E F G A B`（小文字はシャープ）
- velocity / length: 36進1文字（`0`〜`f` で 0〜1）。省略可
- `;bd:3` のようにサンプル名を直接書いても鳴る（orbit 0）
- `;bpm128` でハブのテンポ（LFO の周期）を変更
- `;` の文字列は最初の `.` で終わる。隣の演算子とは `.` で区切る

## キーボード（GUI）

`?` で一覧。一覧画面: `0`–`f` 選択 / `↑↓` / `Enter` 編集 / `t` 試聴 / `m` ミュート / `Space` 一括ON/OFF / `,` `.` BPM。
編集画面: `↑↓` 行 / `←→` 列 / `Space` ON/OFF / `-` `=` 値（Shift で大）/ `Enter` 直接入力 / `n` 追加 / `x` 削除 / `s` 音源 / `o` orbit / `Esc` 戻る。

設定は `hub/presets/current.json` に自動保存される。
