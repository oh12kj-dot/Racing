# TODO.md — 現在実行するタスク

Last updated: 2026-09-06
Current Phase: **Phase 0 → Phase 1A**

---

## 🚧 BLOCKER — 人間の承認待ち

| # | 決定事項 | ADR | 状態 |
|---|---------|-----|------|
| H-1 | Simulation Core の言語を **Rust** とする | ADR-0001 | ⏳ 承認待ち |
| H-2 | 製品レンダラの選定を Phase 0.5 スパイクまで保留する | ADR-0002 | ⏳ 承認待ち |

**H-1 の承認が下りるまで、Sonnet 5 は実装を開始してはならない。**
H-2 は Phase 1A / 1B をブロックしない（Simulation Core はエンジン非依存のため）。

---

## Phase 0 — 残タスク

- [x] リポジトリ監査
- [x] 環境実測
- [x] Architecture 設計
- [x] PROJECT.md / ARCHITECTURE.md / PLAN.md / TESTING.md / DECISIONS.md / TODO.md
- [ ] H-1 / H-2 の人間承認
- [ ] Rust toolchain セットアップ確認

---

## Phase 1A — Track Foundation（承認後に着手）

### TASK-1A-1 — `sim-math`: 数学基盤と決定的 RNG  ← **NEXT SONNET TASK**

仕様は下記「NEXT SONNET TASK」節を参照。

### TASK-1A-2 — `sim-track`: Track Coordinate System
（TASK-1A-1 完了・Opus レビュー APPROVED 後に発行）

### TASK-1A-3 — テストトラック定義データ
### TASK-1A-4 — `sim-wasm` + `view-engineering` 最小ビューア

---

# NEXT SONNET TASK

## TASK-1A-1 — `sim-math`: 数学基盤と決定的 RNG

---

### IMPORTANT IMPLEMENTATION CONTRACT

あなたは **Implementation Engineer** です。
あなたはこのタスクの **Architect ではありません**。

Opus 5 によって承認された Architecture と Implementation Specification を **正確に** 実装してください。

以下を自己判断で変更してはいけません。

- Architecture
- Module boundaries
- Public interfaces
- Data structures
- Technology stack
- Dependencies
- Physics model
- Racing AI model
- Rendering architecture
- Naming conventions
- Directory structure
- Task scope
- Execution order

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

タスク対象外の Refactoring は禁止です（unrelated cleanup / folder restructuring /
dependency replacement / interface redesign / mass renaming / premature abstractions 等）。

---

### Goal

Simulation Core 全体の土台となる数学ユーティリティと、**決定的な乱数生成器**を実装する。
以降の全 crate がこの上に載るため、**正確性と決定性がこのタスクの唯一の評価軸**である。

### Allowed Files

```
Cargo.toml                          (workspace root, 新規作成)
rust-toolchain.toml                 (新規作成)
.gitignore                          (新規作成)
crates/sim-math/Cargo.toml          (新規作成)
crates/sim-math/src/lib.rs
crates/sim-math/src/vec.rs
crates/sim-math/src/quat.rs
crates/sim-math/src/spline.rs
crates/sim-math/src/rng.rs
crates/sim-math/src/util.rs
crates/sim-math/tests/*.rs
```

### Allowed Modules
`sim-math` のみ。

### Do Not Change / Do Not Create
- 他の `crates/*` を作成しないこと（`sim-track` 等は次タスク）
- `view-engineering/`、`assets/`、`docs/` に触れないこと
- `PROJECT.md` `ARCHITECTURE.md` `PLAN.md` `TODO.md` `DECISIONS.md` `TESTING.md` を編集しないこと
- 外部クレートの追加は下記「Dependencies」に列挙したもの **のみ**。それ以外は BLOCKED として報告すること

### Dependencies（これ以外を追加しない）

```toml
[dev-dependencies]
approx = "0.5"
```

**本体依存はゼロとする。** `glam` / `nalgebra` / `rand` 等は使用しない。
理由: 決定性を外部クレートの実装変更に依存させないため、および FFI/WASM 境界を最小に保つため。
（これは設計判断であり、実装者が覆してはならない）

### Required Changes

#### 1. Workspace セットアップ

- `Cargo.toml` に workspace を定義。members に `crates/sim-math` のみ
- `rust-toolchain.toml` で stable チャンネルを固定
- workspace の `[profile.release]` に以下を設定（**決定性のため必須**）:
  ```toml
  [profile.release]
  opt-level = 3
  lto = "thin"
  codegen-units = 1
  panic = "abort"
  ```
- `.gitignore` に `/target`, `**/*.rs.bk`, `node_modules/` を記載

#### 2. `vec.rs` — ベクトル型

```rust
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec2 { pub x: f64, pub y: f64 }

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 { pub x: f64, pub y: f64, pub z: f64 }
```

**座標系規約（変更禁止）**: 右手系、**Y が上**、進行方向は原則 +X、横方向は +Z。
角度はすべて **ラジアン**。単位はすべて **SI**（m, kg, s, N, rad）。

必要な演算:
- `Add / Sub / Mul<f64> / Div<f64> / Neg` および `AddAssign / SubAssign / MulAssign / DivAssign`
- `dot`, `cross`(Vec3), `perp_dot`(Vec2), `length`, `length_squared`,
  `normalize`（ゼロ長時は `None` を返す `try_normalize` も用意）, `distance`, `distance_squared`
- `lerp`, `project_onto`, `reject_from`, `angle_between`
- `Vec3::{ZERO, X, Y, Z}`, `Vec2::{ZERO, X, Y}` 定数
- `Vec3::xz()` -> `Vec2`（水平面投影。トラック計算で多用する）
- `is_finite()` — NaN / inf 検査用（テストで使う）

#### 3. `quat.rs` — 姿勢

```rust
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat { pub x: f64, pub y: f64, pub z: f64, pub w: f64 }
```

- `IDENTITY`, `from_axis_angle`, `from_euler_yxz(yaw, pitch, roll)`, `to_euler_yxz`
- `mul`(合成), `inverse`, `normalize`, `rotate_vec3`, `slerp`
- `to_mat3` -> `[[f64;3];3]`（レンダラへの受け渡し用）

**注意**: `to_euler_yxz` はジンバルロック付近（pitch = ±π/2）でクランプすること。

#### 4. `spline.rs` — 弧長パラメータ化スプライン

これが本タスクの中核であり、`sim-track` の全機能の基盤になる。

```rust
/// 制御点列から作る C1 連続な 3 次スプライン（Catmull-Rom, centripetal 版）
pub struct CubicSpline {
    // 実装詳細は非公開
}

impl CubicSpline {
    /// 制御点から構築。closed = true でループを閉じる。
    /// 制御点が 4 未満、または重複点があれば Err。
    pub fn new(points: &[Vec3], closed: bool) -> Result<Self, SplineError>;

    /// 正規化パラメータ u in [0,1] で評価
    pub fn eval(&self, u: f64) -> Vec3;
    pub fn tangent(&self, u: f64) -> Vec3;          // 正規化済み
    pub fn second_derivative(&self, u: f64) -> Vec3;
    pub fn curvature(&self, u: f64) -> f64;         // 1/R, 符号なし大きさ

    pub fn is_closed(&self) -> bool;
}

/// 弧長で再パラメータ化したスプライン。s [m] でアクセスできる。
pub struct ArcLengthSpline {
    // 内部に CubicSpline と (s -> u) の単調テーブルを持つ
}

impl ArcLengthSpline {
    /// samples_per_segment: 弧長テーブル作成時の各セグメント分割数（既定 64）
    pub fn new(spline: CubicSpline, samples_per_segment: usize) -> Self;

    pub fn total_length(&self) -> f64;

    /// s [m] を受け取る。closed の場合は s を [0, total_length) に wrap する。
    /// open の場合は端でクランプする。
    pub fn position_at(&self, s: f64) -> Vec3;
    pub fn tangent_at(&self, s: f64) -> Vec3;
    pub fn curvature_at(&self, s: f64) -> f64;

    /// s <-> u 変換
    pub fn u_from_s(&self, s: f64) -> f64;
    pub fn s_from_u(&self, u: f64) -> f64;

    /// 与えられた点に最も近い s を求める。
    /// hint があればその近傍から探索する（毎 tick 呼ばれるので O(1) 相当にする）。
    pub fn closest_s(&self, p: Vec3, hint: Option<f64>) -> f64;

    /// s を [0, total_length) に正規化（closed 時）
    pub fn wrap_s(&self, s: f64) -> f64;

    /// a から b への符号付き最短距離。closed 時にラップを考慮する。
    /// 戻り値は (-total_length/2, total_length/2]
    pub fn signed_delta_s(&self, from_s: f64, to_s: f64) -> f64;
}
```

**実装要件**
- 弧長テーブルは Gauss-Legendre 求積 または 十分細かい分割で構築し、単調性を保証すること
- `u_from_s` はテーブルの二分探索 + 線形補間
- `closest_s`: `hint` がある場合はその周辺 ±(セグメント長 * 2) だけを探索し、
  ニュートン法で精緻化する。`hint` が `None` の場合は全テーブル走査 + 精緻化
- `signed_delta_s` は **ラップ処理の唯一の正しい実装**とし、他所で自前計算しないための API である

#### 5. `rng.rs` — 決定的乱数

```rust
/// SplitMix64 でシードを派生し、xoshiro256** で生成する決定的 RNG。
/// グローバル状態・時刻依存を一切持たない。
#[derive(Clone, Debug)]
pub struct Rng { /* 4 x u64 state */ }

impl Rng {
    pub fn from_seed(seed: u64) -> Self;

    /// 親シードとラベルから子 RNG を決定的に派生する。
    /// 例: race_rng.derive("driver:07:perception")
    /// 同じ (親状態, ラベル) からは常に同じ子が得られる。
    pub fn derive(&self, label: &str) -> Rng;

    pub fn next_u64(&mut self) -> u64;
    pub fn next_f64(&mut self) -> f64;              // [0, 1)
    pub fn range_f64(&mut self, lo: f64, hi: f64) -> f64;
    pub fn range_i64(&mut self, lo: i64, hi: i64) -> i64;   // [lo, hi)
    pub fn bool_with_probability(&mut self, p: f64) -> bool;

    /// Box-Muller。正規分布はドライバーの誤差モデルで多用する。
    pub fn normal(&mut self, mean: f64, std_dev: f64) -> f64;
    /// mean ± n*std_dev でクランプした正規分布
    pub fn normal_clamped(&mut self, mean: f64, std_dev: f64, n_sigma: f64) -> f64;

    /// 状態のハッシュ。決定性テストで使う。
    pub fn state_hash(&self) -> u64;
}
```

**要件**
- `derive` は FNV-1a か同等でラベルをハッシュ化し、親状態と混合して SplitMix64 に投入する
- `normal` の Box-Muller はキャッシュを持たせず、毎回 2 つの一様乱数を消費すること
  （キャッシュを持つと呼び出し順で結果が変わり決定性の検証が困難になる。**これは意図的な設計判断**）

#### 6. `util.rs` — 数値ユーティリティ

- `clamp(x, lo, hi)`, `saturate(x)`, `lerp(a, b, t)`, `inverse_lerp`, `remap`
- `smoothstep`, `smootherstep`
- `move_towards(current, target, max_delta)` — **レート制限。ステアリング制御で必須**
- `approach_exponential(current, target, time_constant, dt)` — **一次遅れ。同上**
- `wrap_angle(a)` -> (-π, π]
- `signed_angle_delta(from, to)`
- `EPSILON: f64 = 1e-9`

#### 7. `lib.rs`
上記モジュールを `pub mod` で公開し、主要型を `pub use` で再エクスポートする。
crate レベルで `#![deny(unsafe_code)]` を設定すること。

### Required Tests

`crates/sim-math/tests/` に以下を実装する。**すべて通過すること。**

| Test | 内容 |
|------|------|
| `vec_ops` | 各演算の既知値検証。`normalize` のゼロ長時挙動 |
| `quat_roundtrip` | `to_euler_yxz(from_euler_yxz(e)) == e`（ジンバルロック外で誤差 < 1e-9） |
| `quat_rotate` | 既知の回転で `rotate_vec3` を検証。`to_mat3` との一致 |
| `spline_c1_continuity` | セグメント境界で接線が連続（差分 < 1e-6） |
| `spline_arclength_accuracy` | 半径 R の円を制御点で近似し、`total_length` が 2πR に対し誤差 < 0.1% |
| `spline_curvature_circle` | 同じ円で `curvature_at` が 1/R に対し誤差 < 1% |
| `spline_s_u_roundtrip` | `s_from_u(u_from_s(s)) == s`（誤差 < 1e-6） |
| `spline_closest_s` | 既知点で `closest_s` を検証。hint 有無で同じ結果になること |
| `spline_closest_s_hint_perf` | hint 付き 100k 回呼び出しが hint なしより有意に速い |
| `spline_wrap_and_delta` | `signed_delta_s` がラップ境界（s=0 付近と s=length 付近）で正しい符号・値を返す |
| `rng_determinism` | 同一 seed から 10000 個生成し、2 回の結果が完全一致 |
| `rng_derive_stability` | 同じラベルからの `derive` が常に同じ列を返す。異なるラベルは異なる列 |
| `rng_distribution` | `next_f64` が [0,1) に収まる。`normal` の平均・標準偏差が 100k サンプルで期待値に収束（許容 2%） |
| `rng_no_global_state` | 2 つの独立 `Rng` インスタンスが互いに干渉しない |
| `util_move_towards` | レート制限が max_delta を超えない。目標に到達したら止まる |
| `util_wrap_angle` | 境界値（±π, ±3π）で正しい |

### Acceptance Criteria

1. `cargo build --release` が **警告ゼロ**で成功する
2. `cargo test --release` が全通過する
3. `cargo clippy -- -D warnings` が通る
4. `unsafe` コードが 1 行も存在しない
5. 本体依存クレートがゼロである
6. 公開 API が本仕様の **シグネチャと完全一致**する（名前・引数・戻り値型）
7. すべての公開項目に doc comment がある
8. `spline_arclength_accuracy` の誤差が 0.1% 未満
9. `rng_determinism` がビット一致で通過する

### Performance Criteria

- `ArcLengthSpline::closest_s` with hint: **< 200 ns / call**（24 台 × 60 Hz でも無視できる）
- `Rng::next_f64`: < 5 ns / call

`crates/sim-math/benches/` は **このタスクでは作らない**（criterion 依存を増やさないため）。
性能は `#[test]` 内の時間計測で概算確認するに留める。

### Out of Scope

- Track / Vehicle / AI に関する一切のコード
- 行列型（`Mat4` 等）— レンダラ側の責務。`to_mat3` のみ用意する
- 衝突判定・空間分割 — `sim-track` / `sim-core` の責務
- FFI / WASM バインディング — 別タスク
- ベンチマークハーネス

### Known Risks

| Risk | 対策 |
|------|------|
| Catmull-Rom の centripetal 版の実装ミスでカスプが出る | `spline_c1_continuity` テストで検出 |
| 弧長テーブルの単調性が崩れ `u_from_s` が壊れる | 構築時に単調性を assert する |
| `closest_s` の hint 探索が局所解に落ちる | 探索範囲をセグメント長の 2 倍確保。テストで hint 有無の一致を検証 |
| Box-Muller のキャッシュ実装による決定性喪失 | 仕様でキャッシュ禁止を明記済み |

### 完了時の報告フォーマット

```
TASK-1A-1 COMPLETE

Implemented Files:
Test Results:        (cargo test の実出力を貼ること)
Clippy Results:
Deviations from Spec: (なければ "None")
Design Concerns Found: (PROPOSED DESIGN CHANGE 形式。なければ "None")
Performance Notes:
```

**実装完了後、Opus 5 のレビューを受けること。APPROVED まで次タスクへ進まない。**
