//! `sim-driver` 受け入れテストの共有ハーネス（トラック / 車両パラメータ / レーシングライン）。
//!
//! **運動学プラント（自転車モデル）廃止済み**（TASK-2-4 Phase 3）。かつてここにあった
//! 自転車モデルの走行ヘルパーは実トラック幾何に対して Driver の制御ループを検証するための
//! ハーネスで、`sim-vehicle` の代替ではなかった。運動学プラント依存のテストは実物理版
//! （`crates/sim-core/tests/world_ai.rs` の T-AI-*R / T-DRV-*R）へ移行済みで、
//! `sim-driver/tests/driver.rs` に残るテストはこの `Line::build` 等だけで足りる
//! （実車両・実路面の閉ループ検証は `sim-core` が担当。`sim-driver` は `sim-core` に
//! 依存できない = 依存グラフの循環禁止）。

#![allow(dead_code)]

use sim_line::{Corridor, PerformanceEnvelope, SpeedProfile, Trajectory};
use sim_math::Rng;
use sim_track::{load_track, Track};
use sim_vehicle::VehicleParams;

pub const SPEC_JSON: &str = include_str!("../../../../assets/vehicles/gt_proto_a.spec.json");
/// レーシングラインのサンプリング間隔 [m]。
pub const LINE_STEP_M: f64 = 2.0;

/// 束ねた Aoyama Ring。
pub fn track() -> Track {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("assets")
        .join("tracks")
        .join("aoyama_ring.track.json");
    load_track(path).expect("bundled circuit loads and validates")
}

/// gt_proto_a の車両パラメータ。
pub fn params() -> VehicleParams {
    VehicleParams::from_json_str(SPEC_JSON).expect("gt_proto_a.spec.json loads and validates")
}

/// レーシングライン一式（起動時 1 回だけ生成する想定。テストでも 1 回で足りる）。
pub struct Line {
    pub corridor: Corridor,
    pub trajectory: Trajectory,
    pub speed: SpeedProfile,
    pub envelope: PerformanceEnvelope,
}

impl Line {
    pub fn build(track: &Track, params: &VehicleParams) -> Line {
        let half_w = 0.5 * params.dimensions.width;
        let corridor = Corridor::from_track(track, LINE_STEP_M, half_w, 0.20);
        let trajectory = Trajectory::reference(&corridor, track, LINE_STEP_M);
        let envelope = PerformanceEnvelope::from_params(params);
        let speed = SpeedProfile::generate(&trajectory, track, &envelope, LINE_STEP_M);
        Line {
            corridor,
            trajectory,
            speed,
            envelope,
        }
    }
}

/// `race_seed` から個体系列を作る。異なる `driver_ix` は異なる系列になる。
pub fn driver_rng(race_seed: u64, driver_ix: u32) -> Rng {
    Rng::from_seed(race_seed).derive(&format!("driver:{driver_ix:02}"))
}

/// f64 列を `to_bits` で連結したハッシュ（決定性比較用）。
pub fn hash_f64(series: &[f64]) -> u64 {
    let mut h: u64 = 0xCBF2_9CE4_8422_2325;
    for &x in series {
        for b in x.to_bits().to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01B3);
        }
    }
    h
}

/// 標準偏差。
pub fn std_dev(xs: &[f64]) -> f64 {
    if xs.len() < 2 {
        return 0.0;
    }
    let mean = xs.iter().sum::<f64>() / xs.len() as f64;
    let var = xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (xs.len() - 1) as f64;
    var.sqrt()
}
