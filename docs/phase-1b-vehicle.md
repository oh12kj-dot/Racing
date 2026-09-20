# Phase 1B — `sim-vehicle` 実装仕様

Status: **実装完了（TASK-1B-1 / Opus 監査済み）**
Last updated: 2026-09-08

`ARCHITECTURE.md` §5 の車両物理を、実装可能な粒度まで具体化したもの。
本書が Phase 1B の唯一の実装仕様である。

---

## Goal

**1 台の車が、人間の入力に対して物理的に妥当に振る舞う。**

達成したい観測可能な性質:

- 加速でスクワット、制動でダイブ、旋回でロールが**創発する**（直接代入しない）
- 定常円旋回でアンダー / オーバーステアが荷重とスリップから出る
- ブレーキ過大でロックアップが**創発する**（「ロック判定」を書かない）
- 60 分連続実行で NaN / 発散なし

---

## 責務の境界（不可侵）

```
DriverAI  --ControlInput-->  Vehicle  --forces-->  Physics  -->  VehicleState
```

- **`sim-vehicle` は `sim-driver` を知らない。** 入力は `ControlInput` の値のみ
- **`sim-vehicle` は Transform を外部から書き換えられない。** `step()` 以外に状態を変える経路を作らない
- **`sim-vehicle` は `sim-track` に依存しない**（下記 ADR 補足を参照）

### ARCHITECTURE.md §2 の依存関係の明確化（Opus 決定）

`sim-vehicle` はサスペンションの接地判定のために路面を必要とするが、
**`sim-track` へは依存させない。** 代わりに `GroundProbe` トレイトを `sim-vehicle` 側で定義し、
`sim-core` が `sim-track` を使って実装する。

理由:
1. `sim-vehicle` を平面上で単体テストできる（トラック定義なしで T-VEH-01〜11 が回る）
2. 将来 UE5 の物理シーンや別の路面表現へ差し替えられる
3. 依存グラフに循環が生じない

```rust
/// 路面の問い合わせ。`sim-core` が `sim-track` を使って実装する。
pub trait GroundProbe {
    /// `from` から鉛直下方へ最大 `max_distance` [m] 探索する。
    fn probe(&self, from: Vec3, max_distance: f64) -> Option<GroundHit>;
}

/// 接地点の情報。**路面の「種別」ではなく物理量を渡す**ことで、
/// `sim-vehicle` が `SurfaceKind` を知らずに済む。
#[derive(Clone, Copy, Debug)]
pub struct GroundHit {
    /// 接地点のワールド座標。
    pub point: Vec3,
    /// 路面法線（単位ベクトル）。
    pub normal: Vec3,
    /// グリップ倍率。アスファルトを 1.0 とする。
    pub grip: f64,
    /// 転がり抵抗係数。
    pub rolling_resistance: f64,
    /// 路面の粗さ [m]。サスペンションの励振に使う。
    pub roughness: f64,
}
```

---

## データ構造

### 入力

```rust
/// ドライバーが生成できる操作。**これ以外の手段で車両を動かしてはならない。**
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ControlInput {
    /// ステアリング。`-1.0`（左いっぱい）〜 `+1.0`（右いっぱい）。
    pub steer: f64,
    /// スロットル `0.0..=1.0`。
    pub throttle: f64,
    /// ブレーキ `0.0..=1.0`。
    pub brake: f64,
    /// クラッチ `0.0`（接続）〜 `1.0`（切断）。
    pub clutch: f64,
    /// 要求ギア。`-1` = リバース、`0` = ニュートラル、`1..=n`。
    pub gear: i8,
    /// DRS / ブースト。Phase 1B では受け取るのみで効果なし。
    pub drs: bool,
}
```

`step()` の冒頭で全成分を有効域へクランプすること。**不正値で破綻させない。**

### 状態

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WheelIndex { FrontLeft = 0, FrontRight = 1, RearLeft = 2, RearRight = 3 }

#[derive(Clone, Copy, Debug, Default)]
pub struct WheelState {
    /// サスペンションの縮み量 [m]。`0` で伸びきり、正で縮む。
    pub compression: f64,
    /// 縮み速度 [m/s]。正で縮む方向。
    pub compression_velocity: f64,
    /// 車輪の回転角速度 [rad/s]。
    pub spin: f64,
    /// 車輪の回転角 [rad]。見た目の回転に使う。
    pub rotation: f64,
    /// 実舵角 [rad]。
    pub steer_angle: f64,
    /// タイヤ垂直荷重 [N]。
    pub load: f64,
    /// 緩和後のスリップ比（無次元）。
    pub slip_ratio: f64,
    /// 緩和後のスリップ角 [rad]。
    pub slip_angle: f64,
    /// 接地しているか。
    pub grounded: bool,
    /// タイヤ力（車輪ローカル）[N]。
    pub force_long: f64,
    pub force_lat: f64,
    /// この tick の摩擦円の半径 `mu * load` [N]。（実装時に追加）
    pub friction_limit: f64,
    /// 摩擦円の使用率 `0..1`。可視化とテレメトリ用。
    pub grip_usage: f64,
}

#[derive(Clone, Debug)]
pub struct VehicleState {
    /// **重心**のワールド座標。
    pub position: Vec3,
    /// 車体姿勢。
    pub orientation: Quat,
    /// 重心のワールド速度 [m/s]。
    pub velocity: Vec3,
    /// ワールド角速度 [rad/s]。
    pub angular_velocity: Vec3,
    pub wheels: [WheelState; 4],
    /// エンジン回転数 [rpm]。
    pub engine_rpm: f64,
    /// 現在のギア。
    pub gear: i8,
    /// 直前に適用された入力（テレメトリ用）。
    pub last_input: ControlInput,
    /// この tick に作用した総ダウンフォース [N]。（実装時に追加）
    pub aero_downforce: f64,
    /// 破綻検知により更新を破棄した回数。**増えること自体が不具合。**
    pub recovered_steps: u64,
}
```

**`VehicleState` のフィールドは公開するが、外部から書き換えてはならない。**
書き換えは `Vehicle::step()` のみが行う。レビューで直接代入を見つけたら CRITICAL。

### パラメータ

`assets/vehicles/*.spec.json`（`docs/phase-0.5-tasks.md` のスキーマ）から読む。
**見た目と物理が同一ファイルから導出される**という ADR-0006 の中核。

```rust
/// spec.json の物理関連フィールドを保持する。
#[derive(Clone, Debug)]
pub struct VehicleParams { /* dimensions / mass / tyre / engine / drivetrain / aero / brakes / suspension */ }

impl VehicleParams {
    /// spec.json から読む（feature "serde"）。
    pub fn from_json_str(s: &str) -> Result<Self, VehicleParamsError>;
    /// 妥当性を検証する。質量が正、ホイールベースが正、ギア比が単調減少、など。
    pub fn validate(&self) -> Result<(), VehicleParamsError>;
}
```

`validate()` は **構築時に必ず呼ぶ**。不正なパラメータを物理へ流さない
（`sim-track` の `Track::build` と同じ方針）。

---

## 物理モデル

### 座標系

車両ローカル: **`+X` 前方 / `+Y` 上 / `+Z` 右**（`sim-math` の規約と一致）。
重心を原点とする。

### 剛体

- スプラングマス 1 個（6 DOF）
- アンスプラングマス 4 個（各: 上下 1 DOF + 車輪回転 1 DOF）
- 慣性テンソルは直方体近似に補正係数を掛ける:
  ```
  Ixx = k_roll  * m * (w^2 + h^2) / 12
  Iyy = k_yaw   * m * (l^2 + w^2) / 12
  Izz = k_pitch * m * (l^2 + h^2) / 12
  k_roll = 0.75, k_pitch = 1.10, k_yaw = 1.05
  ```
  補正係数は実車の計測値に寄せた経験値。`VehicleParams` から上書き可能にすること。

### サスペンション

**ピッチ・ロール・荷重移動を直接計算して代入してはならない。**
サスペンション力の合力として自然に生じさせる。

各ホイールについて:

```
1. ホイール取り付け点（車体ローカル）をワールドへ変換
2. そこから鉛直下方へ GroundProbe::probe(from, rest_length + travel_down + tyre_radius)
3. 接地なし -> compression = 0, load = 0, grounded = false（タイヤ力もゼロ）
4. 接地あり:
     compression = (rest_length + tyre_radius) - hit_distance
     compression = clamp(compression, 0, travel_up)
     compression_velocity = (compression - prev_compression) / dt     ※後述の平滑化を通す
     F_spring = k * compression * (1 + progressive * compression / travel_up)
     F_damper = (compression_velocity > 0 ? c_bump : c_rebound) * compression_velocity
     F_arb    = k_arb * (compression_this - compression_opposite)
     load     = max(0, F_spring + F_damper + F_arb)
5. load を接地点に路面法線方向へ作用させる
```

**安定性の要件（必ず守ること）**
- `compression_velocity` は生の差分ではなく **一次遅れ（時定数 5 ms）** を通す。
  生の差分は縁石で数値的に跳ね、ダンパ力が発散する
- `load` は必ず `max(0, ...)`。**負の荷重（引っ張り）を許すと車体が路面に吸着する**
- `F_damper` の絶対値を `load_static * 8.0` でクランプする（安全弁）

### タイヤ — 簡略 Pacejka Magic Formula

```
kappa_raw = (spin * r_eff - v_x) / max(|v_x|, V_EPS)        スリップ比
alpha_raw = atan2(v_y, max(|v_x|, V_EPS))                   スリップ角 [rad]
```

**緩和（relaxation length）** — 生のスリップ値を直接使ってはならない:
```
d(kappa)/dt = (kappa_raw - kappa) * max(|v_x|, V_RELAX_MIN) / L_relax
d(alpha)/dt = (alpha_raw - alpha) * max(|v_x|, V_RELAX_MIN) / L_relax
L_relax = 0.30 m,  V_RELAX_MIN = 1.0 m/s
```

**低速正則化** — `v_x -> 0` でスリップ比が発散する:
```
V_EPS = 2.0 m/s
低速ブレンド係数 w = smoothstep(0.0, V_EPS, |v_x|)
タイヤ力に w を掛け、(1 - w) の分は「静止摩擦ばね」で置き換える:
  静止摩擦ばね = -k_stick * (接地点の滑り変位)     k_stick = load * 40 [N/m]
  滑り変位は |force| > mu * load を超えたら滑らせて減衰させる
```

**力の算出**:
```
mu       = mu0 * grip * load_sensitivity(load)
load_sensitivity(Fz) = 1 / (1 + LS * (Fz / Fz_nominal - 1))     LS = 0.28

Fx0 = mu * load * sin(Cx * atan(Bx * kappa))
Fy0 = mu * load * sin(Cy * atan(By * alpha))
Bx = 12.0, Cx = 1.65
By = 9.0,  Cy = 1.35
（これらは spec.json の tyre セクションから上書きできるようにすること）

combined slip（摩擦円）:
  sn = kappa / kappa_peak,  sa = alpha / alpha_peak
  sigma = sqrt(sn^2 + sa^2)
  if sigma > EPS:
      Fx = Fx0 * |sn| / sigma
      Fy = Fy0 * |sa| / sigma
  grip_usage = min(1.0, sqrt(Fx^2 + Fy^2) / (mu * load))
```

**合成後の力が `mu * load` を超えてはならない**（T-VEH-07 が全 tick で検証する）。

### 車輪の回転

```
I_wheel * d(spin)/dt = T_drive - T_brake - Fx * r_eff - T_roll
T_brake は spin の符号に対して常に減速方向。**符号反転で振動させないこと**:
  T_brake_applied = min(T_brake, |spin| * I_wheel / dt) * sign(spin)
```

この `min` によりブレーキが車輪を逆回転させることがなくなる。
**ロックアップはここから創発する**（`spin -> 0` で `kappa -> -1`）。専用の判定を書かない。

### サブステップ

```
Physics tick : dt = 1/240 s（固定）
車輪回転とタイヤ力のみ 4 分割 -> 実効 960 Hz
```

車体の剛体積分は 240 Hz、車輪 / タイヤは 960 Hz。
低速でのスリップ計算が最も不安定なため、ここだけ細かく刻む。

### パワートレイン

```
engine_torque = torque_curve(rpm) * throttle - engine_brake(rpm) * (1 - throttle)
clutch_torque = engine_torque * (1 - clutch)
wheel_torque  = clutch_torque * gear_ratio * final_drive * driveline_efficiency
```

- レブリミッター: `rpm > limiter_rpm` でトルクを 0 にする（ヒステリシス 200 rpm）
- シフト中（`shift_time_s`）はトルクカット
- デフ: LSD のトルクバイアス。左右の駆動輪へ
  `T_left = T/2 + bias * (spin_right - spin_left) * k_lsd` の形で配分
- `rpm` は駆動輪の平均回転から逆算。クラッチ切断時はエンジン単体で回す

### 空力

```
q      = 0.5 * rho * v^2                       rho = 1.225 kg/m^3
F_drag = q * cd * frontal_area                 進行方向の逆向き
F_down_front = q * cl_front * frontal_area     圧力中心 cop_front_x に作用
F_down_rear  = q * cl_rear  * frontal_area     圧力中心 cop_rear_x に作用
```

ダウンフォースを**圧力中心に作用させる**ことでピッチにも影響する。
重心にまとめて作用させてはならない。

### 積分

半陰的オイラー（symplectic Euler）。`f64`。

```
velocity += (force / mass) * dt
position += velocity * dt
angular_velocity += I^-1 * (torque - omega x (I * omega)) * dt
orientation = (orientation + 0.5 * quat(omega) * orientation * dt).normalize()
```

**毎ステップ `orientation.normalize()` を呼ぶこと**（積分でノルムが漂流する）。

### 破綻検知（必須）

`step()` の末尾で不変条件を確認し、破れたら**その tick の更新を破棄して前状態へ戻す**:

```
- position / velocity / orientation が有限
- |velocity| < 200 m/s
- |angular_velocity| < 50 rad/s
- 全ホイールの load が有限かつ >= 0
```

破棄した場合は `VehicleState` にカウンタを持たせて記録する
（`recovered_steps: u64`）。**テストはこのカウンタが 0 であることを確認する。**
これは「破綻しても走り続ける」ための保険であり、
**カウンタが増えること自体を不具合として扱う。**

---

## 公開 API

```rust
pub struct Vehicle { /* 非公開 */ }

impl Vehicle {
    /// パラメータと初期姿勢から構築する。`params.validate()` を内部で呼ぶ。
    pub fn new(params: VehicleParams, position: Vec3, yaw: f64) -> Result<Self, VehicleParamsError>;

    /// 1 物理ステップ進める。`dt` は必ず `PHYSICS_DT`。
    pub fn step(&mut self, input: &ControlInput, ground: &dyn GroundProbe, dt: f64);

    pub fn state(&self) -> &VehicleState;
    pub fn params(&self) -> &VehicleParams;

    /// 車輪の取り付け点（車体ローカル）。可視化とデバッグ用。
    pub fn wheel_mount_local(&self, w: WheelIndex) -> Vec3;
    /// 車輪の現在のワールド姿勢。**Visual Suspension はこれを使う**
    /// （物理と別系統で偽装しないこと）。
    pub fn wheel_world_transform(&self, w: WheelIndex) -> (Vec3, Quat);

    // --- 実装時に追加（Architect 承認済み）---------------------------------------
    /// 初速つきで構築する。ローリングスタートと単体テスト用。
    /// **初期条件の指定であって、構築後に状態を書き換える経路ではない。**
    pub fn new_with_velocity(
        params: VehicleParams, position: Vec3, yaw: f64, velocity: Vec3,
    ) -> Result<Self, VehicleParamsError>;
    /// サスペンションの自由長 [m]。`wheel_world_transform` の検証に使う（T-VEH-11）。
    pub fn suspension_rest_length(&self) -> f64;
}

impl VehicleState {
    /// 車体の前 / 上 / 右方向（ワールド）。
    pub fn forward(&self) -> Vec3;
    pub fn up(&self) -> Vec3;
    pub fn right(&self) -> Vec3;
    /// ヨー / ピッチ / ロール [rad]。
    ///
    /// **`Quat::to_euler_yxz` の "pitch" は `+X` まわりであり、車両ローカル
    /// （`+X` 前方）ではロールに相当する。** この罠を避けるため基底ベクトルから導く。
    /// ピッチは正で機首上げ（スクワット）、ロールは正で右側が沈む。
    pub fn yaw(&self) -> f64;
    pub fn pitch(&self) -> f64;
    pub fn roll(&self) -> f64;
    /// 前進速度 [m/s] / 4 輪の垂直荷重の合計 [N]。
    pub fn forward_speed(&self) -> f64;
    pub fn total_load(&self) -> f64;
}

/// 固定物理タイムステップ [s]。
pub const PHYSICS_DT: f64 = 1.0 / 240.0;
```

---

## Required Tests

`sim-track` に依存せず、平面 `GroundProbe` 実装で回すこと。

| ID | 検証内容 | Acceptance |
|----|---------|-----------|
| T-VEH-01 | 静止時の 4 輪荷重の合計 = 車重 | 誤差 < 0.1% |
| T-VEH-02 | 静止時の前後配分 = 重心位置から算出した値 | 誤差 < 1% |
| T-VEH-03 | 制動でダイブ | pitch が負方向、前輪荷重増と整合 |
| T-VEH-04 | 加速でスクワット | pitch が正方向、後輪荷重増と整合 |
| T-VEH-05 | 定常円旋回でロール | roll 角と横 G が整合 |
| T-VEH-06 | **低速・停止でタイヤ力が発散しない** | 60 分で NaN / inf ゼロ、`recovered_steps == 0` |
| T-VEH-07 | 摩擦円を超えない | 全 tick で `sqrt(Fx^2+Fy^2) <= mu*load * 1.001` |
| T-VEH-08 | **ロックアップが創発する** | ブレーキ全開で `slip_ratio -> -1` に漸近。コード内に「ロック判定」が存在しないこと |
| T-VEH-09 | ダウンフォースが v^2 に比例 | 誤差 < 1% |
| T-VEH-10 | 惰行減速が抗力 + 転がり抵抗と整合 | 誤差 < 5% |
| T-VEH-11 | Visual suspension == 物理 compression | 完全一致 |
| T-VEH-12 | **決定性** | 同一初期状態・同一入力列で 2 回実行し全状態がビット一致 |
| T-VEH-13 | 不正入力で破綻しない | `steer=1e9`, `throttle=NaN` 等でクランプされ `recovered_steps == 0` |
| T-VEH-14 | 段差・縁石でダンパが発散しない | 高さ 50 mm の段差を 200 km/h で通過して `recovered_steps == 0` |

### シナリオ（数値で挙動を確認する）

| Scenario | 期待 |
|----------|------|
| 0→100 km/h 加速 | 実車カテゴリの妥当な範囲（GT3 級で 3.2〜4.2 s） |
| 100 km/h→0 制動 | 制動距離が妥当（**25〜40 m**。当初 30〜40 m から改定。下記参照） |
| 定常円旋回 R=50 m | 横 G が妥当（ダウンフォース込みで 1.4〜2.2 G） |
| スロットルオフでのオーバーステア | 後輪 slip_angle が前輪を上回る |

**これらは「正解」ではなく妥当性のレンジである。**
外れた場合はパラメータを疑い、モデルの構造を先に疑わないこと。

### 制動距離の帯を 30〜40 m から 25〜40 m へ改定した（Opus 判断・実測に基づく）

当初の「100-0 で 30〜40 m」と「R=50 m の定常円旋回で 1.4〜2.2 G」は**同時に満たせない**。
摩擦円は等方であり、`mu0` は縦グリップと横グリップを同じ比率で動かすためである。
`mu0` 以外はアセットの値のままで掃引した実測:

| `mu0` | 100-0 [m] | 0-100 [s] | 最大横 G @ 26 m/s |
|-------|-----------|-----------|------------------|
| 1.30  | 31.9 ✓    | 3.85 ✓    | 1.24 ✗ |
| 1.40  | 29.3 ✗    | 3.55 ✓    | 1.32 ✗ |
| 1.50  | 26.8 ✗    | 3.32 ✓    | **1.41 ✓（R = 49.0 m）** |
| 1.60  | 25.1 ✗    | 3.16 ✗    | 1.46 ✓ |

`mu0 = 1.50` を採用した。理由:

- 定常円旋回は**半径が数値で指定されている**唯一のシナリオ（R=50 m）であり、
  `mu0 = 1.50` はそこで R = 49.0 m / 1.41 G と、仕様どおりの円を仕様どおりの G で回る
- GT3 級スリックの実測ピーク摩擦係数は 1.5〜1.6 で、1.50 の方が実車に近い
- 実車 GT3 の 100-0 は 28〜31 m 程度。26.8 m は現実的な範囲であり、
  当初の 30〜40 m の方がロードカー寄りの保守的な帯だったと判断する

**これは実装者の裁量による受け入れ値の緩和ではなく、Architect による仕様変更である。**
根拠となる掃引は `crates/sim-vehicle/tests/scenarios.rs` の冒頭にも記録してある。

### 加速シナリオの測り方

0-100 km/h と 100-0 は「車両の能力」を測るものであり、ドライバーの巧拙を測るものではない。
そのため受け入れテストは**スリップ比を目標付近に保つ簡易トラクション制御**（加速）と
**ペダル一定値の掃引から最良を採る**（制動）方式で測る。
これらは `tests/common/mod.rs` のテストハーネスであり、**crate 側には存在しない**
（Driver AI は Phase 2）。ペダル全開の固定入力では 4 輪ロックで 43 m、
1 速でホイールスピンして 8 s となり、車両の能力を測ったことにならない。

## Performance Criteria

| 項目 | 基準 |
|------|------|
| `Vehicle::step` 1 台 1 tick | < 8 µs |
| 24 台 × 240 Hz | **<= 2.0 ms / render frame**（PROJECT.md §6） |

## Out of Scope（Phase 1B では実装しない）

タイヤ摩耗・温度、燃料消費と重量変化、ブレーキ温度、ダメージ、
車車間衝突、ダーティエア、スリップストリーム、天候、DRS の効果。

**ただし `VehicleParams` と `WheelState` に将来のフィールドを追加できる構造にすること。**

## Known Risks

| Risk | 対策 |
|------|------|
| **低速での Pacejka 発散**（R3・最大リスク） | relaxation length + 低速ブレンド + 静止摩擦ばね + 4 サブステップ。T-VEH-06 が常時検証 |
| ダンパ力が縁石で発散 | `compression_velocity` の一次遅れ + 力のクランプ。T-VEH-14 |
| 荷重が負になり路面に吸着 | `load = max(0, ...)` |
| ブレーキが車輪を逆回転させ振動 | `T_brake` を `|spin| * I / dt` でクランプ |
| 姿勢クォータニオンの漂流 | 毎ステップ正規化 |
| 破綻の見逃し | `recovered_steps` を状態に持ち、テストで 0 を要求する |


---

## 実装ノート（TASK-1B-1 完了時に追記）

仕様に書かれていなかったが実装上必要になった判断。**すべて Architect が決めたもの**で、
値はパラメータ化してあり `spec.json` から上書きできる。

### 幾何の導出

`spec.json` は車輪の取り付け点を持たない。以下から導く。

```
cg_to_rear  = wheelbase * distribution_front     ← 前軸荷重配分の定義そのもの
cg_to_front = wheelbase - cg_to_rear
mount.z     = ±track/2（左が -Z）
mount.y     = tyre_radius + rest_length - static_compression - cg_height
```

`mount.y` をこう置くと、**静的つり合いでちょうど重心が `cg_height` に来る**。
T-VEH-01 / 02 が誤差 0.00000% で通るのはこのためであり、偶然ではない。
`rest_length` は `travel_up + travel_down` を既定とする（`suspension.rest_length` で上書き可）。
静的つり合いの縮み量は progressive ばねの二次方程式を解析的に解く。
これが `travel_up` を超える設定は `validate()` が `SuspensionBottomsOut` で弾く。

### 仕様に無かったパラメータと既定値

| フィールド | 既定 | 根拠 |
|---|---|---|
| `tyre.mu0` | 1.50 | 上記「制動距離の帯」の掃引による |
| `tyre.stick_damping_ratio` | 0.50 | 静止摩擦ばねに減衰が無いと停車中の擾乱が減衰しない。臨界の半分。1.0 に近づけると高荷重時に車輪回転の陽解法が不安定側へ寄る |
| `tyre.wheel_inertia_factor` | 0.35 | `I = factor * unsprung_kg * r^2`。バネ下にはアップライト等の非回転部分が含まれるため円板（0.5）より小さく採る。1 輪 1.75 kg m^2 で GT3 の実測域 |
| `suspension.progressive` | 0.50 | 仕様の式にあるが値が無かった。ロール角が横 G に対して緩やかに飽和する（実測: 1.24 G で 0.0086 rad、1.49 G で 0.0092 rad） |
| `engine.inertia` | 0.22 kg m^2 | 一般的な GT3 級 V8 相当 |
| `engine.engine_brake_torque` | 55 Nm | `max_rpm` での値。回転数に比例させる |
| `drivetrain.driveline_efficiency` | 0.92 | |
| `drivetrain.lsd_torque_per_rad` / `lsd_preload` | 30 Nm/(rad/s) / 60 Nm | 仕様の LSD 式は差回転に比例したまま上限が無く発散する。`bias * |T| + preload` で頭打ちにした |
| `steering.max_steer_angle` / `time_constant` | 0.50 rad / 0.06 s | `WheelState::steer_angle` が「実舵角」である以上、ラックの一次遅れが要る |

`brakes` は `max_torque_front/rear` と `bias_front` の両方があり冗長。
**`max_torque_*` が既に前後バランスを内包している**（3600 : 2100 = 0.632）と解釈し、
`bias_front` はその基準からのトリムとして扱う。両フィールドが整合的に効く。

### 実測値（`cargo test --release`）

| 項目 | 実測 | 予算 / 帯 |
|------|------|-----------|
| `Vehicle::step` 1 台 1 tick | **1 500 ns** | < 8 000 ns |
| 24 台 × 4 tick / render frame | **0.144 ms** | <= 2.0 ms |
| 静止 4 輪荷重の合計 | 誤差 **0.00000%** | < 0.1% |
| 静的前後配分 | **0.45000** | 誤差 < 1% |
| 0-100 km/h | **3.85 s** | 3.2〜4.2 s |
| 100-0 制動 | **26.8 m**（ペダル 0.47） | 25〜40 m（改定後） |
| 定常円旋回 最大横 G | **1.41 G @ R = 49.0 m** | 1.4〜2.2 G |
| 惰行減速の一致 | 誤差 **0.7%** | < 5% |
| 60 分低速走行 | `recovered_steps = 0` | 0 |
| 50 mm 段差 @ 200 km/h | `recovered_steps = 0` | 0 |

**惰行減速の照合には車輪の回転慣性を等価質量として足すこと。**
`I / r^2 = factor * m_unsprung`（半径によらない）で 1 輪 14.7 kg、4 輪で 58.8 kg。
これを忘れると実測が 5% ずれて見える（実際に一度そう見えた）。

### 低速安定性がなぜ成立するか（再導出すると高くつく）

車輪回転の陽解法は、タイヤ力の勾配 `dFx/dspin` が大きいと `dt` 内で発散しうる。
低速（`v = 2 m/s`）では `dFx/dspin ≈ 13 700 N/(rad/s)` となり、素朴に解くと
1 サブステップあたりの利得が 2.9 に達して**発散する**。
これを止めているのは**緩和長**である。緩和の時定数は `L_relax / max(|v|, 1) = 0.15 s` で
サブステップ `1/960 s` よりはるかに長いため、実効利得は `2.9 × 0.0069 = 0.02` に落ちる。

**つまり緩和長は「タイヤの過渡特性」であると同時に「陽解法を安定させる仕掛け」でもある。**
`relaxation_length` を小さくすると低速で破綻する。ここを触るときは T-VEH-06 を必ず回すこと。
