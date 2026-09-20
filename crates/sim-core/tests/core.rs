//! TASK-1B-2 受け入れテスト（T-CORE-01 〜 09）。
//!
//! トラック（`assets/tracks/aoyama_ring.track.json`）と車両
//! （`assets/vehicles/gt_proto_a.spec.json`）は実アセットを読む。

use std::path::PathBuf;
use std::time::Instant;

use sim_core::{
    ControlInput, GroundProbe, LapCrossing, TrackCoord, TrackGround, Vehicle, VehicleEntry,
    VehicleId, VehicleParams, World, LAP_MAX_DS,
};
use sim_math::Vec3;
use sim_track::{load_track, Track};

const SPEC_JSON: &str = include_str!("../../../assets/vehicles/gt_proto_a.spec.json");

fn track() -> Track {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("assets")
        .join("tracks")
        .join("aoyama_ring.track.json");
    load_track(path).expect("bundled circuit loads and validates")
}

fn params() -> VehicleParams {
    VehicleParams::from_json_str(SPEC_JSON).expect("gt_proto_a.spec.json loads and validates")
}

/// 前進入力。1 速・スロットル一定・直進。
fn drive(throttle: f64, gear: i8) -> ControlInput {
    ControlInput {
        steer: 0.0,
        throttle,
        brake: 0.0,
        clutch: 0.0,
        gear,
        drs: false,
    }
}

// ------------------------------------------------------------------------------------------
// T-CORE-01 — 接地点がトラック表面と一致する
// ------------------------------------------------------------------------------------------

#[test]
fn t_core_01_probe_point_matches_track_surface() {
    let track = track();
    let mut ground = TrackGround::new(&track);
    let l = track.length();
    let n = 200;

    // 路面点の「真上」から鉛直下方へ探索し、返る接地点が
    //   - y   : frame_at 由来の路面高さと 1e-9 以内
    //   - x,z : 探索開始点と厳密一致（鉛直探索なので動いてはならない）
    // であることを確認する。センターライン（t=0）だけでなく横オフセット付きでも見る
    // ので、GroundProbe の「鉛直下方」契約と、法線が傾いた区間での鉛直交点の
    // 計算が同時に検証される。
    let offsets = [-4.0, -2.0, 0.0, 2.0, 4.0];

    let mut max_height_err = 0.0f64;
    let mut max_xz_err = 0.0f64;

    for i in 0..n {
        let s = l * i as f64 / n as f64;
        let frame = track.frame_at(s);
        ground.set_hint(s);

        for t in offsets {
            let surface = frame.position + frame.lateral * t;
            let from = surface + Vec3::Y * 1.0;
            let hit = ground.probe(from, 5.0).expect("probe hits the surface");

            max_height_err = max_height_err.max((hit.point.y - surface.y).abs());
            max_xz_err = max_xz_err
                .max((hit.point.x - from.x).abs())
                .max((hit.point.z - from.z).abs());
        }
    }

    // 仕様: frame_at 由来の高さと 1e-9 以内。
    assert!(
        max_height_err < 1.0e-9,
        "max surface height error {max_height_err:e} exceeds 1e-9"
    );
    assert!(
        max_xz_err < 1.0e-12,
        "vertical probe moved x/z by {max_xz_err:e} (must stay under the start point)"
    );
}

// ------------------------------------------------------------------------------------------
// T-CORE-01b — 最大バンク点でも鉛直探索が路面高さに一致する
// ------------------------------------------------------------------------------------------

#[test]
fn t_core_01b_vertical_probe_is_exact_on_max_banking() {
    let track = track();
    let mut ground = TrackGround::new(&track);
    let l = track.length();

    // 最大バンクの s を探す。
    let n = 4000;
    let mut banked_s = 0.0;
    let mut max_bank = 0.0f64;
    for i in 0..n {
        let s = l * i as f64 / n as f64;
        let b = track.frame_at(s).banking.abs();
        if b > max_bank {
            max_bank = b;
            banked_s = s;
        }
    }
    assert!(
        max_bank > 0.05,
        "expected a meaningfully banked corner, got max |banking| {max_bank}"
    );

    let frame = track.frame_at(banked_s);
    ground.set_hint(banked_s);

    // バンク面上の複数点の真上から鉛直に探索する。法線が鉛直から
    // |banking| だけ傾いていても、鉛直交点は路面点に一致しなければならない
    // （垂線投影だと y が cos^2 だけ縮んで数 mm ずれる）。
    for t in [-5.0, -3.0, 0.0, 3.0, 5.0] {
        let surface = frame.position + frame.lateral * t;
        let from = surface + Vec3::Y * 0.7;
        let hit = ground.probe(from, 5.0).expect("probe hits on banking");

        assert!(
            (hit.point.y - surface.y).abs() < 1.0e-9,
            "banked contact height off by {:e} at t={t}",
            (hit.point.y - surface.y).abs()
        );
        assert!(
            (hit.point.x - from.x).abs() < 1.0e-12 && (hit.point.z - from.z).abs() < 1.0e-12,
            "vertical probe drifted in x/z on banking"
        );
    }
}

// ------------------------------------------------------------------------------------------
// T-CORE-02 — バンク区間で法線が傾く / 法線は単位ベクトル
// ------------------------------------------------------------------------------------------

#[test]
fn t_core_02_normal_tilts_on_banking_and_is_unit() {
    let track = track();
    let mut ground = TrackGround::new(&track);
    let l = track.length();
    let n = 4000;

    // 全周で法線が単位ベクトルであること。
    let mut max_unit_err = 0.0f64;
    // バンクが最も強い s を探す。
    let mut banked_s = 0.0;
    let mut max_bank = 0.0f64;

    for i in 0..n {
        let s = l * i as f64 / n as f64;
        let frame = track.frame_at(s);
        ground.set_hint(s);
        // センターライン点の真上から鉛直下方へ探索する（GroundProbe の契約どおり）。
        let from = frame.position + Vec3::Y * 0.5;
        let hit = ground.probe(from, 5.0).expect("probe hits");

        max_unit_err = max_unit_err.max((hit.normal.length() - 1.0).abs());

        if frame.banking.abs() > max_bank {
            max_bank = frame.banking.abs();
            banked_s = s;
        }
    }

    assert!(
        max_unit_err < 1.0e-12,
        "ground normal is not unit length: err {max_unit_err:e}"
    );
    assert!(
        max_bank > 0.05,
        "expected a meaningfully banked corner, got max |banking| {max_bank}"
    );

    // バンク区間では法線が鉛直から傾く。センターライン点の真上から鉛直に探索する。
    let frame = track.frame_at(banked_s);
    ground.set_hint(banked_s);
    let from = frame.position + Vec3::Y * 0.5;
    let hit = ground.probe(from, 5.0).expect("probe hits on banking");
    let cos_to_vertical = hit.normal.dot(Vec3::Y);
    assert!(
        cos_to_vertical < max_bank.cos() + 1.0e-6 && cos_to_vertical < 0.9999,
        "normal should tilt by roughly the banking angle (cos {cos_to_vertical}, |banking| {max_bank})"
    );
    // 接地点はセンターライン点（鉛直線がその上を通る）に一致する。
    assert!(
        (hit.point - frame.position).length() < 1.0e-8,
        "contact point should sit under the probe (err {:e})",
        (hit.point - frame.position).length()
    );
    // 返る法線は接地点の station で接線と直交する。
    let contact = track.world_to_track(hit.point, Some(banked_s));
    assert!(
        hit.normal.dot(track.frame_at(contact.s).tangent).abs() < 1.0e-9,
        "ground normal must be orthogonal to the tangent at the contact station"
    );
}

// ------------------------------------------------------------------------------------------
// T-CORE-03 — 路面種別が GroundHit の物理量に反映される
// ------------------------------------------------------------------------------------------

#[test]
fn t_core_03_surface_kind_changes_ground_physics() {
    let track = track();
    let mut ground = TrackGround::new(&track);

    // 直線の中ほど。
    let s = 300.0;
    let frame = track.frame_at(s);
    ground.set_hint(s);

    let on_track = ground
        .probe(frame.position + frame.normal * 0.5, 5.0)
        .expect("on-track probe hits");
    assert!(
        (on_track.grip - 1.0).abs() < 1.0e-9,
        "asphalt grip should be 1.0, got {}",
        on_track.grip
    );

    // コース左端よりさらに外へ（縁石を越えて runoff へ）。
    let t_off = frame.width_left + 5.0;
    let off_track = ground
        .probe(
            frame.position + frame.lateral * t_off + frame.normal * 0.5,
            5.0,
        )
        .expect("off-track probe still hits a surface");

    assert!(
        off_track.grip < on_track.grip,
        "off-track grip {} should be below on-track grip {}",
        off_track.grip,
        on_track.grip
    );
    assert!(
        off_track.rolling_resistance > on_track.rolling_resistance,
        "off-track rolling resistance should be higher"
    );
}

// ------------------------------------------------------------------------------------------
// T-CORE-04 — Aoyama Ring 上を 1 台が 60 秒走っても破綻しない
// ------------------------------------------------------------------------------------------

#[test]
fn t_core_04_single_car_runs_for_60s_without_blowup() {
    let track = track();
    let mut world = World::new(track);
    // s = 300 は本コースの長いストレート上（曲率ゼロ区間・全長 742 m）。Driver AI が
    // まだ無いのでコーナーへは突っ込ませない。短く加速したあと軽いスロットルを 60 秒
    // 保持し、**常に非ゼロ速度で走り続けさせる**（停車させて recovered_steps だけ見ても
    // 何も保証されないため）。転がり抵抗と空気抵抗が軽スロットルと釣り合って低速で頭打ち
    // になり、60 秒ぶんの走行距離がストレート内（s < 982）に収まる。
    world
        .spawn(params(), 300.0, 0.0)
        .expect("spawn on the straight");

    let launch = drive(0.4, 1);
    let cruise = drive(0.05, 1);
    let steps = (60.0 / sim_core::PHYSICS_DT).round() as usize;
    let launch_steps = 2 * 240;

    let launch_in = [launch];
    let cruise_in = [cruise];
    let mut max_t_off = 0.0f64;
    let mut min_speed_after_launch = f64::INFINITY;
    for k in 0..steps {
        world.step(if k < launch_steps {
            &launch_in
        } else {
            &cruise_in
        });
        let entry = &world.vehicles()[0];
        max_t_off = max_t_off.max(entry.coord.t.abs());
        assert_eq!(
            entry.vehicle.state().recovered_steps,
            0,
            "physics recovered at step {k} (must never happen)"
        );
        // ローンチ後は毎 tick 前進していること（駐車していない）。
        if k >= launch_steps {
            min_speed_after_launch =
                min_speed_after_launch.min(entry.vehicle.state().forward_speed());
        }
    }

    let entry = &world.vehicles()[0];
    let st = entry.vehicle.state();
    assert!(st.position.is_finite(), "position went non-finite");
    assert!(st.velocity.is_finite(), "velocity went non-finite");
    assert!(st.engine_rpm.is_finite(), "engine rpm went non-finite");
    assert!(entry.coord.s.is_finite() && entry.coord.t.is_finite());
    assert_eq!(world.tick(), steps as u64);
    // 60 秒間、ローンチ後も一度も止まらず走り続けた。
    assert!(
        min_speed_after_launch > 1.0,
        "car should keep rolling for the whole minute (min forward speed = {min_speed_after_launch} m/s)"
    );
    // 実際に前進し、かつストレートの舗装上に留まっていた。
    assert!(
        entry.coord.s > 400.0 && entry.coord.s < 982.0,
        "car should have driven forward along the straight (s = {})",
        entry.coord.s
    );
    assert!(
        max_t_off < 6.0,
        "car drifted off the lane (max |t| = {max_t_off} m)"
    );
}

// ------------------------------------------------------------------------------------------
// T-CORE-05 — ラップカウントが detect_lap_crossing 経由で正しく 1 増える
// ------------------------------------------------------------------------------------------

#[test]
fn t_core_05_lap_count_increments_once_on_forward_crossing() {
    let track = track();
    let l = track.length();
    let mut world = World::new(track);
    // スタート/フィニッシュ（s = 0）の 20 m 手前に置く。
    world
        .spawn(params(), l - 20.0, 0.0)
        .expect("spawn before line");

    let input = [drive(0.5, 1)];
    let mut saw_forward = false;

    for _ in 0..8_000 {
        world.step(&input);
        let entry = &world.vehicles()[0];
        if entry.last_crossing == LapCrossing::Forward {
            saw_forward = true;
        }
        if entry.laps_completed >= 1 {
            break;
        }
    }

    let entry = &world.vehicles()[0];
    assert!(
        saw_forward,
        "expected a Forward crossing of the start/finish line"
    );
    assert_eq!(
        entry.laps_completed, 1,
        "lap count should be exactly 1 after one forward crossing"
    );
    // 線を越えた直後なので s は小さい。
    assert!(
        entry.coord.s < l * 0.25,
        "after crossing, s should have wrapped near 0 (got {})",
        entry.coord.s
    );
}

// ------------------------------------------------------------------------------------------
// T-CORE-06 — Suspect ではラップを加算しない
// ------------------------------------------------------------------------------------------

#[test]
fn t_core_06_suspect_crossing_does_not_add_a_lap() {
    let track = track();
    let l = track.length();

    let make_entry = |s: f64| VehicleEntry {
        vehicle: Vehicle::new(params(), Vec3::new(0.0, 0.5, 0.0), 0.0).unwrap(),
        coord: TrackCoord::new(s, 0.0),
        laps_completed: 0,
        last_crossing: LapCrossing::None,
    };

    // (a) スタート/フィニッシュを跨ぐ向きだが 1 tick で 12 m 飛んだ -> Suspect
    //     （LAP_MAX_DS ≈ 2.5 m。正当な前進跨ぎの理論最悪 ≈ 2.1 m/tick より十分上）。
    let mut e = make_entry(l - 6.0);
    let crossing = e.sync_track_position(&track, TrackCoord::new(6.0, 0.0), LAP_MAX_DS);
    assert_eq!(crossing, LapCrossing::Suspect, "12 m jump must be Suspect");
    assert_eq!(e.laps_completed, 0, "Suspect must not add a lap");
    assert_eq!(e.last_crossing, LapCrossing::Suspect);

    // (b) 線を跨がない巨大ジャンプも Suspect（そもそも加算対象外）。
    let mut e = make_entry(100.0);
    let crossing = e.sync_track_position(&track, TrackCoord::new(600.0, 0.0), LAP_MAX_DS);
    assert_eq!(crossing, LapCrossing::Suspect);
    assert_eq!(e.laps_completed, 0);

    // (c) 対照: max_ds 以内の正当な前進跨ぎは Forward で +1。
    let mut e = make_entry(l - 0.2);
    let crossing = e.sync_track_position(&track, TrackCoord::new(0.2, 0.0), LAP_MAX_DS);
    assert_eq!(crossing, LapCrossing::Forward);
    assert_eq!(e.laps_completed, 1);
}

// ------------------------------------------------------------------------------------------
// T-CORE-07 — 順位は (laps_completed, s) の辞書順。ワールド距離では並べない
// ------------------------------------------------------------------------------------------

#[test]
fn t_core_07_standings_are_laps_then_s_lexicographic() {
    let track = track();
    let l = track.length();
    let mut world = World::new(track);

    // car0: 線の 25 m 手前。car1: 線の 10 m 手前（car0 より前）。
    // 同一ラップでは s の大きい car1 が上位。
    let id0 = world.spawn(params(), l - 25.0, 0.0).expect("spawn car0");
    let id1 = world.spawn(params(), l - 10.0, 0.0).expect("spawn car1");

    assert_eq!(
        world.standings(),
        vec![id1, id0],
        "initially car1 leads on s"
    );

    // car0 だけ前進させ、スタート/フィニッシュを跨がせる
    // （inputs 長 1 -> car1 は default = ニュートラルで停止）。
    let input = [drive(0.6, 1)];
    for _ in 0..8_000 {
        world.step(&input);
        if world.vehicles()[0].laps_completed >= 1 {
            break;
        }
    }

    let e0 = &world.vehicles()[id0.0];
    let e1 = &world.vehicles()[id1.0];
    assert_eq!(e0.laps_completed, 1, "car0 should have completed a lap");
    assert_eq!(e1.laps_completed, 0, "car1 never moved");
    // car0 の s は折り返して car1 より小さい……
    assert!(
        e0.coord.s < e1.coord.s,
        "car0 s {} should be below car1 s {} after wrap",
        e0.coord.s,
        e1.coord.s
    );
    // ……それでも laps が効いて car0 が首位。
    assert_eq!(
        world.standings(),
        vec![id0, id1],
        "higher lap count must outrank higher s"
    );
}

// ------------------------------------------------------------------------------------------
// T-CORE-07b — 同一ラップで s の順位とワールド距離の順位が食い違う配置
// ------------------------------------------------------------------------------------------

#[test]
fn t_core_07b_standings_ignore_world_distance_when_it_disagrees_with_s() {
    let track = track();

    // スタート/フィニッシュ点（s = 0）のワールド座標を基準にする。
    let line = track.frame_at(0.0).position;

    // s = 706 と s = 1005。どちらも本コースの長いストレート上で、同一ラップ。
    // 正しい順位: s の大きい car1（s = 1005）が首位。
    // しかしワールド空間での「スタート/フィニッシュ線からの距離」は
    //   car0(s=706)  ≈ 623 m   ← 線に近い
    //   car1(s=1005) ≈ 916 m   ← 線から遠い
    // なので「線に近い方が前」というワールド距離ベースの誤実装なら car0 を首位にする。
    let sa = 706.0;
    let sb = 1005.0;
    let mut world = World::new(track);
    let id0 = world.spawn(params(), sa, 0.0).expect("spawn car0");
    let id1 = world.spawn(params(), sb, 0.0).expect("spawn car1");

    let e0 = &world.vehicles()[id0.0];
    let e1 = &world.vehicles()[id1.0];
    // 前提: ワールド距離では car0 の方が線に近い（誤実装なら首位判定される側）。
    let d0 = (e0.vehicle.state().position - line).length();
    let d1 = (e1.vehicle.state().position - line).length();
    assert!(
        d0 < d1,
        "test setup: car0 world-distance {d0:.1} should be below car1 {d1:.1}"
    );
    assert_eq!(e0.laps_completed, 0);
    assert_eq!(e1.laps_completed, 0);

    // 正: (laps, s) の辞書順のみ。s の大きい car1 が首位。
    assert_eq!(
        world.standings(),
        vec![id1, id0],
        "standings must follow s, not world-space proximity to the line"
    );
}

// ------------------------------------------------------------------------------------------
// T-CORE-08 — 決定性: 同一入力列 2 回で全状態ビット一致
// ------------------------------------------------------------------------------------------

fn run_schedule(steps: usize) -> Vec<(Vec3, Vec3, f64, f64, u32)> {
    let mut world = World::new(track());
    world.spawn(params(), 0.0, 0.0).unwrap();
    world.spawn(params(), 40.0, 1.0).unwrap();
    world.spawn(params(), 80.0, -1.0).unwrap();

    for k in 0..steps {
        let th = 0.2 + 0.5 * ((k as f64) * 0.001).sin().abs();
        let steer = 0.05 * ((k as f64) * 0.01).sin();
        let inputs = [
            ControlInput {
                steer,
                ..drive(th, 2)
            },
            ControlInput {
                steer: -steer,
                ..drive(0.35, 2)
            },
            drive(0.1, 1),
        ];
        world.step(&inputs);
    }

    world
        .vehicles()
        .iter()
        .map(|e| {
            let st = e.vehicle.state();
            (
                st.position,
                st.velocity,
                st.engine_rpm,
                e.coord.s,
                e.laps_completed,
            )
        })
        .collect()
}

#[test]
fn t_core_08_deterministic_across_identical_runs() {
    let a = run_schedule(3_000);
    let b = run_schedule(3_000);
    assert_eq!(a.len(), 3);
    for (va, vb) in a.iter().zip(b.iter()) {
        assert_eq!(
            va.0.to_bits_tuple(),
            vb.0.to_bits_tuple(),
            "position differs"
        );
        assert_eq!(
            va.1.to_bits_tuple(),
            vb.1.to_bits_tuple(),
            "velocity differs"
        );
        assert_eq!(va.2.to_bits(), vb.2.to_bits(), "engine rpm differs");
        assert_eq!(va.3.to_bits(), vb.3.to_bits(), "track s differs");
        assert_eq!(va.4, vb.4, "lap count differs");
    }
}

/// `Vec3` をビット単位で比較するための拡張。
trait BitsTuple {
    fn to_bits_tuple(&self) -> (u64, u64, u64);
}
impl BitsTuple for Vec3 {
    fn to_bits_tuple(&self) -> (u64, u64, u64) {
        (self.x.to_bits(), self.y.to_bits(), self.z.to_bits())
    }
}

// ------------------------------------------------------------------------------------------
// T-CORE-09 — 24 台で 1 tick <= 2.0 ms
// ------------------------------------------------------------------------------------------

#[test]
fn t_core_09_twentyfour_cars_step_under_2ms() {
    let track = track();
    let mut world = World::new(track);
    for i in 0..24 {
        let s = 15.0 * i as f64;
        let t = if i % 2 == 0 { 1.5 } else { -1.5 };
        world.spawn(params(), s, t).expect("spawn grid car");
    }
    assert_eq!(world.vehicles().len(), 24);

    let inputs: Vec<ControlInput> = (0..24).map(|_| drive(0.4, 2)).collect();

    // ウォームアップ（コンパイル済みコードのキャッシュを暖める）。
    for _ in 0..50 {
        world.step(&inputs);
    }

    let iters = 300;
    let start = Instant::now();
    for _ in 0..iters {
        world.step(&inputs);
    }
    let per_step = start.elapsed().as_secs_f64() / iters as f64;

    println!("T-CORE-09: 24-car step = {:.1} us/tick", per_step * 1.0e6);
    assert!(
        per_step < 2.0e-3,
        "24-car step took {:.3} ms (budget 2.0 ms)",
        per_step * 1.0e3
    );
}

// `sim_core` は VehicleId を再エクスポートしているのでこれも触れておく（未使用警告回避）。
#[allow(dead_code)]
fn _touch(id: VehicleId) -> usize {
    id.0
}
