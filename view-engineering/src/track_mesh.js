// track_mesh.js — WasmTrack が返す幾何を Three.js のオブジェクトへ変換する。
//
// この層は計測器の「描画」担当であり、幾何の唯一の正は sim-track にある。
// ここで独自に曲率やバンクを計算し直してはならない。すべて WASM から読む。

import * as THREE from 'three';

/// サンプリング間隔 [m]。1 m は 4 km トラックで約 4 140 ステーション。
export const STEP_M = 1.0;

/// バンク区間とみなす閾値 [rad]。
const BANKING_THRESHOLD_RAD = 0.02;

/// 距離目盛りの間隔 [m] と、ラベルを付ける間隔 [m]。
const TICK_INTERVAL_M = 100.0;
const LABEL_INTERVAL_M = 500.0;

/**
 * WASM から一括でサンプリングし、以降の描画とホバー表示が共有する配列を作る。
 *
 * ステーションの定義は sim-wasm の規約に従う:
 *   n = curvature.length - 1 セグメント、s_i = i * L / n
 */
export function sampleTrack(track, step = STEP_M) {
  const surface = track.sample_surface(step);
  const curvature = track.sample_curvature(step);
  const banking = track.sample_banking(step);
  const center = track.sample_line(0.0, step);
  const left = track.sample_line(1.0, step);
  const right = track.sample_line(-1.0, step);

  const stationCount = curvature.length;
  if (stationCount < 2 || surface.length !== stationCount * 6) {
    throw new Error(
      `sampling mismatch: stations=${stationCount} surface=${surface.length}`
    );
  }

  const length = track.length();
  const segments = stationCount - 1;
  const stationS = new Float64Array(stationCount);
  const width = new Float64Array(stationCount);
  const elevation = new Float64Array(stationCount);

  for (let i = 0; i < stationCount; i += 1) {
    stationS[i] = (i * length) / segments;
    elevation[i] = center[i * 3 + 1];
    const dx = left[i * 3] - right[i * 3];
    const dy = left[i * 3 + 1] - right[i * 3 + 1];
    const dz = left[i * 3 + 2] - right[i * 3 + 2];
    width[i] = Math.hypot(dx, dy, dz);
  }

  return {
    length,
    step: length / segments,
    stationCount,
    stationS,
    surface,
    curvature,
    banking,
    center,
    left,
    right,
    width,
    elevation,
    sectorBoundaries: Array.from(track.sector_boundaries()),
    startFinishS: track.start_finish_s(),
    name: track.name(),
  };
}

// --------------------------------------------------------------------------
// カラーマップ
// --------------------------------------------------------------------------

/**
 * 発散カラーマップ。負 = 青 / 0 = 灰 / 正 = 赤。
 *
 * `signed sqrt` で正規化する。曲率は最小半径（ヘアピン）が支配的で、
 * 線形正規化にすると緩いコーナーがすべて灰色に潰れて
 * スパイクや不連続を目視できなくなる。sqrt は 0 付近の勾配を立てるため、
 * 微小な曲率の跳ねほど見つけやすくなる。凡例には実際の値を表示する。
 */
function diverging(value, maxAbs) {
  if (!(maxAbs > 0)) return [0.6, 0.6, 0.6];
  const x = Math.sign(value) * Math.sqrt(Math.min(Math.abs(value) / maxAbs, 1.0));
  const mid = [0.82, 0.82, 0.82];
  const pos = [0.90, 0.18, 0.14]; // 左カーブ / 正のバンク
  const neg = [0.14, 0.42, 0.92]; // 右カーブ / 負のバンク
  const end = x >= 0 ? pos : neg;
  const a = Math.abs(x);
  return [
    mid[0] + (end[0] - mid[0]) * a,
    mid[1] + (end[1] - mid[1]) * a,
    mid[2] + (end[2] - mid[2]) * a,
  ];
}

/// 連続カラーマップ（低 = 濃紺 -> 高 = 黄）。標高用。
const SEQUENTIAL_STOPS = [
  [0.27, 0.00, 0.33],
  [0.21, 0.36, 0.55],
  [0.13, 0.57, 0.55],
  [0.37, 0.79, 0.38],
  [0.99, 0.91, 0.15],
];

function sequential(value, min, max) {
  const span = max - min;
  const u = span > 0 ? Math.min(Math.max((value - min) / span, 0), 1) : 0.5;
  const scaled = u * (SEQUENTIAL_STOPS.length - 1);
  const i = Math.min(Math.floor(scaled), SEQUENTIAL_STOPS.length - 2);
  const f = scaled - i;
  const a = SEQUENTIAL_STOPS[i];
  const b = SEQUENTIAL_STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/**
 * 着色モードごとの頂点カラーと凡例情報を作る。
 * 左右の頂点は同じステーションの値で着色する。
 */
export function computeColors(data, mode) {
  const n = data.stationCount;
  const colors = new Float32Array(n * 2 * 3);
  let legend;

  if (mode === 'elevation') {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i += 1) {
      if (data.elevation[i] < min) min = data.elevation[i];
      if (data.elevation[i] > max) max = data.elevation[i];
    }
    for (let i = 0; i < n; i += 1) {
      const c = sequential(data.elevation[i], min, max);
      writeStationColor(colors, i, c);
    }
    legend = { kind: 'sequential', min, max, unit: 'm', label: '標高' };
  } else {
    const source = mode === 'banking' ? data.banking : data.curvature;
    let maxAbs = 0;
    for (let i = 0; i < n; i += 1) {
      const a = Math.abs(source[i]);
      if (a > maxAbs) maxAbs = a;
    }
    for (let i = 0; i < n; i += 1) {
      writeStationColor(colors, i, diverging(source[i], maxAbs));
    }
    legend =
      mode === 'banking'
        ? { kind: 'diverging', maxAbs, unit: 'rad', label: 'バンク角' }
        : { kind: 'diverging', maxAbs, unit: '1/m', label: '曲率' };
  }

  return { colors, legend };
}

function writeStationColor(colors, i, c) {
  const base = i * 6;
  colors[base] = c[0];
  colors[base + 1] = c[1];
  colors[base + 2] = c[2];
  colors[base + 3] = c[0];
  colors[base + 4] = c[1];
  colors[base + 5] = c[2];
}

// --------------------------------------------------------------------------
// メッシュ生成
// --------------------------------------------------------------------------

/**
 * 路面ポリゴン。三角形ストリップを索引付きジオメトリへ展開する。
 *
 * ライティングを使わない（MeshBasicMaterial）。計測器では
 * 「表示された色 = データの値」でなければならず、陰影が乗ると
 * カラーマップを読み違える。
 */
export function buildSurface(data, mode) {
  const n = data.stationCount;
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < positions.length; i += 1) positions[i] = data.surface[i];

  // station i: 2i = 左端, 2i+1 = 右端。巻き方向は法線が +up になる向き。
  const indices = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n - 1; i += 1) {
    const l0 = 2 * i;
    const r0 = 2 * i + 1;
    const l1 = 2 * i + 2;
    const r1 = 2 * i + 3;
    const o = i * 6;
    indices[o] = l0;
    indices[o + 1] = r0;
    indices[o + 2] = l1;
    indices[o + 3] = r0;
    indices[o + 4] = r1;
    indices[o + 5] = l1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const { colors, legend } = computeColors(data, mode);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'surface';
  return { mesh, legend };
}

/// 着色モードを差し替える。ジオメトリは作り直さない。
export function recolorSurface(mesh, data, mode) {
  const { colors, legend } = computeColors(data, mode);
  mesh.geometry.getAttribute('color').array.set(colors);
  mesh.geometry.getAttribute('color').needsUpdate = true;
  return legend;
}

/// 平坦な `[x,y,z,...]` から閉じた線を作る。
export function buildLoop(flat, color, yOffset = 0.0) {
  const count = flat.length / 3;
  const positions = new Float32Array(flat.length);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = flat[i * 3];
    positions[i * 3 + 1] = flat[i * 3 + 1] + yOffset;
    positions[i * 3 + 2] = flat[i * 3 + 2];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
}

/// ステーション配列上の線形補間。`s` は [0, length) を想定。
export function interpolateAt(data, flat, s) {
  const segments = data.stationCount - 1;
  const u = (((s % data.length) + data.length) % data.length) / data.step;
  const i0 = Math.min(Math.floor(u), segments - 1);
  const f = u - i0;
  const i1 = i0 + 1;
  return new THREE.Vector3(
    flat[i0 * 3] + (flat[i1 * 3] - flat[i0 * 3]) * f,
    flat[i0 * 3 + 1] + (flat[i1 * 3 + 1] - flat[i0 * 3 + 1]) * f,
    flat[i0 * 3 + 2] + (flat[i1 * 3 + 2] - flat[i0 * 3 + 2]) * f
  );
}

/// `s` に最も近いステーションの索引。ホバー表示の値引きに使う。
export function stationIndexAt(data, s) {
  const wrapped = ((s % data.length) + data.length) % data.length;
  const i = Math.round(wrapped / data.step);
  return Math.min(i, data.stationCount - 1);
}

/// コース幅いっぱいに引く横断線を LineSegments としてまとめる。
function crossSegments(data, sList, color, yOffset) {
  const positions = new Float32Array(sList.length * 6);
  sList.forEach((s, k) => {
    const l = interpolateAt(data, data.left, s);
    const r = interpolateAt(data, data.right, s);
    positions[k * 6] = l.x;
    positions[k * 6 + 1] = l.y + yOffset;
    positions[k * 6 + 2] = l.z;
    positions[k * 6 + 3] = r.x;
    positions[k * 6 + 4] = r.y + yOffset;
    positions[k * 6 + 5] = r.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
}

/// セクター境界の横断線。
export function buildSectorMarkers(data) {
  return crossSegments(data, data.sectorBoundaries, 0x00e5ff, 0.4);
}

/// スタート/フィニッシュ線。板で描いて他の線と区別する。
export function buildStartFinish(data) {
  const s = data.startFinishS;
  const halfLength = 1.5;
  const a = s - halfLength;
  const b = s + halfLength;
  const corners = [
    interpolateAt(data, data.left, a),
    interpolateAt(data, data.right, a),
    interpolateAt(data, data.left, b),
    interpolateAt(data, data.right, b),
  ];
  const positions = new Float32Array(12);
  corners.forEach((c, i) => {
    positions[i * 3] = c.x;
    positions[i * 3 + 1] = c.y + 0.1;
    positions[i * 3 + 2] = c.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
}

/**
 * バンク区間のハイライト。|banking| が閾値を超えるステーションの
 * センターライン上に線分を並べる。
 */
export function buildBankingHighlight(data) {
  const points = [];
  for (let i = 0; i < data.stationCount - 1; i += 1) {
    if (
      Math.abs(data.banking[i]) < BANKING_THRESHOLD_RAD ||
      Math.abs(data.banking[i + 1]) < BANKING_THRESHOLD_RAD
    ) {
      continue;
    }
    points.push(
      data.center[i * 3],
      data.center[i * 3 + 1] + 1.2,
      data.center[i * 3 + 2],
      data.center[(i + 1) * 3],
      data.center[(i + 1) * 3 + 1] + 1.2,
      data.center[(i + 1) * 3 + 2]
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0xff00ff })
  );
}

/**
 * 100 m ごとの距離目盛り。500 m ごとに長い目盛りとラベルを付ける。
 * 目盛りはセンターラインから左端へ引く（`+t` が左であることの確認も兼ねる）。
 */
export function buildDistanceMarkers(data) {
  const positions = [];
  const labels = new THREE.Group();
  for (let s = 0; s < data.length; s += TICK_INTERVAL_M) {
    const c = interpolateAt(data, data.center, s);
    const l = interpolateAt(data, data.left, s);
    const isMajor = Math.abs(s % LABEL_INTERVAL_M) < 1e-9;
    const scale = isMajor ? 1.0 : 0.5;
    positions.push(
      c.x,
      c.y + 0.3,
      c.z,
      c.x + (l.x - c.x) * scale,
      c.y + 0.3 + (l.y - c.y) * scale,
      c.z + (l.z - c.z) * scale
    );
    if (isMajor) {
      labels.add(makeLabel(`${Math.round(s)} m`, l.x, l.y + 6.0, l.z));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  const ticks = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0xffc400 })
  );
  const group = new THREE.Group();
  group.add(ticks);
  group.add(labels);
  return group;
}

/// キャンバステクスチャの文字ラベル。装飾ではなく位置の読み取り用。
function makeLabel(text, x, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffc400';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 16);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  );
  sprite.position.set(x, y, z);
  sprite.scale.set(24, 6, 1);
  return sprite;
}

/// 凡例のカラーバー用。`u` は 0..1。着色本体と同じ関数を通す。
export function legendColorAt(legend, u) {
  if (legend.kind === 'sequential') {
    return sequential(legend.min + (legend.max - legend.min) * u, legend.min, legend.max);
  }
  return diverging(legend.maxAbs * (u * 2 - 1), legend.maxAbs);
}
