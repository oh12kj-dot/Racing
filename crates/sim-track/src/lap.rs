//! ラップ跨ぎ検出（純粋関数）。
//!
//! ラップ *カウント* の意味付けは `sim-race` の責務である。
//! ここでは幾何的な **跨ぎ検出プリミティブ** のみを提供する。

use crate::track::Track;

/// スタート/フィニッシュラインの跨ぎ判定結果。
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
pub fn detect_lap_crossing(track: &Track, prev_s: f64, new_s: f64, max_ds: f64) -> LapCrossing {
    let delta = track.signed_delta_s(prev_s, new_s);
    if delta.abs() > max_ds {
        return LapCrossing::Suspect;
    }

    let sf = track.start_finish_s();
    // `sf` からの符号付き相対位置。ラインをまだ越えていなければ負、越えていれば非負。
    let rel_prev = track.signed_delta_s(sf, prev_s);
    // 短い移動 `delta` の範囲では、ラップ境界での折り返しを考慮しない
    // 「巻き戻しなしの」相対位置として `rel_prev + delta` が使える。
    let raw = rel_prev + delta;

    if rel_prev < 0.0 && raw >= 0.0 {
        LapCrossing::Forward
    } else if rel_prev > 0.0 && raw <= 0.0 {
        LapCrossing::Backward
    } else {
        LapCrossing::None
    }
}
