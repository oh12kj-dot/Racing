#!/usr/bin/env python3
"""小半径コーナーの制御点を詰め直し、曲率リップルを取り除く（TASK-1A-5）。

## なぜ必要か

centripetal Catmull-Rom は円弧を厳密には再現しない。逸脱はおおむね
`(chord / R)^2` に比例するため、小半径コーナーで制御点が疎だと、
曲率が**制御点間隔と同じ周期で振動する**。

Aoyama Ring のヘアピン（R=19 m, chord/R=0.52）では曲率が周期 10.5 m で
±13% 振動していた。Phase 2 の Speed Profile は曲率から限界速度を出すため、
これは偽のスロットル／ブレーキ脈動になる。

## 何をするか

このトラックのコーナーは**厳密な円弧**の上に制御点が置かれている
（最小二乗の円フィット残差 <= 0.5 mm = JSON の mm 丸めそのもの）。
したがって「同じ円の上に、より詰めて置き直す」ことで、
**設計形状を一切変えずに**リップルだけを消せる。

1. 制御点の Menger 曲率からコーナー区間を検出する
2. 円をフィットして半径と中心を復元する
3. `chord / R > TARGET_CHORD_RATIO` のコーナーだけ、同じ円の上で再分割する
4. 隣接する直線側の点を再配置して、間隔比が `MAX_SPACING_RATIO` 以下になるよう
   なだらかに繋ぐ（**密度の急変はそれ自体が偽の曲率スパイクを生む**）
5. 標高は元の値を Catmull-Rom 補間、断面は線形補間、`runoff` は最近傍で引き継ぐ

形状を変えないため、区間が直線であることを確認してから再配置する。
直線でなければ中断する（黙って歪めない）。

## 使い方

    python tools/tracks/densify_corners.py \\
        --track assets/tracks/aoyama_ring.track.json [--dry-run]

検証は `cargo test --release -p sim-track --test io` で行う。
"""
from __future__ import annotations

import argparse
import json
import math
import sys

# 目標とする chord / R。逸脱が (chord/R)^2 に比例するため、
# 0.52 -> 0.25 でリップルはおよそ 1/4.3 になる。
TARGET_CHORD_RATIO = 0.25
# 隣接する制御点間隔の比の上限。
MAX_SPACING_RATIO = 1.5
# コーナーとみなす曲率の下限（R < 300 m）。
CORNER_MAX_RADIUS_M = 300.0
# 直線とみなす、端点を結ぶ直線からの最大ずれ [m]。
# アセットは mm 丸めなので、1 mm を許容すれば「設計上の直線」を拾える。
STRAIGHT_MAX_DEVIATION_M = 0.001
# 出力の丸め桁数。元のアセットと揃える（mm）。
ROUND_DIGITS = 3

SECTION_NUMERIC = ("width_left", "width_right", "banking", "camber", "kerb_left", "kerb_right")


# ---------------------------------------------------------------------------
# 幾何
# ---------------------------------------------------------------------------

def menger_xz(a, b, c):
    """XZ 平面での符号付き曲率。制御点そのものの幾何を測る（スプラインを介さない）。"""
    ab = math.hypot(b[0] - a[0], b[2] - a[2])
    bc = math.hypot(c[0] - b[0], c[2] - b[2])
    ca = math.hypot(a[0] - c[0], a[2] - c[2])
    if ab * bc * ca == 0.0:
        return 0.0
    cross = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])
    return 2.0 * cross / (ab * bc * ca)


def fit_circle_xz(sub):
    """Kasa 法の最小二乗円フィット。戻り値 (cx, cz, R, max_residual)。"""
    m = len(sub)
    sx = sz = sxx = szz = sxz = sxxx = szzz = sxzz = szxx = 0.0
    for p in sub:
        x, z = p[0], p[2]
        sx += x
        sz += z
        sxx += x * x
        szz += z * z
        sxz += x * z
        sxxx += x * x * x
        szzz += z * z * z
        sxzz += x * z * z
        szxx += z * x * x
    a11 = 2.0 * (sx * sx / m - sxx)
    a12 = 2.0 * (sx * sz / m - sxz)
    a22 = 2.0 * (sz * sz / m - szz)
    b1 = sx * (sxx + szz) / m - (sxxx + sxzz)
    b2 = sz * (sxx + szz) / m - (szzz + szxx)
    det = a11 * a22 - a12 * a12
    if abs(det) < 1e-12:
        return None
    cx = (b1 * a22 - b2 * a12) / det
    cz = (a11 * b2 - a12 * b1) / det
    r = sum(math.hypot(p[0] - cx, p[2] - cz) for p in sub) / m
    resid = max(abs(math.hypot(p[0] - cx, p[2] - cz) - r) for p in sub)
    return cx, cz, r, resid


def dist_xz(a, b):
    return math.hypot(b[0] - a[0], b[2] - a[2])


# ---------------------------------------------------------------------------
# 補間
# ---------------------------------------------------------------------------

def catmull_rom_scalar(knots, values, t):
    """非一様 Catmull-Rom によるスカラー補間。`knots` は狭義単調増加。

    標高に使う。線形補間だと元の制御点ごとに勾配の折れが入り、
    3D 曲率に細かい折れとして現れるため。
    """
    n = len(knots)
    if t <= knots[0]:
        return values[0]
    if t >= knots[-1]:
        return values[-1]
    i = 0
    while i < n - 2 and knots[i + 1] < t:
        i += 1
    t0, t1 = knots[i], knots[i + 1]
    h = t1 - t0
    u = (t - t0) / h
    y0, y1 = values[i], values[i + 1]
    # 端点では片側差分に落とす
    m0 = ((values[i + 1] - values[i - 1]) / (knots[i + 1] - knots[i - 1])) if i > 0 \
        else (y1 - y0) / h
    m1 = ((values[i + 2] - values[i]) / (knots[i + 2] - knots[i])) if i + 2 < n \
        else (y1 - y0) / h
    m0 *= h
    m1 *= h
    u2, u3 = u * u, u * u * u
    return ((2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * m0
            + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * m1)


def lerp(a, b, f):
    return a + (b - a) * f


def section_at(sections, cum, t):
    """元の累積距離 `t` における断面。数値は線形、`runoff` は最近傍。"""
    n = len(sections)
    if t <= cum[0]:
        return dict(sections[0])
    if t >= cum[-1]:
        return dict(sections[-1])
    i = 0
    while i < n - 2 and cum[i + 1] < t:
        i += 1
    f = (t - cum[i]) / (cum[i + 1] - cum[i])
    a, b = sections[i], sections[i + 1]
    out = {k: lerp(a[k], b[k], f) for k in SECTION_NUMERIC}
    out["runoff"] = a["runoff"] if f < 0.5 else b["runoff"]
    return out


# ---------------------------------------------------------------------------
# 間隔のランプ
# ---------------------------------------------------------------------------

def solve_ramp(d0, total, ratio_max):
    """`d0` から始めて比 r の等比で伸びる間隔列を作り、合計を `total` に一致させる。

    `sum_{i=1..m} d0 * r^i = total` を満たす最小の `m`（ただし `r <= ratio_max`）を返す。
    見つからなければ None。
    """
    for m in range(1, 40):
        lo, hi = 1e-9, 10.0
        for _ in range(200):
            mid = 0.5 * (lo + hi)
            val = d0 * sum(mid ** i for i in range(1, m + 1))
            if val < total:
                lo = mid
            else:
                hi = mid
        r = 0.5 * (lo + hi)
        if r <= ratio_max:
            if r < 1.0 / ratio_max:
                return None
            return [d0 * r ** i for i in range(1, m + 1)], r
    return None


# ---------------------------------------------------------------------------
# 本体
# ---------------------------------------------------------------------------

def find_corner_runs(pts):
    """制御点の Menger 曲率から、コーナーの索引列を返す。"""
    n = len(pts)
    curv = [menger_xz(pts[(i - 1) % n], pts[i], pts[(i + 1) % n]) for i in range(n)]
    inside = [abs(k) * CORNER_MAX_RADIUS_M > 1.0 for k in curv]
    runs = []
    for i in range(n):
        if not inside[i] or inside[(i - 1) % n]:
            continue
        idx, j = [], i
        while inside[j % n] and len(idx) < n:
            idx.append(j % n)
            j += 1
        if len(idx) >= 4:
            runs.append(idx)
    return runs


def densify(data, verbose=True):
    track = data["track"]
    pts = [(p["x"], p["y"], p["z"]) for p in track["centerline"]]
    sections = track["sections"]
    n = len(pts)
    if len(sections) != n:
        raise SystemExit("centerline と sections の要素数が一致しない")

    # 元の累積距離。標高・断面の引き継ぎはこの座標で行う。
    cum = [0.0]
    for i in range(n):
        cum.append(cum[-1] + dist_xz(pts[i], pts[(i + 1) % n]))
    total_len = cum[-1]
    cum_pt = cum[:n]  # 各制御点の累積距離
    ys = [p[1] for p in pts]

    def y_at(t):
        # ラップを跨ぐ補間のため、前後に 3 点ずつ広げた窓で評価する
        i = 0
        while i < n - 1 and cum_pt[i + 1] < t:
            i += 1
        lo, hi = i - 3, i + 4
        knots = [cum_pt[j % n] + (total_len if j >= n else (-total_len if j < 0 else 0.0))
                 for j in range(lo, hi)]
        vals = [ys[j % n] for j in range(lo, hi)]
        return catmull_rom_scalar(knots, vals, t)

    runs = find_corner_runs(pts)

    # 詰め直すコーナーを選ぶ
    targets = []
    for idx in runs:
        sub = [pts[k] for k in idx]
        fit = fit_circle_xz(sub)
        if fit is None:
            continue
        cx, cz, r, resid = fit
        chord = max(dist_xz(pts[idx[k]], pts[idx[k + 1]]) for k in range(len(idx) - 1))
        ratio = chord / r
        if verbose:
            print(f"  corner idx {idx[0]:>3}-{idx[-1]:<3} R={r:8.2f} resid={resid:.4f} "
                  f"chord={chord:5.2f} chord/R={ratio:.3f}"
                  + ("   -> densify" if ratio > TARGET_CHORD_RATIO else ""))
        if ratio > TARGET_CHORD_RATIO:
            if resid > 0.01:
                raise SystemExit(
                    f"corner idx {idx[0]}-{idx[-1]} は円弧ではない（残差 {resid:.4f} m）。"
                    " 円の上に置き直す前提が崩れるため中断する")
            targets.append((idx, cx, cz, r))

    if not targets:
        print("詰め直しが必要なコーナーはない")
        return None

    # 索引 -> 新しい点、の置換表を作る。
    # 各 target について「弧の内部」と「両隣のランプ区間」の点を差し替える。
    replacements = {}  # 元の索引 -> None（削除） / 温存は登録しない
    inserts = {}       # 「元の索引 i の直後に挿入する新点のリスト」

    def collinear(junction, end, direction):
        """`junction` から `end` までの制御点が XZ で一直線に乗っているか。

        弧の端点そのものは Menger 曲率が 0 にならない（片側の隣が弧の上にあるため）。
        そこで曲率ではなく、**端点を結ぶ直線からの垂直距離**で判定する。
        これが直線なら、その上で点を打ち直しても形状は一切変わらない。
        """
        p0, p1 = pts[junction % n], pts[end % n]
        dx, dz = p1[0] - p0[0], p1[2] - p0[2]
        norm = math.hypot(dx, dz)
        if norm < 1e-9:
            return False
        j = junction
        while j % n != end % n:
            j += direction
            q = pts[j % n]
            # 外積 / 長さ = 直線からの垂直距離
            dev = abs((q[0] - p0[0]) * dz - (q[2] - p0[2]) * dx) / norm
            if dev > STRAIGHT_MAX_DEVIATION_M:
                return False
        return True

    for idx, cx, cz, r in targets:
        a, b = idx[0], idx[-1]           # 弧の端点（温存する）
        pa, pb = pts[a], pts[b]
        ang_a = math.atan2(pa[2] - cz, pa[0] - cx)
        ang_b = math.atan2(pb[2] - cz, pb[0] - cx)
        sweep = (ang_b - ang_a + math.pi) % (2 * math.pi) - math.pi
        if abs(sweep) < 1e-9:
            continue
        # chord/R <= TARGET を満たす最小の分割数
        q = len(idx) - 1
        while 2.0 * math.sin(abs(sweep) / (2 * q)) > TARGET_CHORD_RATIO:
            q += 1
        new_chord = 2.0 * r * math.sin(abs(sweep) / (2 * q))

        # 弧の内部点を差し替える
        for k in idx[1:-1]:
            replacements[k] = None
        arc_new = []
        span = cum_pt[b] - cum_pt[a]
        if span < 0:
            span += total_len
        for j in range(1, q):
            f = j / q
            ang = ang_a + sweep * f
            x = cx + r * math.cos(ang)
            z = cz + r * math.sin(ang)
            t = cum_pt[a] + span * f
            arc_new.append((x, y_at(t % total_len), z, t % total_len))
        inserts[a] = arc_new

        if verbose:
            print(f"  -> R={r:.2f}: {len(idx) - 1} 分割 -> {q} 分割 "
                  f"(chord {dist_xz(pts[idx[0]], pts[idx[1]]):.2f} -> {new_chord:.2f} m, "
                  f"chord/R {new_chord / r:.3f})")

        # 両隣の直線にランプを作る
        for direction in (+1, -1):
            junction = b if direction > 0 else a
            made = False
            for window in range(2, 8):
                end = junction + direction * window
                if not collinear(junction, end, direction):
                    break
                seg_total = 0.0
                jj = junction
                for _ in range(window):
                    nxt = jj + direction
                    seg_total += dist_xz(pts[jj % n], pts[nxt % n])
                    jj = nxt
                solved = solve_ramp(new_chord, seg_total, MAX_SPACING_RATIO)
                if solved is None:
                    continue
                spacings, ratio = solved
                # 窓の外側の元の間隔との比も見る
                outer_from = end
                outer_to = end + direction
                outer = dist_xz(pts[outer_from % n], pts[outer_to % n])
                if not (1.0 / MAX_SPACING_RATIO <= spacings[-1] / outer <= MAX_SPACING_RATIO):
                    continue
                # 窓の内部の元の点を削除し、ランプ点を挿入する
                jj = junction
                for _ in range(window - 1):
                    jj += direction
                    replacements[jj % n] = None
                acc = 0.0
                ramp_pts = []
                for d in spacings[:-1]:
                    acc += d
                    f = acc / seg_total
                    # 直線区間なので端点の線形補間で厳密に元の経路上に乗る
                    p0, p1 = pts[junction % n], pts[end % n]
                    x = lerp(p0[0], p1[0], f)
                    z = lerp(p0[2], p1[2], f)
                    t0, t1 = cum_pt[junction % n], cum_pt[junction % n] + direction * seg_total
                    t = (t0 + (t1 - t0) * f) % total_len
                    ramp_pts.append((x, y_at(t), z, t))
                if direction < 0:
                    ramp_pts.reverse()
                    inserts[end % n] = ramp_pts
                else:
                    inserts[junction % n] = ramp_pts
                if verbose:
                    side = "exit " if direction > 0 else "entry"
                    print(f"     {side} ramp: window {window} seg ({seg_total:.2f} m) "
                          f"-> {len(spacings)} spacings, r={ratio:.3f}, "
                          f"{', '.join(f'{d:.2f}' for d in spacings)}")
                made = True
                break
            if not made:
                raise SystemExit(
                    f"idx {junction} 側でランプを作れなかった。"
                    " 直線が短いか、間隔比の制約が厳しすぎる")

    # 新しい列を組み立てる
    out_pts, out_sec = [], []
    for i in range(n):
        if i not in replacements:
            out_pts.append(pts[i])
            out_sec.append(dict(sections[i]))
        for extra in inserts.get(i, []):
            x, y, z, t = extra
            out_pts.append((x, y, z))
            out_sec.append(section_at(sections, cum_pt, t))

    track["centerline"] = [
        {"x": round(p[0], ROUND_DIGITS),
         "y": round(p[1], ROUND_DIGITS),
         "z": round(p[2], ROUND_DIGITS)}
        for p in out_pts
    ]
    track["sections"] = [
        {**{k: round(s[k], 4) for k in SECTION_NUMERIC}, "runoff": s["runoff"]}
        for s in out_sec
    ]
    return len(out_pts)


def report(data):
    pts = [(p["x"], p["y"], p["z"]) for p in data["track"]["centerline"]]
    n = len(pts)
    sp = [dist_xz(pts[i], pts[(i + 1) % n]) for i in range(n)]
    ratios = [max(sp[i], sp[(i + 1) % n]) / min(sp[i], sp[(i + 1) % n]) for i in range(n)]
    worst = 0.0
    for idx in find_corner_runs(pts):
        fit = fit_circle_xz([pts[k] for k in idx])
        if fit is None:
            continue
        chord = max(dist_xz(pts[idx[k]], pts[idx[k + 1]]) for k in range(len(idx) - 1))
        worst = max(worst, chord / fit[2])
    print(f"control points: {n}   spacing {min(sp):.2f}..{max(sp):.2f} m   "
          f"max adjacent ratio {max(ratios):.3f}   max chord/R {worst:.3f}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--track", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(args.track, encoding="utf-8") as f:
        data = json.load(f)

    print("before:")
    report(data)
    print("corners:")
    count = densify(data)
    if count is None:
        return 0
    print("after:")
    report(data)

    if args.dry_run:
        print("(dry run: 書き込みなし)")
        return 0

    with open(args.track, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"wrote {args.track}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
