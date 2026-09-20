//! `Vec2` / `Vec3` / `Quat` の検証。

use approx::assert_relative_eq;
use sim_math::util::wrap_angle;
use sim_math::{Quat, Vec2, Vec3};

const TOL: f64 = 1e-12;

#[test]
fn vec_ops() {
    let a = Vec3::new(1.0, 2.0, 3.0);
    let b = Vec3::new(-4.0, 5.0, 6.0);

    assert_eq!(a + b, Vec3::new(-3.0, 7.0, 9.0));
    assert_eq!(a - b, Vec3::new(5.0, -3.0, -3.0));
    assert_eq!(a * 2.0, Vec3::new(2.0, 4.0, 6.0));
    assert_eq!(2.0 * a, Vec3::new(2.0, 4.0, 6.0));
    assert_eq!(a / 2.0, Vec3::new(0.5, 1.0, 1.5));
    assert_eq!(-a, Vec3::new(-1.0, -2.0, -3.0));

    assert_relative_eq!(a.dot(b), -4.0 + 10.0 + 18.0, epsilon = TOL);
    // 既知値: (1,2,3) x (-4,5,6) = (2*6-3*5, 3*(-4)-1*6, 1*5-2*(-4)) = (-3, -18, 13)
    assert_eq!(a.cross(b), Vec3::new(-3.0, -18.0, 13.0));

    assert_relative_eq!(Vec3::new(3.0, 4.0, 0.0).length(), 5.0, epsilon = TOL);
    assert_relative_eq!(
        Vec3::new(3.0, 4.0, 0.0).length_squared(),
        25.0,
        epsilon = TOL
    );

    // 右手系の確認: X x Y = Z
    assert_eq!(Vec3::X.cross(Vec3::Y), Vec3::Z);

    let mut m = a;
    m += b;
    assert_eq!(m, a + b);
    m -= b;
    assert_eq!(m, a);
    m *= 3.0;
    assert_eq!(m, a * 3.0);
    m /= 3.0;
    assert_relative_eq!(m.x, a.x, epsilon = TOL);
}

#[test]
fn vec_normalize_zero_length() {
    assert_eq!(Vec3::ZERO.normalize(), Vec3::ZERO);
    assert_eq!(Vec3::ZERO.try_normalize(), None);
    assert_eq!(Vec2::ZERO.normalize(), Vec2::ZERO);
    assert_eq!(Vec2::ZERO.try_normalize(), None);

    let n = Vec3::new(0.0, 0.0, 7.0).try_normalize().expect("non-zero");
    assert_relative_eq!(n.length(), 1.0, epsilon = TOL);
    assert_eq!(n, Vec3::Z);

    // ゼロ長に対する射影は破綻せずゼロを返す。
    assert_eq!(Vec3::X.project_onto(Vec3::ZERO), Vec3::ZERO);
    assert_eq!(Vec3::X.angle_between(Vec3::ZERO), 0.0);
}

#[test]
fn vec_projection_and_angles() {
    let v = Vec3::new(3.0, 4.0, 0.0);
    let onto = Vec3::X;
    assert_eq!(v.project_onto(onto), Vec3::new(3.0, 0.0, 0.0));
    assert_eq!(v.reject_from(onto), Vec3::new(0.0, 4.0, 0.0));
    assert_relative_eq!(
        Vec3::X.angle_between(Vec3::Y),
        std::f64::consts::FRAC_PI_2,
        epsilon = 1e-12
    );

    // Vec2 の符号付き角度
    assert_relative_eq!(
        Vec2::X.signed_angle_to(Vec2::Y),
        std::f64::consts::FRAC_PI_2,
        epsilon = 1e-12
    );
    assert_relative_eq!(
        Vec2::Y.signed_angle_to(Vec2::X),
        -std::f64::consts::FRAC_PI_2,
        epsilon = 1e-12
    );
    assert_relative_eq!(Vec2::X.perp_dot(Vec2::Y), 1.0, epsilon = TOL);
}

#[test]
fn vec_xz_projection() {
    let v = Vec3::new(1.0, 99.0, 2.0);
    assert_eq!(v.xz(), Vec2::new(1.0, 2.0));
    assert_eq!(v.horizontal(), Vec3::new(1.0, 0.0, 2.0));
    assert_eq!(Vec2::new(1.0, 2.0).to_xz(), Vec3::new(1.0, 0.0, 2.0));
}

#[test]
fn vec_is_finite() {
    assert!(Vec3::new(1.0, 2.0, 3.0).is_finite());
    assert!(!Vec3::new(f64::NAN, 0.0, 0.0).is_finite());
    assert!(!Vec3::new(0.0, f64::INFINITY, 0.0).is_finite());
    assert!(!Vec2::new(f64::NAN, 0.0).is_finite());
}

#[test]
fn quat_roundtrip() {
    // ジンバルロック外（|pitch| < 1.4 rad）でオイラー角が往復すること。
    let samples = [
        (0.0, 0.0, 0.0),
        (0.3, -0.2, 0.15),
        (1.7, 0.9, -1.1),
        (-2.9, -1.35, 2.7),
        (3.0, 0.05, -3.0),
    ];
    for &(yaw, pitch, roll) in &samples {
        let q = Quat::from_euler_yxz(yaw, pitch, roll);
        let (y2, p2, r2) = q.to_euler_yxz();
        assert!(
            wrap_angle(y2 - yaw).abs() < 1e-9,
            "yaw mismatch: {yaw} -> {y2}"
        );
        assert!(
            wrap_angle(p2 - pitch).abs() < 1e-9,
            "pitch mismatch: {pitch} -> {p2}"
        );
        assert!(
            wrap_angle(r2 - roll).abs() < 1e-9,
            "roll mismatch: {roll} -> {r2}"
        );
    }
}

#[test]
fn quat_gimbal_lock_is_clamped() {
    // pitch = ±PI/2 で roll を 0 に固定し、NaN を出さないこと。
    for &pitch in &[std::f64::consts::FRAC_PI_2, -std::f64::consts::FRAC_PI_2] {
        let q = Quat::from_euler_yxz(0.7, pitch, 0.4);
        let (y, p, r) = q.to_euler_yxz();
        assert!(y.is_finite() && p.is_finite() && r.is_finite());
        assert_relative_eq!(r, 0.0, epsilon = 1e-12);
        assert_relative_eq!(p.abs(), std::f64::consts::FRAC_PI_2, epsilon = 1e-7);
        // 姿勢そのものは保存されていること。
        let back = Quat::from_euler_yxz(y, p, r);
        let v = Vec3::new(1.0, 0.3, -0.7);
        let a = q.rotate_vec3(v);
        let b = back.rotate_vec3(v);
        assert_relative_eq!(a.x, b.x, epsilon = 1e-9);
        assert_relative_eq!(a.y, b.y, epsilon = 1e-9);
        assert_relative_eq!(a.z, b.z, epsilon = 1e-9);
    }
}

#[test]
fn quat_rotate() {
    // Y 軸まわり +90 度: +X -> -Z（右手系）
    let q = Quat::from_axis_angle(Vec3::Y, std::f64::consts::FRAC_PI_2);
    let r = q.rotate_vec3(Vec3::X);
    assert_relative_eq!(r.x, 0.0, epsilon = 1e-12);
    assert_relative_eq!(r.y, 0.0, epsilon = 1e-12);
    assert_relative_eq!(r.z, -1.0, epsilon = 1e-12);

    // 恒等回転
    assert_eq!(
        Quat::IDENTITY.rotate_vec3(Vec3::new(1.0, 2.0, 3.0)),
        Vec3::new(1.0, 2.0, 3.0)
    );

    // ゼロ長軸は恒等回転
    assert_eq!(Quat::from_axis_angle(Vec3::ZERO, 1.0), Quat::IDENTITY);
}

#[test]
fn quat_mat3_matches_rotate_vec3() {
    let q = Quat::from_euler_yxz(0.6, -0.4, 1.1);
    let m = q.to_mat3();
    for v in [Vec3::X, Vec3::Y, Vec3::Z, Vec3::new(1.0, -2.0, 0.5)] {
        let by_quat = q.rotate_vec3(v);
        let by_mat = Vec3::new(
            m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
            m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
            m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
        );
        assert_relative_eq!(by_quat.x, by_mat.x, epsilon = 1e-12);
        assert_relative_eq!(by_quat.y, by_mat.y, epsilon = 1e-12);
        assert_relative_eq!(by_quat.z, by_mat.z, epsilon = 1e-12);
    }
}

#[test]
fn quat_inverse_and_normalize() {
    let q = Quat::from_euler_yxz(0.6, -0.4, 1.1);
    let i = q * q.inverse();
    assert_relative_eq!(i.w.abs(), 1.0, epsilon = 1e-12);
    assert_relative_eq!(Vec3::new(i.x, i.y, i.z).length(), 0.0, epsilon = 1e-12);

    // ノルムがゼロに近い場合は恒等回転へ縮退する（NaN を出さない）。
    let degenerate = Quat::new(0.0, 0.0, 0.0, 0.0);
    assert_eq!(degenerate.normalize(), Quat::IDENTITY);
    assert_eq!(degenerate.inverse(), Quat::IDENTITY);
}

#[test]
fn quat_slerp_endpoints_and_shortest_path() {
    let a = Quat::from_axis_angle(Vec3::Y, 0.0);
    let b = Quat::from_axis_angle(Vec3::Y, 1.2);

    let s0 = a.slerp(b, 0.0);
    assert_relative_eq!(s0.dot(a).abs(), 1.0, epsilon = 1e-12);
    let s1 = a.slerp(b, 1.0);
    assert_relative_eq!(s1.dot(b).abs(), 1.0, epsilon = 1e-12);

    // 中点は角度の中点
    let mid = a.slerp(b, 0.5);
    let expected = Quat::from_axis_angle(Vec3::Y, 0.6);
    assert_relative_eq!(mid.dot(expected).abs(), 1.0, epsilon = 1e-9);

    // 反対符号でも最短経路を通る（内積の符号を揃える）
    let c = Quat::new(-b.x, -b.y, -b.z, -b.w);
    let mid2 = a.slerp(c, 0.5);
    assert_relative_eq!(mid2.dot(expected).abs(), 1.0, epsilon = 1e-9);

    // ほぼ同一の回転でも NaN にならない
    let near = Quat::from_axis_angle(Vec3::Y, 1e-12);
    let m = a.slerp(near, 0.5);
    assert!(m.is_finite());
}

#[test]
fn quat_composition_order() {
    // (a * b) は「b を適用してから a を適用する」回転でなければならない。
    // 姿勢合成の順序を取り違えると車両のロール/ピッチが入れ替わるため、
    // ここを明示的に固定しておく。
    let a = Quat::from_axis_angle(Vec3::Y, 0.7);
    let b = Quat::from_axis_angle(Vec3::X, -0.4);
    let v = Vec3::new(1.0, 2.0, -3.0);

    let composed = (a * b).rotate_vec3(v);
    let sequential = a.rotate_vec3(b.rotate_vec3(v));
    assert_relative_eq!(composed.x, sequential.x, epsilon = 1e-12);
    assert_relative_eq!(composed.y, sequential.y, epsilon = 1e-12);
    assert_relative_eq!(composed.z, sequential.z, epsilon = 1e-12);

    // 演算子 * によるベクトル回転は rotate_vec3 と等価
    let by_op = a * v;
    let by_fn = a.rotate_vec3(v);
    assert_relative_eq!(by_op.x, by_fn.x, epsilon = 1e-15);
    assert_relative_eq!(by_op.z, by_fn.z, epsilon = 1e-15);

    // YXZ 規約: from_euler_yxz(y,p,r) == Ry(y) * Rx(p) * Rz(r)
    let (y, p, r) = (0.3, -0.5, 0.8);
    let built = Quat::from_axis_angle(Vec3::Y, y)
        * Quat::from_axis_angle(Vec3::X, p)
        * Quat::from_axis_angle(Vec3::Z, r);
    let direct = Quat::from_euler_yxz(y, p, r);
    assert_relative_eq!(built.dot(direct).abs(), 1.0, epsilon = 1e-12);
}
