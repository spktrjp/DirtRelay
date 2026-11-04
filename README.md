# DirtRelay

ORCA などのシーケンサーから届く短いメッセージを、スロット（0〜f）ごとの音色・エフェクト・動き付きで SuperCollider の **SuperDirt** へ中継するアプリです。

```
ORCA ;04C ──UDP 49161──▶ DirtRelay ──OSC bundle──▶ SuperDirt :57120 ──▶ 音
                             ▲
                       ブラウザ GUI（http://127.0.0.1:49170/）
```

> 状態: v0.2（2026-11）。SuperCollider 3.14.1 + SuperDirt v1.7.3 + sc3-plugins 3.14.1 で、macOS（Apple Silicon）用の Electron アプリとして動作確認しています。

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
| [sc3-plugins](https://github.com/supercollider/sc3-plugins/releases) | 3.14.1 | 任意。superpiano・supersaw・superfm など7種のシンセと、追加エフェクトに必要です。SuperCollider と同じバージョンを使います |
| Node.js | 18 以上（確認は 22） | |
| [ORCA](https://github.com/hundredrabbits/Orca) | desktop 版 | 他者のリポジトリのため、このリポジトリには含めていません |

### 1. SuperDirt

SuperCollider を起動し、次を1回だけ実行します。サンプル（Dirt-Samples）のダウンロードに数分かかります。

```supercollider
Quarks.checkForUpdates({ Quarks.install("SuperDirt", "v1.7.3"); thisProcess.recompile() })
```

#### sc3-plugins（任意）

[リリースページ](https://github.com/supercollider/sc3-plugins/releases) から SuperCollider と同じバージョンの `sc3-plugins-<版>-macOS.zip`（universal 版）をダウンロードします。中の `SC3plugins` フォルダを次の場所に置きます。

```bash
open ~/Library/Application\ Support/SuperCollider/Extensions
```

- 古い sc3-plugins（Intel 専用版など）が既にある場合は、`Extensions` の外へ移してから入れ替えてください。同じクラスが2つあると、SuperCollider がエラーになります。
- 入れなくても DirtRelay は動きます（super* シンセのうち25種が使えます）。

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

### 入力プロトコルの切り替え

画面上部のボタン（または `i` キー）で、どちらで受けるかを切り替えます。選んだ方だけを受けます。設定は保存されます。

| プロトコル | ポート | 送り方 |
|---|---|---|
| **ORCA UDP** | 49161 | ORCA の `;` オペレータ。上の書式（`;04C` など） |
| **DirtRelay OSC** | 49162 | OSC。Max / Pd / TouchDesigner / Ableton（Max for Live）など、OSC を送れるツールから SuperDirt を操作するためのものです |
| **Tidal** | 57130 | TidalCycles の中継。下の「Tidal から使う」 |

DirtRelay OSC で受け付けるメッセージ：

| アドレス | 引数 | 例 |
|---|---|---|
| `/dirtrelay` | 文字列（いくつでも） | `/dirtrelay "04C" "c3C"`：ORCA UDP と同じ書式を OSC で送ります。Max、Pd、TouchDesigner などから使えます |
| `/dirtrelay/note` | slot octave semitone [velocity length] | `/dirtrelay/note 1 5 4 0.5`：スロット1、オクターブ5、E（半音 0〜11）、velocity 0.5 |
| `/dirtrelay/bpm` | bpm | `/dirtrelay/bpm 128` |
| `/dirtrelay/play` | slot [key value …] | `/dirtrelay/play 3 note 7 cutoff 900`：スロット3を鳴らします。後ろに付けた SuperDirt のパラメータは、スロットの設定より優先されます（slot は数値か `"c"` のような文字） |
| `/dirt/play` | key value … | SuperDirt の生の命令をそのまま中継します（レイテンシ付きの bundle にして送り、画面上部に表示）。スロットの設定は使いません |

### DirtRelay OSC 仕様

Max / Pd / TouchDesigner / Max for Live / Python など、OSC を送れるツールから SuperDirt を操作するための入口です。入力を **DirtRelay OSC** にしたときだけ受け付けます。

#### 通信

| 項目 | 内容 |
|---|---|
| トランスポート | OSC 1.0 over UDP |
| ポート | `49162`（環境変数 `OSC_PORT` で変更可） |
| 送信元 | 制限なし（すべてのネットワークインターフェースで受信。同じ LAN の別のマシンからも送れます） |
| 受け付ける型 | `i`（int32）、`f`（float32）、`s` / `S`（文字列）、`d`（double）、`h`（int64）、`T` / `F`（1 / 0 として扱う） |
| bundle | 受け付けます。中のメッセージを順に処理します。**タイムタグは使わず**、届いた時点から DirtRelay のレイテンシ（既定 0.2 秒、`[` `]` で調整）後に鳴ります |
| 返信 | ありません |
| 解釈できないもの | 無視します（画面上部に `- ` 付きで表示） |

#### アドレス

**`/dirtrelay` ⟨文字列…⟩** — ORCA UDP と同じテキスト書式

- 文字列の引数1つが1メッセージです（1つの文字列の中を `;` で区切ってもかまいません）
- 書式は「ORCA での書き方」と同じです：`"04C"`（スロット0・オクターブ4・C）、`"f4C8"`（velocity 8/15）、`"bd:3"`（サンプル直接）、`"bpm128"`
- 例：`/dirtrelay "04C" "c3C"`

**`/dirtrelay/note` ⟨slot:int⟩ ⟨octave:int⟩ ⟨semitone:int⟩ [⟨velocity:float⟩ ⟨length:float⟩]** — 数値で鳴らす

| 引数 | 範囲 | 意味 |
|---|---|---|
| slot | 0〜15 | スロット番号 |
| octave | 0〜8 | オクターブ |
| semitone | 0〜11 | 半音（0 = C、1 = C#、… 11 = B） |
| velocity | 0〜1（省略可） | 音量。`amp = 0.6 × velocity` として送ります |
| length | 0〜1（省略可） | 音の長さ（1 = 1小節）。シンセのみ `sustain` に反映し、省略時はスロットの `sus` を使います |

- 音程は `note = semitone + (octave − 5) × 12` として SuperDirt に送ります（octave 5 の C が note 0 = MIDI 60）
- サンプルのスロットでは、音程を再生速度（`speed = 2^(note/12)`）に変えます
- 例：`/dirtrelay/note 1 5 4 0.5` → スロット1で E5、velocity 0.5

**`/dirtrelay/play` ⟨slot⟩ [⟨key:string⟩ ⟨value⟩ …]** — スロットを鳴らし、任意のパラメータで上書き

- slot は数値（`3`）か 36進の文字（`"c"`）
- 後ろの key / value は SuperDirt のパラメータ名と値です（`cutoff`、`room`、`speed`、`n`、`gain`、`vowel` など、[docs/01](docs/01_SuperDirt受信仕様.md) §4 のどれでも）
- 優先順位：**ここで送った値 ＞ orbit ミキサー ＞ スロットの設定**
- `note` は音程として扱います（省略時は 0）
- 例：`/dirtrelay/play 3 note 7 cutoff 900 room 0.3`
- 編集画面の out 欄では、上書きした値が下線付きで表示されます

**`/dirtrelay/bpm` ⟨bpm:number⟩** — DirtRelay のテンポ（LFO の周期と length の基準）

- 20 以上。整数に丸めます。例：`/dirtrelay/bpm 128`

**`/dirt/play` ⟨key:string⟩ ⟨value⟩ …** — SuperDirt の命令をそのまま中継

- スロット・orbit ミキサーの設定は使いません。SuperDirt の機能をすべて直接使えます
- DirtRelay のレイテンシを付けた bundle にして SuperDirt に送ります
- 数値は float で送ります（`orbit` と `cut` だけは int）
- 例：`/dirt/play s "bd" n 3 orbit 1 room 0.3`

#### 送信例

Python（[python-osc](https://pypi.org/project/python-osc/)）：

```python
from pythonosc.udp_client import SimpleUDPClient
c = SimpleUDPClient("127.0.0.1", 49162)
c.send_message("/dirtrelay", "04C")
c.send_message("/dirtrelay/note", [1, 5, 4, 0.5])
c.send_message("/dirtrelay/play", [3, "note", 7, "cutoff", 900.0])
c.send_message("/dirt/play", ["s", "bd", "n", 3, "orbit", 1])
```

Pd（vanilla）：`[3 note 7 cutoff 900(` → `[oscformat dirtrelay play]` → `[list prepend send]` → `[list trim]` → `[netsend -u -b]`（`[connect 127.0.0.1 49162(` で接続）。Pd は数値を float で送りますが、slot などは整数に丸めて受けます。
Max：`[udpsend 127.0.0.1 49162]` に `/dirtrelay/play 3 note 7 cutoff 900` のメッセージを送ります。

### Tidal から使う（Tidal → DirtRelay → SuperDirt）

1. DirtRelay の入力を **Tidal** に切り替えます（上部のボタン、または `i`）
2. Tidal を [tidal/BootTidal.hs](tidal/BootTidal.hs) で起動します。いつもの BootTidal.hs を使う場合は、`superdirtTarget` の `oPort = 57120` を **`oPort = 57130`** に変えるだけです
3. いつも通り `d1 $ s "bd*4"` などを書きます。Tidal に `Connected to SuperDirt.` と出ればつながっています

DirtRelay がすること：

- Tidal の bundle を**タイムタグを保ったまま** SuperDirt に転送します。ハンドシェイクの返信は Tidal に戻します。何も設定しなければ完全に素通しなので、SuperDirt の機能はすべて使えます
- 画面上部に、届いた内容を `d1 s bd n 3 orbit 0` の形で表示します
- **orbit ミキサー**（o0〜o3）で ON にしたパラメータを、その orbit の Tidal の音に追加します。Tidal 側で同じパラメータを書いていた場合は、DirtRelay の値で上書きします
- コントロールバス（`^cutoff` などの `/c_set`）は、今まで通り Tidal から scsynth（57110）へ直接届きます

SuperDirt は DirtRelay が起動します。SuperCollider IDE で別に SuperDirt を起動する必要はありません。
確認環境：Tidal 1.9.4（このMac）。通信仕様は [docs/03_Tidal通信仕様.md](docs/03_Tidal通信仕様.md)。

### orbit の使い方

orbit は SuperDirt の「トラック」です。orbit ごとに、リバーブ（room / size）とディレイ（delay / delaytime / delayfeedback）が1組ずつあります。

1. **スロットの送り先 orbit を決める**：編集画面の `orbit` 欄（`o` キー）。既定では 0〜b が orbit 0、c〜f（打楽器）が orbit 1 です
2. **orbit のエフェクトを設定する**：一覧の下にある `o0`〜`o3` の行を選び（`↓` で移動）、`Enter` で開きます。`n` で room などを追加し、`Space` で ON にします。LFO も使えます
3. その orbit 宛てのすべての音に、同じ値が自動で付きます

例：o0 に `room 0.4 / size 0.8` を付けて上モノだけ響かせ、o1（打楽器）は乾いたままにする。

orbit を分ける理由：SuperDirt では room や delay が orbit 全体に1つしかありません。同じ orbit に「リバーブありの音」と「なしの音」が混ざると、届いた順に設定が上書きされて打ち消し合います（[docs/01](docs/01_SuperDirt受信仕様.md) §4.6 の実測）。

### 画面

**一覧（リスト）**：1行が1スロットです。

```
0 ● superhammond  o0  ;04C   [∿ cutoff 1519] [— resonance -]
```

スロット番号、受信ランプ、音源、orbit、最後に届いた文字列、パラメータが並びます。パラメータは小さな波形と現在値で表示し、OFF のものは点線・グレーになります。
下段は orbit 0〜3 のミキサーです（room / delay など）。

**編集**：Enter またはダブルクリックで開き、`←` か Esc で戻ります。

- 上段：sound（シンセ37種（sc3-plugins なしでは30種）とサンプル全バンク）、`n`（サンプル番号）、orbit、sus（シンセの音の長さ）
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
| | `i` | 入力プロトコル切り替え（ORCA UDP → DirtRelay OSC → Tidal） |
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
| `OSC_PORT` | 49162 | DirtRelay OSC の受信ポート |
| `TIDAL_PORT` | 57130 | Tidal 中継の受信ポート（Tidal の `oPort` をここに） |
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
| superpiano / supersaw / superfm などが鳴らない | sc3-plugins が必要です（上記「sc3-plugins（任意）」）。入っていなくても、その他の super* 25種は鳴ります。アプリから起動した SuperDirt も、`~/Library/Application Support/SuperCollider/Extensions` の sc3-plugins を読み込みます |
| `ERROR: Class not defined` が十数行出る | sc3-plugins が無い環境で、`start_dirt.scd` が sc3-plugins 依存のシンセを読み飛ばしているだけなので、問題ありません |
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
| `tidal/BootTidal.hs` | DirtRelay 経由で Tidal を使うための BootTidal |
| `docs/` | 通信仕様（ORCA・SuperDirt・Tidal）・要件・画面モック |
| `vendor/Orca/` | ORCA（各自で取得。git 管理外） |

## 今後

- ORCA `=`（整数OSC）と MIDI の受け口
- Pilot の音色命令（OSC / ENV / エフェクト）の読み替え
- プリセットの切り替え
- ORCA ライクな見た目
- 汎用 OSC/UDP の受け口
