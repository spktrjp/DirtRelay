# SuperDirt 受信仕様（OSC）

- 対象: SuperDirt v1.7.3（quark: `v1.7.3-6-gf1c4ff9`）/ SuperCollider 3.12.2
- 根拠: SuperDirt ソース（`classes/SuperDirt.sc`, `DirtEvent.sc`, `DirtOrbit.sc`, `synths/*.scd`, `library/*.scd`）＋ 実機プローブ（2026-11-04、このMac）
- 位置づけ: 作るアプリ（DirtRelay）が **SuperDirt へ送る側** として守るべき仕様。ORCA 側の送信仕様は別紙（02_ORCA送信仕様.md 予定）。

---

## 1. トランスポート

| 項目 | 値 |
|---|---|
| プロトコル | OSC 1.0 over **UDP** |
| 受信ポート | `57120`（`~dirt.start(port, ...)` の第1引数。既定 57120） |
| 受信プロセス | **sclang**（言語側）。scsynth（57110）ではない |
| 送信元制限 | `start` の第3引数 `senderAddr`（既定 `NetAddr("127.0.0.1")`）の **IP のみ** 一致するものを受理。`"0.0.0.0"` を渡すと全受理。別マシンから送るなら起動時に指定が必要 |
| 返信先 | 送ってきたアドレス（送信元IP:送信元ポート）に返す。返信を受けたい送信側は **同じソケットで受信** すること |

> 注意: 送信元のポートは制限されない（IP のみ）。sclang の `langPort` が 57120 を既に開いているので、SuperDirt は同ポートを共有する。

---

## 2. 受信アドレス一覧

| アドレス | 引数 | 動作 | 返信 |
|---|---|---|---|
| `/dirt/play` | key/value ペアの並び（順不同） | 1イベントを発音 | なし（エラーは post にログのみ） |
| `/play2` | 同上 | `/dirt/play` の旧名（後方互換） | なし |
| `/dirt/hello` | なし | 疎通確認。返信先アドレスを記憶 | `/dirt/hello/reply`（引数なし） |
| `/dirt/handshake` | なし | サーバ情報の取得 | `/dirt/handshake/reply` `&serverHostname <str> &serverPort <int> &controlBusIndices <int...>` |
| `/dirt/synth-info` | `<synthName:str>` | SynthDef の引数名を照会 | `/dirt/synth-info/reply` `"<name> <arg1> <arg2> ..."`（1文字列・空白区切り） |
| `/dirt/setControlBus` | `<index:int> <value:float>` のペアの並び | コントロールバス（0–127）に値を書く | なし |
| `/dirt_soundfileinfo_request` | なし | ※`DirtRemoteSoundFileInfo` を別途起動した場合のみ | `/dirt_soundfileinfo_reply` |

実測（2026-11-04）:
```
→ /dirt/hello                    ← /dirt/hello/reply []
→ /dirt/handshake                ← /dirt/handshake/reply ["&serverHostname","127.0.0.1","&serverPort",57110,"&controlBusIndices",0..127]
→ /dirt/synth-info "dirt_lpf2"   ← /dirt/synth-info/reply ["dirt_lpf2 out cutoff resonance"]
```

### SuperDirt からの非同期送信（参考）
- `~dirt.startSendRMS` 実行時のみ、**scsynth が** `/rms`（SendPeakRMS, replyID = orbit 番号）を自分の登録クライアント（通常 sclang）へ送る（既定オフ）。外部アプリが受けるには scsynth(57110) に `/notify 1` で登録するか、sclang 側で転送する必要がある（未検証）。

---

## 3. `/dirt/play` の処理フロー

```
受信(msg, time)
 ├ latency = time - 現在時刻         ← OSC bundle のタイムタグが time になる
 │   latency > maxLatency(42s) なら警告して 0.2 に
 ├ event = (latency: ..) に key/value を putPairs
 ├ orbit = event.orbit ? 0  （範囲外は警告、orbits 数で wrap）
 └ DirtEvent(orbit).play
     ├ s が無ければ sound を "名前:番号" で分割 → s, n
     ├ s,n でサンプル or SynthDef を検索（無ければ "no synth or sample named ..." ログ）
     ├ 再生長(sustain)を計算。minSustain 未満なら破棄
     ├ 各モジュール（エフェクト）を「パラメータが非nilなら」挿入
     └ orbit のグローバルエフェクト（delay/reverb/leslie）を更新
```

### 3.1 タイミング（重要）
- **単発 message で送ると `time` = 受信時刻 → latency ≒ 0 → scsynth で「late」警告**（実測で再現）。
- **OSC bundle（`#bundle` + NTP タイムタグ = 現在 + 余裕）で包むと、その時刻に正確に発音し、late は出ない**（実測：+0.2s 指定で late 0件）。
- 推奨: アプリは `/dirt/play` を **常に bundle、タイムタグ = 送信時刻 + 固定レイテンシ（例 0.1〜0.2s）** で送る。ORCA の揺れもここで吸収する。
- 最終的な発音時刻 = タイムタグ + `lag` + `offset × |speed|`。

---

## 4. `/dirt/play` パラメータ

型: OSC の `s`(string) / `i`(int32) / `f`(float32) のどれでも可（sclang 側で数値は数値として扱われる）。**音名 `s`・`vowel`・`unit` は文字列で送る**。

### 4.1 音源指定（必須）

| key | 型 | 既定 | 意味 |
|---|---|---|---|
| `s` | str | — | サンプルバンク名 or SynthDef 名（例 `bd`, `superpiano`） |
| `n` | num | 0 | バンク内のサンプル番号（バンク数で wrap）／シンセでは音程（`note` が無い場合） |
| `sound` | str | — | `s` の代わりに `"bd:3"` 形式で指定可（`s` があればそちら優先） |

### 4.2 orbit・時間

| key | 型 | 既定 | 意味 |
|---|---|---|---|
| `orbit` | int | 0 | 出力トラック（起動時 `0 ! 12` なら 0–11）。エフェクト（delay/reverb）は orbit 単位で共有 |
| `cps` | float | 1.0 | cycles per second（Tidal のテンポ）。`unit c`・delay `lock` で使用 |
| `delta` / `dur` | float | 1.0 | イベント間隔（秒）。`legato` の基準 |
| `legato` | float | — | 指定時 `sustain = delta × legato` |
| `sustain` | float | — | 発音長（秒）を直接指定（最優先） |
| `lag` | float | 0 | 追加遅延（秒） |
| `offset` | float | 0 | 追加遅延（`× |speed|`） |
| `cut` | int | 0 | カットグループ。同 orbit の同グループの音を止める（負値はサンプル単位で同名のみ） |
| `cutAll` | any | — | 指定すると `cut` を orbit を跨いで適用 |

### 4.3 サンプル再生

| key | 既定 | 意味 |
|---|---|---|
| `speed` | 1.0 | 再生速度（負で逆再生） |
| `begin` / `end` | 0.0 / 1.0 | 再生区間（0–1） |
| `unit` | `"r"` | `"r"`=rate, `"c"`=cycle 同期, `"s"`=秒 |
| `loop` | 1.0 | ループ回数 |
| `accelerate` | — | 再生中の速度変化 |
| `timescale` | — | タイムストレッチ（指定時 stretch 用シンセ） |
| `gain` | 1.0 | 音量。実効係数 = `amp × (min(gain,2) + overgain)^4` |
| `overgain` | 0.0 | gain に加算 |
| `amp` | 0.4 | 線形音量 |
| `pan` | 0.5 | 0=左, 1=右（多ch時は `channel` も） |
| `fadeTime` | 0.001 | 発音頭尾のフェード |

### 4.4 音程（シンセ向け）

| key | 既定 | 意味 |
|---|---|---|
| `note` | — | 半音（`n` より優先） |
| `octave` | 5 | `midinote = note(or n) + octave × 12` |
| `midinote` | 上式 | 直接指定も可 |
| `freq` | `midinote.midicps` | 直接指定も可 |

### 4.5 イベント単位エフェクト（パラメータが「非nil」のとき挿入）

| モジュール | トリガ key | 関連 key（括弧内は既定） |
|---|---|---|
| vowel | `vowel`（str: a e i o u） | `resonance` |
| shape（歪み） | `shape` | |
| lpf | `cutoff` (Hz) | `resonance` |
| hpf | `hcutoff` (Hz) | `hresonance` |
| bpf | `bandf` (Hz) | `bandq` (10) |
| crush | `crush` (4) | |
| coarse | `coarse` (>1 のとき) | |
| pitch shift | `psrate` | `psdisp` |
| envelope | `attack` / `release` | `hold`, `curve` (-3) |
| grain envelope | `tilt` | `plat`, `curve` |
| tremolo | `tremolorate` | `tremolodepth` (0.5) |
| phaser | `phaserrate` | `phaserdepth` (0.5) |
| 出力ルーティング | `to` | |
| パラメータ写像 | `toArg` | `from` |

sc3plugins 導入時のみ追加: `waveloss`, `squiz`, `fshift`, `triode`, `krush`, `octer`/`octersub`/`octersubsub`, `ring`, `distort`, `tsdelay`/`xsdelay`, `freeze`, `comb`, `smear`, `scram`, `binshift`, `hbrick`, `lbrick`, `real`/`imag`, `enhance`, `djf`。
**※ このMacは sc3plugins 未導入のため現状は使えない。**

### 4.6 orbit 共有エフェクト（グローバル）

| エフェクト | key（既定） |
|---|---|
| delay | `delay`（送り量, 0）, `delaytime`, `delayfeedback`, `lock`（1 で cps 同期） |
| reverb | `room`（0）, `size`（0.1）, `dry`（0） |
| leslie | `leslie`（0.5）, `lrate`（6.7）, `lsize`（0.3） |

- **値は残らない（実測 2026-11-04 で訂正）**: イベントが届くたびに、そのイベントの値で orbit のエフェクトシンセが上書きされる。key を含まないイベントが来ると、その orbit のエフェクトはシンセの既定値（`room` = 0 など）に戻る。
  - 実測: `room 0.9` のイベント → reverb の room = 0.9。続いて `room` を含まないイベント → room = 0.0（`GlobalDirtEffect.set` が nil を書き込むため）。
  - 含意: 同じ orbit を共有するスロット同士で `room` の有無や値が違うと、互いに打ち消し合う。reverb/delay は **orbit 単位で値を決め、その orbit の全イベントに同じ値を付ける**べき。

---

## 5. 音源の名前空間

- サンプル: 起動時 `loadSoundFiles` で読んだフォルダ名 = バンク名。現在 217 バンク（Dirt-Samples、`bd`(24) `sn`(52) `hh`(13) …）。
- シンセ（sc3plugins 不要）: `imp psin pmsin in in1 inr gabor dirac cyclo` 等。
- シンセ（sc3plugins 必要, 現状不可）: `superpiano supersaw superfm superkick super808 superhat supersnare superclap supersquare superpwm superchip supernoise superhammond supervibe superhoover superreese ...` 等 30 種。
- 存在しない名前: 発音せず sclang に `no synth or sample named '<s>' could be found.` を post（送信側への通知はない）。

---

## 6. アプリ設計への含意（メモ）

1. 送信は **bundle + タイムタグ**（レイテンシ設定可能に）。ORCA のフレーム揺れの吸収もここ。
2. 接続確認は `/dirt/hello` → `/dirt/hello/reply`、サーバ情報は `/dirt/handshake`。
3. エラー（音源なし）は OSC で返らない → 必要ならアプリ側で `s` を事前検証（バンク一覧を持つ or sclang 拡張で問い合わせ口を追加）。
4. 連続値の操作（ノブ等）は `/dirt/setControlBus` + 各パラメータを `"cN"` バス参照、という経路もある（Tidal の `cB` 系）。要検証。
5. 外部（別マシン）からの受信は SuperDirt 起動時の `senderAddr` 設定が必要 → アプリが SuperDirt の起動スクリプトも持つべきか検討。
6. 起動の注意: このMac（SC 3.12.2 / Rosetta）ではヘッドレス起動時、入力デバイスを開くと scsynth が停止 → `numInputBusChannels = 0` で起動している。

---

## 付録: 最小送信例（bundle、Node.js 手書きエンコード）

```js
// /dirt/play s bd n 1 cutoff 800 room 0.3 size 0.8 orbit 1 を 0.2 秒後に
const t = Date.now() / 1000 + 0.2 + 2208988800 // Unix→NTP
// "#bundle\0" + NTP秒(u32) + NTP小数(u32) + size(i32) + message
```
実装は検証用スクリプト `dirt_probe.js`（作業フォルダ）を参照。
