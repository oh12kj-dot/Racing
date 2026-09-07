# TODO.md — 現在実行するタスク

Last updated: 2026-09-06
Current Phase: **Phase 1A — Track Foundation**

---

## 決定済み（人間承認取得済み 2026-09-06）

| # | 決定事項 | ADR | 状態 |
|---|---------|-----|------|
| H-1 | Simulation Core の言語 = **Rust** | ADR-0001 / ADR-0005 | ✅ 承認 |
| H-2 | 製品レンダラ = **Unreal Engine 5**（Code-First 運用制約つき） | ADR-0004 | ✅ 承認 |
| H-3 | アセットは購入せず **Web 画像を参照して自作**（Blender headless + Python） | ADR-0006 | ✅ 承認 |

---

## Phase 0 — 完了

- [x] リポジトリ監査（結果: 空。既存コードなし → ADR-0000）
- [x] 環境実測（RTX 4060 Ti **8GB** / Ryzen 7 5700X / 32GB / rustc 1.95.0）
- [x] Performance Budget 確定
- [x] Target Architecture 設計
- [x] PROJECT.md / ARCHITECTURE.md / PLAN.md / TESTING.md / DECISIONS.md / TODO.md
- [x] 人間承認（H-1 / H-2 / H-3）

---

## Phase 1A — Track Foundation

| Task | 内容 | 担当 | 状態 |
|------|------|------|------|
| TASK-1A-1 | `sim-math`: 数学基盤と決定的 RNG | Opus 5 | ✅ **完了・APPROVED** |
| TASK-1A-2 | `sim-track`: Track Coordinate System | **Sonnet 5** | ⬅ **NEXT** |
| TASK-1A-3 | トラック定義データのロード（serde）+ テストトラック 1 本 | Sonnet 5 | 未着手 |
| TASK-1A-4 | `sim-wasm` + `view-engineering` 最小ビューア | Sonnet 5 | 未着手 |

### Phase 0.5（並行）

| Task | 内容 | 担当 | 状態 |
|------|------|------|------|
| TASK-05-1 | UE5 導入 + `Config/DefaultEngine.ini` レンダラ設定 | 人間 + Sonnet | 未着手 |
| TASK-05-2 | Blender LTS 4.5 導入 + `tools/blender/` 生成基盤 | Sonnet 5 | 未着手 |
| TASK-05-3 | M1〜M9 実測（PLAN.md Phase 0.5） | Opus + 人間 | 未着手 |

---

# TASK-1A-1 — 完了報告 / レビュー記録

**実装**: Opus 5（基盤層の品質基準を確定させるため例外的に Architect が実装）

### Implemented Files
```
Cargo.toml, rust-toolchain.toml, .gitignore
crates/sim-math/Cargo.toml
crates/sim-math/src/{lib,vec,quat,spline,rng,util}.rs
crates/sim-math/tests/{vec_quat,spline,rng_util}.rs
```

### Test Results
```
cargo test --release
  vec_quat  : 12 passed
  spline    : 14 passed
  rng_util  : 11 passed
  doc-tests :  1 passed
  ---------------------
  合計 38 passed / 0 failed
cargo clippy --all-targets -- -D warnings : 0 issues
cargo build --release                     : 0 warnings
cargo fmt --check                         : clean
unsafe コード                              : 0（#![deny(unsafe_code)]）
本体依存クレート                            : 0
```

### Performance（実測 / RTX 4060 Ti + Ryzen 7 5700X）

| 項目 | 仕様当初の基準 | 実測 | 判定 |
|------|--------------|------|------|
| `Rng::next_f64` | < 5 ns | **0.91 ns** | ✅ |
| `ArcLengthSpline::closest_s`（hint 有） | < 200 ns | **420 ns** | ⚠️ 基準を修正（下記） |
| `ArcLengthSpline::closest_s`（hint 無） | — | 3 800 ns | 参考値 |

**基準の修正について（Opus 判断）**
当初の 200 ns は予算から導出したものではなく恣意的だった。実際の呼び出し量は
24 台 × 60 Hz Simulation Tick = 1440 call/s であり、420 ns なら 0.010 ms/frame、
Perception / Spatial query 予算 0.5 ms の **2.0%** にすぎない。
**基準を「< 1 µs（予算比 5% 以内）」へ改める。**
これ以上の高速化はストライド探索等の近似を要し、エイリアシングのリスクに見合わない。

最適化の経緯: 969 ns → 720 ns（テーブルの SoA 化 + `pose_at` による探索の一本化）
→ **420 ns**（距離ベースの探索窓 + 窓端検出による全走査フォールバック）。
フォールバックにより、**探索窓の縮小は近似ではなく厳密**である
（テスト `spline_closest_s_survives_stale_hint` が半周ずれたヒントでも結果一致を検証）。

### Deviations from Spec（Opus が承認した仕様変更）

1. **`Quat::mul(self, rhs)` → `impl std::ops::Mul for Quat`**
   clippy の `should_implement_trait` に該当したため。`impl Mul<Vec3> for Quat` も追加。
   合成順序は `(a * b).rotate_vec3(v) == a.rotate_vec3(b.rotate_vec3(v))` として
   テスト `quat_composition_order` で固定した。
2. **`ArcLengthSpline::pose_at(s) -> (Vec3, Vec3)` を追加**
   位置と接線を同時に取る。`u_from_s` の二重実行を避けるため。
3. **`ArcLengthSpline::{control_point_s, control_point_count}` / `CubicSpline::segment_start_u` を追加**
   TASK-1A-2 でトラック断面定義（幅・バンク・カンバー）を `s` へ写すために必須。
   先に追加することで TASK-1A-2 のスコープを `sim-track` 内に閉じた。
4. **`ArcLengthSpline::HINT_SEARCH_RADIUS_M` を追加**（上記の最適化に伴う）
5. **`CubicSpline` の大域パラメータ配分をノットスパン比例とした**
   一様配分では境界で `dP/du` の大きさが不連続になる（G1 止まり）。
   比例配分により **真の C1** となる。テスト `spline_c1_continuity` で検証済み。

### Design Concerns Found
なし。

### Architecture Compliance
- ✅ Rendering / UI / Camera への依存ゼロ
- ✅ グローバル乱数・時刻依存乱数なし
- ✅ `f64` / fast-math 無効 / `codegen-units = 1`
- ✅ Waypoint index を持たない（連続量 `s` のみ）
- ✅ `signed_delta_s` をラップ処理の単一の正とした

### Decision: **APPROVED**

---

# NEXT SONNET TASK

## TASK-1A-2 — `sim-track`: Track Coordinate System

---

### IMPORTANT IMPLEMENTATION CONTRACT

あなたは **Implementation Engineer** です。
あなたはこのタスクの **Architect ではありません**。

Opus 5 によって承認された Architecture と Implementation Specification を **正確に** 実装してください。

以下を自己判断で変更してはいけません。

- Architecture / Module boundaries / Public interfaces / Data structures
- Technology stack / Dependencies
- Physics model / Racing AI model / Rendering architecture
- Naming conventions / Directory structure
- Task scope / Execution order

「こちらの方が良い」「一般的にはこの設計が良い」「リファクタリングした方が綺麗」
という理由による変更は **禁止** します。

#### NO UNAUTHORIZED DESIGN CHANGES

設計上の問題を発見した場合、**先にコードを変更してはいけません。** 以下の形式で報告してください。

```
PROPOSED DESIGN CHANGE
Current Design:
Observed Problem:
Root Cause:
Proposed Change:
Reason:
Expected Benefit:
Risk:
Affected Modules:
Affected Files:
Migration Impact:
Alternative:
```

Opus 5 の承認を得るまで、その変更を実装してはいけません。

#### BLOCKER RULE

仕様どおり実装するために Scope 外の変更が必要になった場合、勝手に変更せず以下として報告してください。

```
BLOCKED BY ARCHITECTURE
Task:
Blocking Issue:
Why Current Design Prevents Implementation:
Required Change:
Affected Scope:
Recommended Next Step:
```

#### NO UNAUTHORIZED REFACTORING

タスク対象外の Refactoring は禁止です。
特に **`crates/sim-math` は一切変更してはいけません**（TASK-1A-1 で APPROVED 済み）。
`sim-math` に変更が必要だと判断した場合は `BLOCKED BY ARCHITECTURE` として報告すること。

---

### Goal

**トラック局所座標系を確立する。** 以降のすべてのレースロジック
（順位・ラップカウント・車間・ライン・AI 判断）はワールド座標ではなく
この座標系の上で行われる。ARCHITECTURE.md §3 が本タスクの仕様の根拠である。

### Allowed Files

```
Cargo.toml                              (members に crates/sim-track を追加するのみ)
crates/sim-track/Cargo.toml             (新規)
crates/sim-track/src/lib.rs
crates/sim-track/src/coord.rs
crates/sim-track/src/surface.rs
crates/sim-track/src/definition.rs
crates/sim-track/src/track.rs
crates/sim-track/src/lap.rs
crates/sim-track/tests/*.rs
```

### Do Not Change
- `crates/sim-math/**` — **一切変更禁止**
- `PROJECT.md` `ARCHITECTURE.md` `PLAN.md` `TODO.md` `DECISIONS.md` `TESTING.md`
- 他の `crates/*` の新規作成（`sim-line` 等は後続タスク）
- `tools/` `assets/` `view-engineering/`

### Dependencies（これ以外を追加しない）

```toml
[dependencies]
sim-math = { path = "../sim-math" }

[dev-dependencies]
approx = "0.5"
```

`serde` は **このタスクでは追加しない**（ファイルロードは TASK-1A-3 の担当）。
本タスクはメモリ上の `TrackDefinition` から `Track` を構築するところまでを扱う。

---

### Required Changes

#### 1. `coord.rs` — トラック局所座標

```rust
/// トラック上の位置。レースロジックの唯一の正。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TrackCoord {
    /// センターライン沿いの弧長 [m]。`0 <= s < track.length()`
    pub s: f64,
    /// 横方向オフセット [m]。**左が正・右が負**
    pub t: f64,
}

impl TrackCoord {
    pub fn new(s: f64, t: f64) -> Self;
}

/// `s` における路面の幾何フレーム。
#[derive(Clone, Copy, Debug)]
pub struct TrackFrame {
    /// センターライン上のワールド位置。
    pub position: Vec3,
    /// 進行方向の単位ベクトル。
    pub tangent: Vec3,
    /// 路面法線（バンク・カンバーを含む）。
    pub normal: Vec3,
    /// 路面内で進行方向に直交する単位ベクトル。**左向き**。
    pub lateral: Vec3,
    /// 曲率 `1/R` [1/m]。**符号付き**（左カーブが正）。
    pub curvature: f64,
    /// バンク角 [rad]。左端が持ち上がる向きを正とする。
    pub banking: f64,
    /// カンバー角 [rad]。センターラインから両端が下がる向きを正とする。
    pub camber: f64,
    /// 標高 [m]（`position.y` と同値。利便のため保持）。
    pub elevation: f64,
    /// センターラインから左端までの距離 [m]（正）。
    pub width_left: f64,
    /// センターラインから右端までの距離 [m]（正）。
    pub width_right: f64,
}
```

**幾何規約（変更禁止・テストで固定すること）**

```
up            = Vec3::Y
lateral_flat  = up.cross(tangent).normalize()      // tangent=+X のとき -Z（= 左）
normal_flat   = tangent.cross(lateral_flat)        // 平坦時に +Y になる
lateral       = lateral_flat を tangent 軸まわりに banking だけ回した結果
normal        = normal_flat  を tangent 軸まわりに banking だけ回した結果
```

**曲率の符号**: `curvature = sign * spline.curvature_at(s)` とし、
`sign` は水平面での旋回方向から決める。
`sign = +1` if `d(tangent)/ds .xz().perp_dot(tangent.xz()) > 0`（左旋回）、else `-1`。
`sim-math` の `curvature_at` は符号なしの大きさを返すため、ここで符号を付与する。
曲率がほぼ 0 の直線区間では `sign` を `+1` として構わない（値が 0 なので影響しない）。

> **訂正履歴（Opus / 2026-09-07）**: 本仕様は当初 `tangent.xz().perp_dot(diff)` と
> 記載していたが、これは**引数の順序が逆で、左旋回に対し負を返す誤りだった**。
> 本規約では `lateral = up.cross(tangent)` としており（tangent=+X で `-Z` = 左）、
> これは標準的な CCW/+90 度の「左法線」規約とは逆の向きであるため符号が反転する。
> 検算: tangent=+X の左旋回では `d(tangent)/ds ≈ (0,0,-ε)`。
> `tangent.xz().perp_dot(diff.xz()) = 1*(-ε) - 0*0 = -ε < 0`（誤）。
> `diff.xz().perp_dot(tangent.xz()) = 0*0 - (-ε)*1 = +ε > 0`（正）。
> TASK-1A-2 実装時に Sonnet 5 がこれを検出し報告した。上記が訂正後の正しい式である。

#### 2. `surface.rs` — 路面種別

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SurfaceKind {
    Asphalt,
    Kerb,
    Grass,
    Gravel,
    PitLane,
}

/// 路面の物理特性。`sim-vehicle` が参照する。
#[derive(Clone, Copy, Debug)]
pub struct SurfaceProperties {
    /// グリップ係数の倍率。Asphalt を 1.0 とする。
    pub grip_multiplier: f64,
    /// 転がり抵抗係数。
    pub rolling_resistance: f64,
    /// 路面の粗さ [m]。サスペンションの励振に使う（本タスクでは値の保持のみ）。
    pub roughness: f64,
    /// この路面がコース内（track limits 内）とみなされるか。
    pub within_limits: bool,
}

impl SurfaceKind {
    /// 既定の物理特性。将来 TyreSystem / WeatherSystem が上書きする。
    pub fn properties(self) -> SurfaceProperties;
}
```

既定値（この数値をそのまま実装すること）:

| Kind | grip_multiplier | rolling_resistance | roughness | within_limits |
|------|-----------------|--------------------|-----------|---------------|
| Asphalt | 1.00 | 0.012 | 0.002 | true |
| Kerb | 0.90 | 0.020 | 0.030 | true |
| Grass | 0.45 | 0.090 | 0.020 | false |
| Gravel | 0.35 | 0.250 | 0.040 | false |
| PitLane | 0.95 | 0.013 | 0.002 | true |

#### 3. `definition.rs` — トラック定義（入力データ）

```rust
/// 制御点ごとの断面定義。`centerline` と同じ長さでなければならない。
#[derive(Clone, Copy, Debug)]
pub struct CrossSection {
    pub width_left: f64,     // > 0
    pub width_right: f64,    // > 0
    pub banking: f64,        // [rad]
    pub camber: f64,         // [rad]
    /// 左端の外側に続く縁石の幅 [m]。0 なら縁石なし。
    pub kerb_left: f64,
    /// 右端の外側に続く縁石の幅 [m]。0 なら縁石なし。
    pub kerb_right: f64,
    /// 縁石の外側の路面。
    pub runoff: SurfaceKind,
}

impl Default for CrossSection {
    /// width 6.0 / 6.0、バンク・カンバー 0、縁石 1.5 m、runoff = Grass。
    fn default() -> Self;
}

/// トラックの入力定義。TASK-1A-3 でファイルからロードできるようにする。
#[derive(Clone, Debug)]
pub struct TrackDefinition {
    pub name: String,
    /// センターラインの制御点。`y` が標高。
    pub centerline: Vec<Vec3>,
    /// 各制御点の断面。`centerline` と同数。
    pub sections: Vec<CrossSection>,
    /// 常に `true`（サーキット）。`false` はヒルクライム等の将来拡張用。
    pub closed: bool,
    /// セクター境界。全長に対する割合 `(0, 1)` の昇順。
    /// 要素数 2 で 3 セクター（モータースポーツの標準）。
    pub sector_splits: Vec<f64>,
    /// スタート/フィニッシュラインの位置。全長に対する割合 `[0, 1)`。
    /// 既定は 0.0（= 制御点 0）。
    pub start_finish: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum TrackError {
    Spline(sim_math::SplineError),
    /// `sections` の要素数が `centerline` と一致しない。
    SectionCountMismatch { centerline: usize, sections: usize },
    /// コース幅が 0 以下。
    NonPositiveWidth { index: usize },
    /// セクター境界が昇順でない、または範囲外。
    InvalidSectorSplits,
    /// `start_finish` が `[0, 1)` の範囲外。
    InvalidStartFinish,
}
```
`TrackError` は `Display` と `std::error::Error` を実装すること。

#### 4. `track.rs` — 本体

```rust
pub struct Track { /* 非公開 */ }

impl Track {
    /// フレームテーブルのサンプル間隔 [m]。
    pub const FRAME_SPACING_M: f64 = 0.5;

    /// 定義から構築する。フレームテーブルを事前計算する。
    pub fn build(def: &TrackDefinition) -> Result<Track, TrackError>;

    pub fn name(&self) -> &str;
    /// 全長 [m]。
    pub fn length(&self) -> f64;
    pub fn is_closed(&self) -> bool;

    /// `s` における幾何フレーム。事前計算テーブルの線形補間で O(1)。
    pub fn frame_at(&self, s: f64) -> TrackFrame;

    /// トラック座標 -> ワールド座標。
    /// `position(s) + lateral(s) * t`（バンクにより t に応じて標高も変わる）。
    pub fn track_to_world(&self, c: TrackCoord) -> Vec3;

    /// ワールド座標 -> トラック座標。
    /// `hint` に前 tick の `s` を渡すこと（毎 tick 全車で呼ばれる）。
    pub fn world_to_track(&self, p: Vec3, hint: Option<f64>) -> TrackCoord;

    /// `s` を `[0, length)` へ正規化する。ラップ処理は必ずこれを通す。
    pub fn wrap_s(&self, s: f64) -> f64;
    /// 符号付き最短距離 `(-L/2, L/2]`。車間・前後判定は必ずこれを使う。
    pub fn signed_delta_s(&self, from_s: f64, to_s: f64) -> f64;

    /// 与えられたトラック座標の路面種別。
    pub fn surface_at(&self, c: TrackCoord) -> SurfaceKind;
    /// track limits 内か（縁石は内側とみなす）。
    pub fn is_within_limits(&self, c: TrackCoord) -> bool;

    /// `s` が属するセクター番号（0 始まり）。
    pub fn sector_of(&self, s: f64) -> usize;
    /// セクター境界の `s` 値（昇順、要素数 = セクター数 - 1）。
    pub fn sector_boundaries(&self) -> &[f64];
    /// スタート/フィニッシュラインの `s`。
    pub fn start_finish_s(&self) -> f64;
}
```

**`surface_at` の判定順序**（この順序で実装すること）:
```
let f = frame_at(c.s);
if c.t >= 0.0 {                                  // 左側
    if c.t <= f.width_left            -> Asphalt
    else if c.t <= f.width_left + kerb_left -> Kerb
    else                              -> runoff
} else {                                         // 右側
    同様に width_right / kerb_right を使う
}
```
`kerb_left` / `kerb_right` / `runoff` も `s` に沿って補間・保持すること
（`TrackFrame` には含めず、`Track` 内部のテーブルに持つ）。
数値である `kerb_left` / `kerb_right` は線形補間する。
`runoff` は列挙型で線形補間できないため、**最近傍の制御点の値を採る**
（区間内で `f < 0.5` なら手前、そうでなければ次の制御点）。

**`frame_at` の実装要件**
- 構築時に `FRAME_SPACING_M` 間隔で `ceil(length / 0.5) + 1` 個のフレームを事前計算する
- 参照時は隣接 2 フレームの線形補間
- 閉曲線では末尾フレームと先頭フレームの間も正しく補間すること
- **補間後に正規直交化（Gram-Schmidt）すること。個別に正規化するだけでは不十分。**
  `tangent` / `lateral` / `normal` を各々 lerp して各々 normalize すると、
  隣接フレーム間の変換が単一の平面回転でない場合（バンク角が `s` に沿って変化する、
  標高変化により曲線がねじれる）に **直交性が崩れる**。
  `TrackFrame` は正規直交基底であることを downstream（`sim-vehicle` の
  サスペンション・スリップ角・力の分解、`sim-line` の corridor 計算）が前提とするため、
  これは許容できない。手順:
  ```
  tangent = lerp(T_i, T_j, f).normalize()
  lateral = lerp(L_i, L_j, f)
  lateral = (lateral - tangent * lateral.dot(tangent)).normalize()   // Gram-Schmidt
  normal  = tangent.cross(lateral)                                   // 直交性は構成上保証される
  ```

**断面パラメータ（幅・バンク・カンバー・縁石）の `s` への写像**
- 制御点 `i` の `s` は `ArcLengthSpline::control_point_s(i)` で得る（TASK-1A-1 で追加済み）
- 制御点間は線形補間する
- 閉曲線では最後の制御点から制御点 0 へラップして補間する

#### 5. `lap.rs` — ラップ跨ぎ検出（純粋関数）

ラップ *カウント* の意味付けは `sim-race` の責務である。
ここでは幾何的な **跨ぎ検出プリミティブ** のみを提供する。

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LapCrossing {
    /// 跨いでいない。
    None,
    /// 正方向にスタート/フィニッシュラインを跨いだ。
    Forward,
    /// 逆走で跨いだ。
    Backward,
    /// 1 tick の移動量が `max_ds` を超えた。テレポート / リセットの疑い。
    /// **この場合ラップを加算してはならない。**
    Suspect,
}

/// `prev_s` から `new_s` への移動でスタート/フィニッシュラインを跨いだか判定する。
///
/// `max_ds` は 1 tick で移動しうる最大距離 [m]（例: 60 Hz で 110 m/s なら 1.83 m。
/// 余裕を見て 5.0 m 程度を渡す）。これを超える移動は `Suspect` とし、
/// ラップカウントの暴走を構造的に防ぐ。
pub fn detect_lap_crossing(
    track: &Track,
    prev_s: f64,
    new_s: f64,
    max_ds: f64,
) -> LapCrossing;
```

判定は `track.signed_delta_s(prev_s, new_s)` を用いること。
`prev_s` と `new_s` のそれぞれについて `start_finish_s` からの相対位置を見て、
相対位置が減少から増加へ変わった（= ラインを越えた）ことを検出する。

#### 6. `lib.rs`
各モジュールを `pub mod` で公開し、主要型を `pub use` で再エクスポート。
`#![deny(unsafe_code)]` と `#![warn(missing_docs)]` を設定すること。

---

### Required Tests

`crates/sim-track/tests/` に実装する。TESTING.md T-TRK-01〜06 に対応する。

| Test | 対応 | 内容 / Acceptance |
|------|------|------------------|
| `track_coord_roundtrip` | T-TRK-01 | `world_to_track(track_to_world(c)) == c`。コース幅内の `t` を含む格子点で誤差 < 1e-6 m |
| `track_s_is_monotonic_and_continuous` | T-TRK-02 | `s` に沿って `position` が連続。0.5 m 刻みで跳びなし |
| `track_curvature_continuity` | T-TRK-03 | 隣接サンプル間の曲率差が閾値内。符号が旋回方向と一致すること（左カーブで正） |
| `track_width_is_positive` | T-TRK-04 | 全 `s` で `width_left + width_right > 6.0`（車 2 台分） |
| `track_arclength_accuracy` | T-TRK-05 | 円形トラックで全長が `2*PI*R` に対し誤差 < 0.1% |
| `track_lap_crossing` | T-TRK-06 | 正方向・逆方向・非跨ぎ・テレポートの 4 ケース。**誤検出・見逃しゼロ** |
| `track_frame_geometry_conventions` | — | 平坦区間で `normal == +Y`、`lateral` が左向き。バンク時に左端の標高が上がる |
| `track_surface_classification` | — | センター / 縁石 / runoff の境界値で正しく分類。`is_within_limits` が縁石を内側と判定 |
| `track_sectors` | — | `sector_of` が境界値で正しい。セクター数 = `sector_splits.len() + 1` |
| `track_world_to_track_hint_consistency` | — | `hint` の有無で結果が一致する |
| `track_build_rejects_invalid_definitions` | — | `SectionCountMismatch` / `NonPositiveWidth` / `InvalidSectorSplits` / `InvalidStartFinish` が返る |
| `track_banked_corner_elevation` | — | バンク角 0.1 rad の区間で、`t = +5 m` の点が `t = -5 m` の点より高い |

テスト用トラックはテストコード内で構築すること（アセットファイルは TASK-1A-3）。
最低限、(a) 半径 100 m の円、(b) 直線 + 高速コーナー + ヘアピン + 高低差 + バンクを含む
オリジナル形状、の 2 種類を用意すること。

### Acceptance Criteria

1. `cargo build --release` が **警告ゼロ**
2. `cargo test --release` が全通過（`sim-math` の既存 38 テストも退行なし）
3. `cargo clippy --all-targets -- -D warnings` が通る
4. `cargo fmt --check` が通る
5. `unsafe` コードが 0 行
6. 依存は `sim-math` と dev-dependency の `approx` のみ
7. 公開 API が本仕様の **シグネチャと完全一致**
8. すべての公開項目に doc comment
9. **`crates/sim-math/**` の差分が 0**（`git diff --stat` で確認すること）

### Performance Criteria

| 項目 | 基準 |
|------|------|
| `Track::frame_at` | < 100 ns/call |
| `Track::world_to_track`（hint 有） | **< 1 µs/call**（24 台 × 60 Hz で予算比 5% 以内） |
| `Track::build`（全長 5 km） | < 100 ms |
| フレームテーブルのメモリ | 全長 5 km で < 2 MB |

計測は `#[test]` 内の時間計測で概算確認する。ベンチマークハーネスは作らない。

### Out of Scope

- ファイルからのトラックロード（TASK-1A-3）
- Racing Line / Corridor / SpeedProfile（`sim-line`、Phase 2）
- 車両・物理・AI
- トラックメッシュ生成（UE5 側、Phase 0.5 以降）
- ピットレーン（`TrackDefinition` に構造だけ予約し、実装しない）
- 路面のラバーイン / マーブル / 濡れ（Phase 7）

### Known Risks

| Risk | 対策 |
|------|------|
| 曲率の符号規約を取り違える | `track_curvature_continuity` で左カーブ = 正を明示検証 |
| バンク適用時の `lateral` / `normal` の回転方向を誤る | `track_banked_corner_elevation` で左端が上がることを検証 |
| 断面パラメータの `s` 写像が閉曲線のラップでずれる | 制御点 0 付近を跨ぐ補間をテストで確認 |
| `frame_at` の線形補間で法線が非単位長になる | 補間後に再正規化。テストで単位長を確認 |
| ラップ検出がテレポートで暴走する | `Suspect` を返す設計。`track_lap_crossing` で検証 |

### 完了時の報告フォーマット

```
TASK-1A-2 COMPLETE

Implemented Files:
Test Results:          (cargo test の実出力を貼ること)
Clippy / fmt Results:
sim-math diff:         (git diff --stat crates/sim-math を貼ること。0 でなければ理由)
Deviations from Spec:  (なければ "None")
Design Concerns Found: (PROPOSED DESIGN CHANGE 形式。なければ "None")
Performance Notes:     (実測値を記載)
```

**実装完了後、Opus 5 のレビューを受けること。APPROVED まで次タスクへ進まない。**
