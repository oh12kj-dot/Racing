//! トラック定義の JSON 入出力と、同梱サーキットの受け入れテスト。
//!
//! レイアウト要件は目視ではなく **`Track::frame_at` の実測値**から検証する。
//! センターラインは Catmull-Rom スプラインで補間されるため、設計上の半径と
//! 実際に走行できる半径は一致しない。検証すべきは後者である。

#![cfg(feature = "serde")]

use sim_math::Vec3;
use sim_track::{
    load_track, track_from_json_str, track_to_json_string, CrossSection, SurfaceKind, Track,
    TrackCoord, TrackDefinition, TrackIoError, TRACK_SCHEMA_VERSION,
};
use std::path::PathBuf;

/// 同梱サーキットの絶対パス。カレントディレクトリに依存しない。
fn asset_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("assets")
        .join("tracks")
        .join("aoyama_ring.track.json")
}

fn asset_track() -> Track {
    load_track(asset_path()).expect("bundled circuit must load")
}

/// 小さな有効トラック（円）。エラー系テストの土台に使う。
fn tiny_definition() -> TrackDefinition {
    let n = 16;
    let centerline = (0..n)
        .map(|i| {
            let a = std::f64::consts::TAU * i as f64 / n as f64;
            Vec3::new(60.0 * a.cos(), 0.0, 60.0 * a.sin())
        })
        .collect();
    TrackDefinition {
        name: "Tiny".to_string(),
        centerline,
        sections: vec![CrossSection::default(); n],
        closed: true,
        sector_splits: vec![1.0 / 3.0, 2.0 / 3.0],
        start_finish: 0.0,
    }
}

// ---------------------------------------------------------------------------
// ラウンドトリップ
// ---------------------------------------------------------------------------

#[test]
fn json_roundtrip() {
    let def = tiny_definition();
    let json = track_to_json_string(&def, "roundtrip fixture").expect("serialize");
    let back = track_from_json_str(&json).expect("deserialize");

    assert_eq!(back.name, def.name);
    assert_eq!(back.closed, def.closed);
    assert_eq!(back.centerline.len(), def.centerline.len());
    assert_eq!(back.sections.len(), def.sections.len());
    assert_eq!(back.sector_splits, def.sector_splits);
    assert_eq!(back.start_finish, def.start_finish);
    // NOTE: 完全なビット一致は要求しない。この serde_json では f64 が
    // 1 ULP ずれて往復することを実測で確認している
    //   22.96100594190540178 -> "22.961005941905402" -> 22.96100594190539823
    // トラックデータでは 1e-14 m の差であり物理的に無意味だが、
    // 「保存→再読込でビット一致する」と仮定してはならない。
    // アセット JSON は唯一の正であり実行時に再生成しないため、
    // PROJECT.md §7 の決定性契約（同一バイナリ・同一シードでビット一致）には影響しない。
    for (a, b) in def.centerline.iter().zip(back.centerline.iter()) {
        assert!(
            (*a - *b).length() < 1e-9,
            "centerline point moved too far across roundtrip: {a:?} -> {b:?}"
        );
    }
    for (a, b) in def.sections.iter().zip(back.sections.iter()) {
        assert_eq!(a.width_left, b.width_left);
        assert_eq!(a.width_right, b.width_right);
        assert_eq!(a.banking, b.banking);
        assert_eq!(a.camber, b.camber);
        assert_eq!(a.kerb_left, b.kerb_left);
        assert_eq!(a.kerb_right, b.kerb_right);
        assert_eq!(a.runoff, b.runoff);
    }

    // 構築結果まで一致すること（データが等しくても幾何が変われば意味がない）。
    let t0 = Track::build(&def).expect("build original");
    let t1 = Track::build(&back).expect("build roundtripped");
    assert!((t0.length() - t1.length()).abs() < 1e-9);
    for k in 0..200 {
        let s = t0.length() * k as f64 / 200.0;
        let f0 = t0.frame_at(s);
        let f1 = t1.frame_at(s);
        assert!((f0.position - f1.position).length() < 1e-9);
        assert!((f0.tangent - f1.tangent).length() < 1e-9);
        assert!((f0.curvature - f1.curvature).abs() < 1e-9);
    }
}

/// 同梱アセットもラウンドトリップで不変であること。
#[test]
fn asset_roundtrip_is_stable() {
    let def = sim_track::track_from_json_file(asset_path()).expect("load");
    let json = track_to_json_string(&def, "").expect("serialize");
    let back = track_from_json_str(&json).expect("deserialize");
    assert_eq!(def.centerline.len(), back.centerline.len());
    let a = Track::build(&def).expect("build");
    let b = Track::build(&back).expect("build");
    assert!((a.length() - b.length()).abs() < 1e-9);
}

// ---------------------------------------------------------------------------
// アセットのロード
// ---------------------------------------------------------------------------

#[test]
fn load_asset_track() {
    let path = asset_path();
    assert!(path.exists(), "asset missing at {}", path.display());

    let t0 = std::time::Instant::now();
    let track = load_track(&path).expect("bundled circuit must load and build");
    let elapsed = t0.elapsed();

    assert_eq!(track.name(), "Aoyama Ring");
    assert!(track.is_closed());
    println!(
        "load_track: {:.2} ms, length {:.1} m",
        elapsed.as_secs_f64() * 1000.0,
        track.length()
    );
    assert!(elapsed.as_millis() < 50, "load too slow: {elapsed:?}");

    let bytes = std::fs::metadata(&path).expect("stat").len();
    println!("asset size: {bytes} bytes");
    assert!(bytes < 200_000, "asset file too large: {bytes} bytes");
}

// ---------------------------------------------------------------------------
// レイアウト要件（実測から検証する）
// ---------------------------------------------------------------------------

/// 曲率から検出したコーナー。
#[derive(Debug, Clone)]
struct Corner {
    s_start: f64,
    s_end: f64,
    /// コーナー中の半径の**中央値**。ドライバーが実際に体験する半径はこちらであり、
    /// 継ぎ目の 1 サンプル分のスパイクに引きずられない。
    median_radius: f64,
    /// コーナー中の最小半径。継ぎ目のスパイクを含む。品質チェックに使う。
    min_radius: f64,
    /// 正なら左旋回。
    sign: f64,
}

/// 曲率の絶対値が閾値を超える連続区間をコーナーとして抽出する。
fn detect_corners(track: &Track, radius_threshold: f64) -> Vec<Corner> {
    let l = track.length();
    let step = 1.0;
    let n = (l / step).ceil() as usize;

    // (s, radius, sign) を集め、符号が同じ連続区間をコーナーとしてまとめる。
    struct Run {
        s_start: f64,
        s_end: f64,
        sign: f64,
        radii: Vec<f64>,
    }
    let mut runs: Vec<Run> = Vec::new();
    let mut current: Option<Run> = None;
    for i in 0..n {
        let s = i as f64 * step;
        let k = track.frame_at(s).curvature;
        let r = if k.abs() < 1e-9 {
            f64::INFINITY
        } else {
            1.0 / k.abs()
        };
        if r < radius_threshold {
            match current.as_mut() {
                Some(c) if c.sign * k >= 0.0 => {
                    c.s_end = s;
                    c.radii.push(r);
                }
                _ => {
                    if let Some(c) = current.take() {
                        runs.push(c);
                    }
                    current = Some(Run {
                        s_start: s,
                        s_end: s,
                        sign: k.signum(),
                        radii: vec![r],
                    });
                }
            }
        } else if let Some(c) = current.take() {
            runs.push(c);
        }
    }
    if let Some(c) = current.take() {
        runs.push(c);
    }

    runs.into_iter()
        .filter(|r| r.s_end - r.s_start >= 8.0)
        .map(|mut r| {
            r.radii
                .sort_by(|a, b| a.partial_cmp(b).expect("finite radii"));
            let median = r.radii[r.radii.len() / 2];
            let min = r.radii[0];
            Corner {
                s_start: r.s_start,
                s_end: r.s_end,
                median_radius: median,
                min_radius: min,
                sign: r.sign,
            }
        })
        .collect()
}

#[test]
fn asset_track_meets_layout_requirements() {
    let track = asset_track();
    let l = track.length();

    // --- 全長 ---
    println!("length: {l:.1} m");
    assert!(
        (3800.0..=4600.0).contains(&l),
        "length {l:.1} m outside 3800..4600"
    );

    // --- セクター ---
    assert_eq!(
        track.sector_boundaries().len(),
        2,
        "3 sectors means 2 boundaries"
    );
    assert_eq!(track.sector_of(0.0), 0);
    assert_eq!(track.sector_of(l * 0.5), 1);
    assert_eq!(track.sector_of(l * 0.9), 2);

    // --- コーナー ---
    let corners = detect_corners(&track, 250.0);
    println!("detected {} corners:", corners.len());
    for c in &corners {
        println!(
            "  s={:7.1}..{:7.1} median_R={:7.1} m  min_R={:7.1} m  {}",
            c.s_start,
            c.s_end,
            c.median_radius,
            c.min_radius,
            if c.sign > 0.0 { "left" } else { "right" }
        );
    }

    let fast = corners
        .iter()
        .filter(|c| c.median_radius >= 120.0 && c.median_radius < 250.0)
        .count();
    let medium = corners
        .iter()
        .filter(|c| (40.0..=80.0).contains(&c.median_radius))
        .count();
    let hairpin = corners
        .iter()
        .filter(|c| (15.0..=25.0).contains(&c.median_radius))
        .count();
    println!("fast(>=120m)={fast} medium(40..80m)={medium} hairpin(15..25m)={hairpin}");
    assert!(fast >= 2, "need >=2 fast corners (R>=120 m), found {fast}");
    assert!(
        medium >= 3,
        "need >=3 medium corners (R 40..80 m), found {medium}"
    );
    assert!(
        hairpin >= 1,
        "need >=1 hairpin (R 15..25 m), found {hairpin}"
    );

    // --- S 字（近接した逆向きコーナーの組） ---
    let mut has_s = false;
    for w in corners.windows(2) {
        let gap = w[1].s_start - w[0].s_end;
        if w[0].sign * w[1].sign < 0.0 && gap < 120.0 {
            println!(
                "S-complex found: {:.0} m -> {:.0} m (gap {:.0} m)",
                w[0].s_start, w[1].s_end, gap
            );
            has_s = true;
        }
    }
    assert!(
        has_s,
        "need at least one S-complex (opposite corners close together)"
    );

    // --- 最長ストレート ---
    let step = 1.0;
    let n = (l / step).ceil() as usize;
    let mut longest = 0.0f64;
    let mut run = 0.0f64;
    for i in 0..=n {
        let s = (i as f64 * step) % l;
        let k = track.frame_at(s).curvature.abs();
        let r = if k < 1e-9 { f64::INFINITY } else { 1.0 / k };
        if r > 800.0 {
            run += step;
            longest = longest.max(run);
        } else {
            run = 0.0;
        }
    }
    println!("longest straight: {longest:.0} m");
    assert!(longest >= 700.0, "longest straight {longest:.0} m < 700 m");

    // --- 高低差 ---
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    for i in 0..n {
        let y = track.frame_at(i as f64 * step).position.y;
        lo = lo.min(y);
        hi = hi.max(y);
    }
    println!("elevation: {lo:.2} .. {hi:.2} m (range {:.2})", hi - lo);
    assert!(hi - lo >= 20.0, "elevation range {:.1} m < 20 m", hi - lo);

    // --- バンク ---
    let mut max_bank = 0.0f64;
    let mut bank_at = 0.0f64;
    for i in 0..n {
        let s = i as f64 * step;
        let b = track.frame_at(s).banking;
        if b.abs() > max_bank.abs() {
            max_bank = b;
            bank_at = s;
        }
    }
    println!("max banking: {max_bank:+.3} rad at s={bank_at:.0} m");
    assert!(
        (0.05..=0.12).contains(&max_bank.abs()),
        "banking magnitude {:.3} rad outside 0.05..0.12",
        max_bank.abs()
    );

    // バンクの符号が旋回方向と物理的に整合すること: 外側が持ち上がる。
    let f = track.frame_at(bank_at);
    let outer_t = if f.curvature > 0.0 { -6.0 } else { 6.0 }; // 左旋回なら外側は右(-t)
    let inner_t = -outer_t;
    let outer = track.track_to_world(TrackCoord::new(bank_at, outer_t));
    let inner = track.track_to_world(TrackCoord::new(bank_at, inner_t));
    println!(
        "banked corner: outer edge y={:.3}, inner edge y={:.3}",
        outer.y, inner.y
    );
    assert!(
        outer.y > inner.y,
        "banking must raise the outer edge (outer {:.3} vs inner {:.3})",
        outer.y,
        inner.y
    );

    // --- コース幅 ---
    let mut wmin = f64::INFINITY;
    let mut wmax = f64::NEG_INFINITY;
    for i in 0..n {
        let f = track.frame_at(i as f64 * step);
        let w = f.width_left + f.width_right;
        wmin = wmin.min(w);
        wmax = wmax.max(w);
    }
    println!("track width: {wmin:.1} .. {wmax:.1} m");
    assert!(
        wmin >= 12.0 && wmax <= 16.0,
        "width {wmin:.1}..{wmax:.1} outside 12..16 m"
    );

    // --- 縁石（surface_at 経由で検証する） ---
    let mut kerb_seen = 0usize;
    for c in &corners {
        let s = 0.5 * (c.s_start + c.s_end);
        let f = track.frame_at(s);
        let just_outside = f.width_left + 0.5;
        if track.surface_at(TrackCoord::new(s, just_outside)) == SurfaceKind::Kerb {
            kerb_seen += 1;
        }
    }
    println!(
        "corners with kerb just outside the white line: {kerb_seen}/{}",
        corners.len()
    );
    assert_eq!(
        kerb_seen,
        corners.len(),
        "every corner must have a kerb outside the racing surface"
    );

    // --- 制御点間隔 ---
    let def = sim_track::track_from_json_file(asset_path()).expect("load def");
    let m = def.centerline.len();
    let mut dmin = f64::INFINITY;
    let mut dmax = f64::NEG_INFINITY;
    for i in 0..m {
        let d = (def.centerline[(i + 1) % m] - def.centerline[i]).length();
        dmin = dmin.min(d);
        dmax = dmax.max(d);
    }
    println!("control points: {m}, spacing {dmin:.2}..{dmax:.2} m");
    assert!(
        dmin >= 8.0 && dmax <= 20.0,
        "control point spacing {dmin:.2}..{dmax:.2} outside 8..20 m"
    );
}

#[test]
fn asset_track_has_no_self_intersection() {
    let track = asset_track();
    let l = track.length();
    let step = 2.0;
    let n = (l / step) as usize;

    // 弧長で十分離れた 2 点が、コース幅の合計より近づいてはならない。
    let mut worst = (f64::INFINITY, 0.0, 0.0);
    for i in 0..n {
        let si = i as f64 * step;
        let pi = track.frame_at(si).position;
        for j in (i + 1)..n {
            let sj = j as f64 * step;
            if track.signed_delta_s(si, sj).abs() <= 50.0 {
                continue;
            }
            let pj = track.frame_at(sj).position;
            // 水平面での距離で判定する（立体交差は本トラックに存在しない）
            let d = (pi.horizontal() - pj.horizontal()).length();
            if d < worst.0 {
                worst = (d, si, sj);
            }
        }
    }
    let fi = track.frame_at(worst.1);
    let fj = track.frame_at(worst.2);
    let required = fi.width_left + fi.width_right + fj.width_left + fj.width_right;
    println!(
        "closest approach between distant points: {:.1} m at s={:.0} / s={:.0} (need > {:.1} m)",
        worst.0,
        worst.1,
        worst.2,
        required * 0.5
    );
    assert!(
        worst.0 > required * 0.5,
        "track approaches itself to {:.1} m at s={:.0} and s={:.0}; needs > {:.1} m",
        worst.0,
        worst.1,
        worst.2,
        required * 0.5
    );
}

#[test]
fn asset_track_is_drivable() {
    let track = asset_track();
    let l = track.length();
    let n = (l / 0.5) as usize;
    for i in 0..n {
        let s = i as f64 * 0.5;
        let f = track.frame_at(s);
        assert!(
            f.width_left > 0.0 && f.width_right > 0.0,
            "non-positive width at s={s}"
        );
        assert!(f.position.is_finite() && f.tangent.is_finite());
        assert!(
            track.is_within_limits(TrackCoord::new(s, 0.0)),
            "centreline is outside track limits at s={s}"
        );
        // コース幅の内側は必ず舗装
        assert_eq!(
            track.surface_at(TrackCoord::new(s, f.width_left * 0.9)),
            SurfaceKind::Asphalt
        );
        assert_eq!(
            track.surface_at(TrackCoord::new(s, -f.width_right * 0.9)),
            SurfaceKind::Asphalt
        );
    }
}

// ---------------------------------------------------------------------------
// エラー系
// ---------------------------------------------------------------------------

#[test]
fn rejects_unsupported_schema_version() {
    let def = tiny_definition();
    let json = track_to_json_string(&def, "").expect("serialize");
    let bumped = json.replace(
        &format!("\"schema_version\": {TRACK_SCHEMA_VERSION}"),
        &format!("\"schema_version\": {}", TRACK_SCHEMA_VERSION + 7),
    );
    assert_ne!(bumped, json, "schema_version field not found in output");
    match track_from_json_str(&bumped) {
        Err(TrackIoError::UnsupportedVersion { found, supported }) => {
            assert_eq!(found, TRACK_SCHEMA_VERSION + 7);
            assert_eq!(supported, TRACK_SCHEMA_VERSION);
        }
        other => panic!("expected UnsupportedVersion, got {other:?}"),
    }
}

#[test]
fn rejects_malformed_json() {
    match track_from_json_str("{ this is not json") {
        Err(TrackIoError::Parse(_)) => {}
        other => panic!("expected Parse, got {other:?}"),
    }
    // 型が違う場合も Parse
    match track_from_json_str(r#"{"schema_version": "one", "track": {}}"#) {
        Err(TrackIoError::Parse(_)) => {}
        other => panic!("expected Parse for wrong type, got {other:?}"),
    }
}

#[test]
fn rejects_invalid_track_data() {
    // 幅 0
    let mut def = tiny_definition();
    def.sections[3].width_left = 0.0;
    let json = track_to_json_string(&def, "").expect("serialize");
    match track_from_json_str(&json) {
        Err(TrackIoError::Invalid(_)) => {}
        other => panic!("expected Invalid for zero width, got {other:?}"),
    }

    // セクター境界が昇順でない
    let mut def = tiny_definition();
    def.sector_splits = vec![0.8, 0.2];
    let json = track_to_json_string(&def, "").expect("serialize");
    match track_from_json_str(&json) {
        Err(TrackIoError::Invalid(_)) => {}
        other => panic!("expected Invalid for unsorted sector splits, got {other:?}"),
    }

    // 断面数の不一致
    let mut def = tiny_definition();
    def.sections.pop();
    let json = track_to_json_string(&def, "").expect("serialize");
    match track_from_json_str(&json) {
        Err(TrackIoError::Invalid(_)) => {}
        other => panic!("expected Invalid for section count mismatch, got {other:?}"),
    }
}

#[test]
fn missing_optional_fields_use_defaults() {
    // sections の要素を空オブジェクトにしても Default が入ること。
    let json = r#"{
      "schema_version": 1,
      "track": {
        "name": "Defaults",
        "centerline": [
          {"x": 60.0, "y": 0.0, "z": 0.0},
          {"x": 0.0, "y": 0.0, "z": 60.0},
          {"x": -60.0, "y": 0.0, "z": 0.0},
          {"x": 0.0, "y": 0.0, "z": -60.0}
        ],
        "sections": [{}, {}, {}, {}],
        "closed": true,
        "sector_splits": [0.5],
        "start_finish": 0.0
      }
    }"#;
    let def = track_from_json_str(json).expect("defaults must be accepted");
    let d = CrossSection::default();
    for sec in &def.sections {
        assert_eq!(sec.width_left, d.width_left);
        assert_eq!(sec.width_right, d.width_right);
        assert_eq!(sec.banking, d.banking);
        assert_eq!(sec.camber, d.camber);
        assert_eq!(sec.kerb_left, d.kerb_left);
        assert_eq!(sec.kerb_right, d.kerb_right);
        assert_eq!(sec.runoff, d.runoff);
    }
    // description は省略可能
    assert!(track_from_json_str(json).is_ok());
}

#[test]
fn surface_kind_uses_snake_case_in_json() {
    let mut def = tiny_definition();
    def.sections[0].runoff = SurfaceKind::PitLane;
    let json = track_to_json_string(&def, "").expect("serialize");
    assert!(
        json.contains("\"pit_lane\""),
        "SurfaceKind must serialise as snake_case; got:\n{}",
        &json[..json.len().min(400)]
    );
    assert!(json.contains("\"grass\"") || json.contains("\"gravel\""));
}

#[test]
fn missing_file_reports_io_error() {
    match sim_track::track_from_json_file("does/not/exist.track.json") {
        Err(TrackIoError::Io(_)) => {}
        other => panic!("expected Io error, got {other:?}"),
    }
}
