# Tidal → SuperDirt 通信仕様（Tidal 送信側）

- 対象: TidalCycles **v1.10.0**（2025-06、GitHub `tidalcycles/Tidal` main `fefb1c3`）
- 根拠: Tidal ソース `src/Sound/Tidal/Stream/Target.hs`, `Stream/Process.hs`, `Stream/Types.hs` を読んで確認（2026-11-04）。実機（Tidal 1.9.4）で DirtRelay 経由の送受信を確認：ハンドシェイク成立（Connected to SuperDirt.）、d1〜d3 の104イベントを中継、SuperDirt 側のエラー・late 0件
- 受信側（SuperDirt）の仕様は [01_SuperDirt受信仕様.md](01_SuperDirt受信仕様.md)

---

## 1. 接続先（`superdirtTarget`）

| 項目 | 値 | 意味 |
|---|---|---|
| `oAddress` | `127.0.0.1` | SuperDirt の IP |
| `oPort` | `57120` | `/dirt/play` などの送り先（sclang） |
| `oBusPort` | `57110` | `/c_set` の送り先（**scsynth に直接**） |
| `oLatency` | `0.2` | 先行送信の秒数 |
| `oSchedule` | `Pre BundleStamp` | イベントを **OSC bundle のタイムタグ**付きで先に送る |
| `oHandshake` | `True` | 起動時に `/dirt/handshake` を送る |

Tidal は `oPort` 宛てに送るのと**同じ UDP ソケット**で返信を受ける。

## 2. ハンドシェイク

```
Tidal ──/dirt/handshake──────────────▶ SuperDirt(57120)
Tidal ◀─/dirt/handshake/reply──────── &serverHostname 127.0.0.1 &serverPort 57110 &controlBusIndices 0 1 … 127
```

- 返信の `&controlBusIndices` 以降の整数列（コントロールバスの実番号）を保存する。これが `^param` を使うときのバス番号の対応表になる
- 返信が来るまで 2 秒ごとに再送する（ログ「Waiting for SuperDirt (v.1.7.2 or higher)..」）
- SuperDirt から `/dirt/hello` を受けたら、ハンドシェイクをやり直す

## 3. イベント（`/dirt/play`）

1イベント＝1つの bundle：

```
#bundle  [タイムタグ = 発音時刻 − oLatency + nudge 等]
  /dirt/play  "key1" v1  "key2" v2 …     （名前付き。順不同）
```

- 必須キーは `s`（`superdirtShape = OSC "/dirt/play" (Named {requiredArgs = ["s"]})`）。`s` が無いイベントは送られない
- 値の型: 小数 → `f`、整数 → `i`、文字列 → `s`、真偽 → `i`(1/0)、有理数 → `f`、バイト列 → `b`
- パターンに書いたパラメータ**だけ**が入る（未指定は送らない）。それに加えて、Tidal が毎回付けるもの：

| キー | 型 | 内容 |
|---|---|---|
| `cps` | f | 現在のテンポ（cycles per second） |
| `cycle` | f | イベントのサイクル位置 |
| `delta` | f | イベントの長さ（秒） |
| `_id_` | s | どの `d1`〜 から出たか（`"1"` など） |
| `orbit` | i | 書いた場合だけ（`d1 $ … # orbit 1`）。書かなければ SuperDirt 側で 0 |

例：`d1 $ s "bd*2" # n 3 # cutoff 800`
```
/dirt/play "_id_" "1" "cps" 0.5625 "cutoff" 800.0 "cycle" 12.5 "delta" 0.888… "n" 3.0 "s" "bd"
```

## 4. コントロールバス（`^param`、連続値）

`# cutoff "^1"` や `# cutoffbus 1 (segment 32 $ range 200 2000 sine)` のようにバスを使うと：

1. `/dirt/play` には `"cutoff" "c5"` のように**文字列 `c<実バス番号>`** が入る（バス番号はハンドシェイクで得た対応表で変換）
2. 値そのものは別メッセージで**scsynth（57110）に直接**送る：

```
#bundle [タイムタグ]
  /c_set  <実バス番号:i>  <値>
```

→ 鳴っている最中の音のパラメータを動かせる（イベント単位ではなく連続変化）。DirtRelay の LFO はイベント単位なので、これは別物。

## 5. その他

- Tidal 自身は 6010 番でリモート操作（`/ctrl` 等）を受ける（SuperDirt 通信とは別系統）
- `oSchedule = Pre BundleStamp` なので、Tidal は「少し先の分」をまとめて先送りする。受け手（SuperDirt）がタイムタグに従って鳴らす

---

## 6. Tidal → DirtRelay → SuperDirt（2026-11-04 実装済み、Tidal 1.9.4 で確認）

```
Tidal ──57130(/dirt/play, /dirt/handshake)──▶ DirtRelay ──57120──▶ SuperDirt
  │                                              ◀─返信を Tidal へ中継─┘
  └──────────────── /c_set ─────────────────────────────────────▶ scsynth 57110（直接）
```

- Tidal 側は `oPort` だけ変える（例 57130）。`/c_set` は今まで通り scsynth 直結で問題ない
- DirtRelay は `/dirt/play` の bundle を**タイムタグを保ったまま**転送する。そのうえで任意で次のことをする：
  - 中身を見せる（GUI のモニタ。どの `d1` から何が出ているか）
  - パラメータの上書き・追加（orbit ごとのエフェクト、LFO、ミュートなど）
- `/dirt/handshake`・`/dirt/hello` の返信は、送ってきた Tidal のアドレスへ転送する
- 透過モード（何もしない）なら、SuperDirt の機能はすべてそのまま使える
