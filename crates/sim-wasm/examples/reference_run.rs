//! ネイティブ参照ラン。ブラウザ（WASM）側の結果と突き合わせるための独立実行。
//!
//! `WorldView` を一定入力で `steps` tick 進め、最終的な車体重心のワールド姿勢を
//! JSON 1 行で出力する。ブラウザ側で同じ `(spawn_s, steps, throttle, gear)` を
//! 一定入力で回し、`body_poses()[0..7]` と突き合わせる（TASK-1B-3 T-EV-B3）。
//!
//! 使い方:
//! ```text
//! cargo run -p sim-wasm --release --example reference_run -- <spawn_s> <steps> <throttle> <gear>
//! ```

use sim_wasm::WorldView;

const AOYAMA: &str = include_str!("../../../assets/tracks/aoyama_ring.track.json");
const SPEC: &str = include_str!("../../../assets/vehicles/gt_proto_a.spec.json");

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let spawn_s: f64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(40.0);
    let steps: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(300);
    let throttle: f64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(0.4);
    let gear: f64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(1.0);

    let mut wv = WorldView::from_json(AOYAMA, SPEC).expect("load aoyama + gt proto a");
    wv.spawn(spawn_s, 0.0).expect("spawn");

    // [steer, throttle, brake, clutch, gear, drs] を一定で与える。
    let inputs = [0.0, throttle, 0.0, 0.0, gear, 0.0];
    for _ in 0..steps {
        wv.step(1, &inputs);
    }

    let p = wv.body_poses();
    let tele = wv.telemetry();
    println!(
        r#"{{"pos":[{},{},{}],"quat":[{},{},{},{}],"s":{},"speed":{},"tick":{}}}"#,
        p[0],
        p[1],
        p[2],
        p[3],
        p[4],
        p[5],
        p[6],
        tele[0],
        tele[3],
        wv.tick()
    );
}
