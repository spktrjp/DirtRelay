# DirtRelay

ORCA などのシーケンサーから届く短いメッセージを、スロット（0〜f）ごとの音色・エフェクト・動き付きで SuperCollider の **SuperDirt** へ中継するアプリです。

```
ORCA ;04C ──UDP 49161──▶ DirtRelay ──OSC bundle──▶ SuperDirt :57120 ──▶ 音
                             ▲
                       ブラウザ GUI（http://127.0.0.1:49170/）
```

> 状態: v0.2（2026-11）。macOS（Apple Silicon）用の Electron アプリとして動作確認しています。

---

## コンセプト

### なぜ必要か

ORCA は SuperDirt に直接つないでも鳴りません。

- ORCA の OSC（`=`）はアドレスが1文字、引数は整数だけです。`/dirt/play s bd` のような「音名＋パラメータ」を作れません。
- ORCA の UDP（`;`）は文字列を送れますが、最大36文字で、使える記号も限られます。
- SuperDirt は、タイムスタンプなしで届いた命令を即時扱いにするため、`late` 警告が出ます。

詳細は [docs/00_通信仕様比較.html](docs/00_通信仕様比較.html) と [docs/01_SuperDirt受信仕様.md](docs/01_SuperDirt受信仕様.md) にあります。

### 役割分担

- **ORCA**：「いつ・どのスロットを・どの音程で」鳴らすかに専念します。
- **DirtRelay**：音色の割り当て、フィルターなどのエフェクト、パラメータの時間変化（LFO）を受け持ちます。どれも ORCA からは出せないものです。
- **SuperDirt**：実際の発音を担当します。

### 設計方針

- **16スロット（0〜f）**：Pilot（Hundred Rabbits のシンセ）と同じ書式 `;04C` で、先頭1文字がスロットになります。既存の ORCA パッチがそのまま使えます。
- **ライブ向け**：0〜f を1画面に一覧します。届いている値を見ながら、その場で割り当てを変えられます。幅は 960px で、Full HD の片側に ORCA と並べられます。
- **キーボードだけで全操作**：ORCA と同じ思想です。マウスでも操作できます。
- **未設定＝送らない**：Tidal と同じく、設定したパラメータだけを送ります。
- **orbit 共有エフェクトは orbit 単位**：SuperDirt では room や delay が orbit 全体に効き、含まない音が来るとオフに戻ります。そのため、orbit ごとに設定して、その orbit 宛ての全部の音に付けます。
- **正確なタイミング**：すべて OSC bundle（受信時刻＋レイテンシ）で送ります。
- **依存なし**：Node.js 標準ライブラリだけで動きます。

---

## インストール

### 必要なもの

| もの | 確認したバージョン | 備考 |
|---|---|---|
| macOS | 27 / Apple Silicon | |
| [SuperCollider](https://supercollider.github.io/) | 3.14.1 | `brew install --cask supercollider`。3.13 以降は Apple Silicon ネイティブ（3.12 以前は Rosetta で動き、音が途切れやすい） |
| SuperDirt（quark） | v1.7.3 | 下記の手順で入れます |
| Node.js | 18 以上（確認は 22） | |
| [ORCA](https://github.com/hundredrabbits/Orca) | desktop 版 | 他者のリポジトリのため、このリポジトリには含めていません |

### 1. SuperDirt

SuperCollider を起動し、次を1回だけ実行します。サンプル（Dirt-Samples）のダウンロードに数分かかります。

```supercollider
Quarks.checkForUpdates({ Quarks.install("SuperDirt", "v1.7.3"); thisProcess.recompile() })
```

### 2. DirtRelay（アプリのビルド）

```bash
git clone https://github.com/spktrjp/DirtRelay.git
```

```bash
cd DirtRelay && npm install && npm run dist
```

`dist/DirtRelay-darwin-arm64/DirtRelay.app` ができます。`/Applications` にコピーして使ってください。

- 署名していないアプリです。別のMacへ持っていって初回に開くときは、右クリック →「開く」で起動してください。
- アプリを使わずに中継部分だけ動かすこともできます：`npm run relay`（依存なし、Node.js だけで動きます）。開発中は `npm start` で、ビルドせずにアプリとして起動できます。

### 3. ORCA

`vendor/Orca` に取得します（`.gitignore` 済みです）。

```bash
cd DirtRelay && git clone https://github.com/hundredrabbits/Orca vendor/Orca
```

```bash
cd vendor/Orca/desktop && npm_config_arch=x64 npm install
```

`npm_config_arch=x64` は、ORCA が使う Electron 8 に Apple Silicon 版がないためです（Rosetta 上で動きます）。
itch.io 版の ORCA アプリを使う場合、この手順は不要です。

---

## 使い方

### 起動（毎回）

1. **DirtRelay.app を開きます。**
   - SuperDirt が動いていなければ、アプリが裏で自動的に起動します（[sc/start_dirt.scd](sc/start_dirt.scd) を使います）。
   - 準備ができるまで 25〜90 秒ほどかかります。上部の `● dirt` が赤から水色になれば準備完了です。
   - すでに SuperCollider IDE などで SuperDirt を起動している場合は、そちらにつなぎます。
   - アプリを終了すると、アプリが起動した SuperDirt も一緒に止まります。
   - メニューの **SuperDirt** から、開始・再起動・停止、ログやプリセットのフォルダを開く、ができます。
2. **ORCA**
   ```bash
   cd vendor/Orca/desktop && npm start
   ```

試聴だけしたいときは、SuperCollider で [sc/listen.scd](sc/listen.scd) を実行してから `~listen.()` を実行します。0〜f が順に鳴ります。

### ORCA での書き方

`;` オペレータ（UDP）を使います。bang は上から当ててください（`D` の真下の行に `*` が出て、その下の `;` が発火します）。

```
D4....D8....D2....
..................
;04C..;c3C..;f4C8.
```

| 書式 | 意味 |
|---|---|
| `;[slot][octave][note]` | 例 `;04C`：スロット0、オクターブ4、C |
| `;[slot][octave][note][velocity][length]` | 例 `;f4C8`：velocity・length は36進1文字（`0`〜`f` で 0〜1） |
| note | `C D E F G A B`。小文字はシャープ（`c` = C#） |
| `;bd:3` | サンプル名を直接指定して鳴らします（orbit 0） |
| `;bpm128` | DirtRelay のテンポ（LFO 周期の基準）を変えます |

デモ：[examples/demo.orca](examples/demo.orca) を ORCA で開く（File → Open、またはウィンドウへドラッグ）と、ビブラフォンの8分音符、ベース、キック・スネア・ハット、小節頭のオルガンが鳴ります。

注意：`;` の文字列は最初の `.` で終わります。隣の演算子とは `.` で区切ってください。`-` や `_` は ORCA に置けません。

### 画面

**一覧（リスト）**：1行が1スロットです。

```
0 ● superhammond  o0  ;04C   [∿ cutoff 1519] [— resonance -]
```

スロット番号、受信ランプ、音源、orbit、最後に届いた文字列、パラメータが並びます。パラメータは小さな波形と現在値で表示し、OFF のものは点線・グレーになります。
下段は orbit 0〜3 のミキサーです（room / delay など）。

**編集**：Enter またはダブルクリックで開き、`←` か Esc で戻ります。

- 上段：sound（シンセ30種とサンプル全バンク）、`n`（サンプル番号）、orbit、sus（シンセの音の長さ）
- パラメータ行：`名前｜●/○（ON/OFF）｜波形｜bars（何小節で1周）｜min｜max｜×`
  - 波形：`—` 固定、`∿` sine、`⟋` saw、`△` tri、`⊓` square、`⁘` rand、`≈` perlin
  - 例：Tidal の `cutoff (range 300 3000 (slow 4 sine))` は、ここでは `cutoff ● ∿ 4 300 3000` の1行になります。
  - OFF の間は送りませんが、設定は保持し、編集もできます。仕込んでおいて本番で ON にできます。
- 右側：受信ログ（in）と、実際に送った `/dirt/play`（out）

設定は自動で保存されます。保存先は、アプリでは `~/Library/Application Support/DirtRelay/presets/current.json`、`npm run relay` では `hub/presets/current.json` です。

### キーボード

`?` でいつでも一覧を出せます。

| 画面 | キー | 動作 |
|---|---|---|
| 一覧 | `0`–`f` / `↑` `↓` | スロット選択 / 移動（orbit 行まで） |
| | `Enter` | 編集画面へ |
| | `t` | 選択スロットを試聴 |
| | `m` | ミュート / 解除 |
| | `Space` | スロットの全パラメータを一括 ON / OFF |
| | `,` `.` | BPM −1 / +1 |
| | `[` `]` | レイテンシ −0.05 / +0.05 秒 |
| 編集 | `↑` `↓` / `←` `→` | 行 / 列（ON・波形・bars・min・max）の移動 |
| | `Space` | ON / OFF |
| | `-` `=` | 値を下げる / 上げる（波形の欄では切替）。Shift で大きく |
| | `Enter` | その欄に直接入力（もう一度 Enter で確定） |
| | `n` / `x` | パラメータ追加 / 削除 |
| | `s` / `o` | sound / orbit 欄へ |
| | `t` / `m` | 試聴 / ミュート |
| | `0`–`f` | 別スロットの編集へ |
| | `Esc` | 一覧へ戻る |

### 設定（環境変数）

| 変数 | 既定値 | 内容 |
|---|---|---|
| `IN_PORT` | 49161 | 受信ポート（ORCA `;` の既定送信先） |
| `DIRT_HOST` / `DIRT_PORT` | 127.0.0.1 / 57120 | SuperDirt の宛先 |
| `HTTP_PORT` | 49170 | GUI |
| `LATENCY` | 0.2（プリセットに保存） | SuperDirt へ送る bundle の先行時間（秒）。GUI の `[` `]` でも変更可 |
| `DIRT_SAMPLES` | `~/Library/Application Support/SuperCollider/downloaded-quarks/Dirt-Samples` | サンプル一覧の読み込み元 |

```bash
LATENCY=0.1 npm start
```

---

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `● dirt` が赤いまま | 起動直後なら、そのまま待ってください（最大90秒ほど）。続く場合は、メニュー SuperDirt → Open SuperDirt Log でログを確認するか、Restart SuperDirt を試してください |
| scsynth が `Found 0 LADSPA plugins` で止まる | 入力デバイス（マイク）を開けていません。`start_dirt.scd` は入力0chにしてあります。IDE から起動してマイクを許可するか、入力0chのまま使ってください |
| superpiano / supersaw / superfm などが鳴らない | sc3plugins が必要です（未導入でも、その他の super* 25種は鳴ります） |
| `ERROR: Class not defined` が十数行出る | `start_dirt.scd` が sc3plugins 依存のシンセを読み飛ばしているだけなので、問題ありません |
| 音がときどき途切れる・遅れる | SuperCollider 3.12 以前（Intel 版で Rosetta 上で動く）がときどき止まるのが原因です。SuperCollider 3.13 以降（Apple Silicon ネイティブ）に上げてください（実測：3.12 では 90 秒で 21 回途切れ、3.14.1 では 0 回）。上げられない場合は `]` でレイテンシを 0.5 秒程度に上げると途切れなくなります |
| ORCA の `npm install` が 404 で失敗する | `npm_config_arch=x64` を付けて実行してください |
| 「UDP 49161 … in use」と出てアプリが閉じる | 他に 49161 を使うアプリ（Pilot など）を閉じるか、`IN_PORT` を変えてください（ORCA 側の送信先も合わせる） |

---

## フォルダ構成

| パス | 中身 |
|---|---|
| `electron/main.js` | アプリ本体（中継部の起動、ウィンドウ、SuperDirt の自動起動・停止、メニュー） |
| `hub/server.js` | 中継部（UDP 受信 → 解釈 → OSC bundle 送信、HTTP + SSE） |
| `hub/public/` | GUI（`index.html`）と、サーバー・GUI 共通の波形計算（`wave.js`） |
| `hub/presets/` | 設定の保存先 |
| `sc/` | SuperDirt 起動・試聴スクリプト |
| `docs/` | 通信仕様・要件・画面モック |
| `vendor/Orca/` | ORCA（各自で取得。git 管理外） |

## 今後

- ORCA `=`（整数OSC）と MIDI の受け口
- Pilot の音色命令（OSC / ENV / エフェクト）の読み替え
- プリセットの切り替え
- ORCA ライクな見た目
- 汎用 OSC/UDP の受け口
