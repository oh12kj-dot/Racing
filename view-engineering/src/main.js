// main.js — Engineering View のエントリポイント。
//
// これはデバッグ用計測器であり、製品レンダラではない（DECISIONS.md ADR-0003）。
// 影・反射・ポストエフェクト・スカイボックス・マテリアルの作り込みは行わない。
// 追加してよいのは検証とデバッグに直接寄与するものだけ。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import init, { WasmTrack, WasmWorld } from '../pkg/sim_wasm.js';
import {
  STEP_M,
  sampleTrack,
  buildSurface,
  recolorSurface,
  buildLoop,
  buildSectorMarkers,
  buildStartFinish,
  buildBankingHighlight,
  buildDistanceMarkers,
  stationIndexAt,
  legendColorAt,
} from './track_mesh.js';
import {
  loadVehicleSpecText,
  buildVehicle,
  applyBodyPose,
  applyWheelPoses,
} from './vehicle_mesh.js';
import { Overlay, COLOR_MODES, LAYERS } from './overlay.js';

// module URL 基準で解決する。index.html の置き場所に依存しないため。
const TRACK_URL = new URL('../../assets/tracks/aoyama_ring.track.json', import.meta.url);
const VEHICLE_URL = new URL('../../assets/vehicles/gt_proto_a.spec.json', import.meta.url);

// sim_vehicle::PHYSICS_DT と一致させること（240 Hz 固定）。WASM からは取れないので
// ここに定数として置く。ずれると駆動ループの実時間換算が狂う。
const PHYSICS_DT = 1 / 240;
// 1 フレームで消化してよい物理 tick の上限。WASM 側の MAX_STEPS_PER_CALL と一致させる。
const MAX_STEPS_PER_FRAME = 32;
// 1 台ぶんの入力ストライド [steer, throttle, brake, clutch, gear, drs]。
const INPUT_STRIDE = 6;
// sim_driver::SIM_DT（60 Hz 固定）。Simulation Tick の実時間。
const SIM_DT = 1 / 60;
// 1 フレームで消化してよい Simulation Tick の上限。WASM 側 MAX_SIM_STEPS_PER_CALL と一致。
const MAX_SIM_STEPS_PER_FRAME = 8;
// WasmWorld::driver_telemetry の 1 台あたり要素数。
const DRIVER_TELEMETRY_STRIDE = 12;
// DriverMode 判別子 -> ラベル（WASM は `as u8` で数値を返す。§Decision の宣言順）。
const DRIVER_MODES = [
  'FreeAir', 'Following', 'Attacking', 'Defending', 'SideBySide', 'Avoiding',
  'Recovering', 'PitIn', 'PitOut', 'UnderYellow', 'SafetyCar', 'BlueFlag',
];
// レーシングラインのサンプル間隔 [m]（RacingLine::DEFAULT_STEP_M と揃える）。
const RACING_LINE_STEP_M = 2.0;
// レーシングラインを路面から持ち上げる量 [m]（z-fight 回避）。
const RACING_LINE_LIFT_M = 0.06;
// バランス型ドライバーの能力値 14 個（DriverModel 宣言順）。
const BALANCED_ABILITIES = new Float64Array([
  0.6, 0.6, 0.6, 0.5, 0.5, 1.0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.2, 1.0, 0.0,
]);

const overlay = new Overlay(document.getElementById('overlay'));

main().catch((err) => {
  console.error(err);
  overlay.setError(`起動に失敗: ${err.message ?? err}`);
});

async function main() {
  await init();

  const response = await fetch(TRACK_URL);
  if (!response.ok) {
    throw new Error(
      `${TRACK_URL} を取得できない (${response.status})。リポジトリルートから静的サーバを起動しているか確認する`
    );
  }
  const json = await response.text();

  const t0 = performance.now();
  const track = new WasmTrack(json);
  const tBuild = performance.now() - t0;

  const t1 = performance.now();
  const data = sampleTrack(track, STEP_M);
  const tSample = performance.now() - t1;
  console.info(
    `WasmTrack build ${tBuild.toFixed(1)} ms / sampling ${tSample.toFixed(1)} ms ` +
      `(${data.stationCount} stations @ ${data.step.toFixed(4)} m)`
  );

  const { scene, camera, renderer, controls } = createScene(data);
  const objects = buildObjects(scene, data);
  const probe = createProbe(scene);

  // ---- 車両（sim-core の World を WASM 越しに走らせる）----
  const specText = await loadVehicleSpecText(VEHICLE_URL);
  const spec = JSON.parse(specText);
  const world = new WasmWorld(json, specText);
  // S/F ストレート上（バンクほぼ 0）に置く。spawn の姿勢はヨーのみのため
  // 既知の無害範囲（HANDOFF.md D-1）で運用する。
  const startS = ((track.start_finish_s() - 30 + data.length) % data.length);
  // Driver AI 車。走行計画を取り付けてから spawn_driver する（TASK-2-3）。
  // set_race_seed は u64 = wasm-bindgen では BigInt。
  world.set_race_seed(1n);
  world.attach_racing_line(RACING_LINE_STEP_M);
  world.spawn_driver(startS, 0.0, BALANCED_ABILITIES);
  const hasAi = world.vehicle_count() > 0;

  const car = buildVehicle(spec);
  scene.add(car.group);

  // レーシングライン（v_target で頂点着色）と AI 目標マーカー。
  const racingLineMesh = buildRacingLineMesh(world);
  if (racingLineMesh) {
    scene.add(racingLineMesh);
    objects.byId.racingline = racingLineMesh;
  }
  const aimGroup = buildAimMarkers();
  aimGroup.visible = hasAi;
  scene.add(aimGroup);
  objects.byId.aim = aimGroup;

  // AI 不在時のみ使う暫定スクリプト入力（既存経路。**Driver AI ではない**）。
  const input = { steer: 0.0, throttle: 0.35, brake: 0.0, gear: 1 };
  let autoShift = true;
  let simAccumulator = 0;
  let simLastTime = performance.now();

  function currentInputsFlat() {
    return new Float64Array([
      input.steer,
      input.throttle,
      input.brake,
      0.0, // clutch
      input.gear,
      0.0, // drs
    ]);
  }

  const EMPTY_MANUAL = new Float64Array(0);

  function driveWorld(nowMs) {
    const dtReal = Math.min((nowMs - simLastTime) / 1000, 0.25);
    simLastTime = nowMs;
    simAccumulator += dtReal;

    if (hasAi) {
      // Simulation Tick で進める（Driver フェーズ 1 回 + 物理 4 tick / sim tick）。
      let n = Math.floor(simAccumulator / SIM_DT);
      if (n <= 0) return;
      if (n > MAX_SIM_STEPS_PER_FRAME) n = MAX_SIM_STEPS_PER_FRAME;
      simAccumulator -= n * SIM_DT;
      world.step_sim(n, EMPTY_MANUAL);
    } else {
      // 既存の手動経路（AI 0 台のとき）。
      let n = Math.floor(simAccumulator / PHYSICS_DT);
      if (n <= 0) return;
      if (n > MAX_STEPS_PER_FRAME) n = MAX_STEPS_PER_FRAME;
      simAccumulator -= n * PHYSICS_DT;
      if (autoShift) {
        const rpm = world.telemetry()[4];
        if (rpm > 6600 && input.gear < spec.drivetrain.gear_ratios.length) input.gear += 1;
        else if (rpm < 2600 && input.gear > 1) input.gear -= 1;
      }
      world.step(n, currentInputsFlat());
    }

    applyBodyPose(car.chassis, world.body_poses(), 0);
    applyWheelPoses(car.wheels, world.wheel_poses(), 0);
    overlay.setTelemetry(readTelemetry(world, data));
    if (hasAi) {
      const d = readDriver(world, 0);
      overlay.setDriver(d);
      updateAimMarkers(aimGroup, d);
    }
    if (chaseCam) updateChaseCamera();
  }

  /// v_target を [min,max] で正規化して寒色→暖色に着色した折れ線を作る。
  function buildRacingLineMesh(w) {
    const flat = Array.from(w.sample_racing_line(RACING_LINE_STEP_M));
    const vtar = Array.from(w.sample_target_speed(RACING_LINE_STEP_M));
    if (flat.length < 6 || vtar.length < 2) return null;
    const n = flat.length / 3;
    let vmin = Infinity;
    let vmax = -Infinity;
    for (const v of vtar) {
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    const span = Math.max(vmax - vmin, 1e-6);
    const positions = new Float32Array(flat.length);
    const colors = new Float32Array(flat.length);
    for (let i = 0; i < n; i += 1) {
      positions[i * 3] = flat[i * 3];
      positions[i * 3 + 1] = flat[i * 3 + 1] + RACING_LINE_LIFT_M;
      positions[i * 3 + 2] = flat[i * 3 + 2];
      const u = (vtar[Math.min(i, vtar.length - 1)] - vmin) / span; // 0 遅い .. 1 速い
      // 寒色(青)→暖色(赤)。表示された色 = 値。
      colors[i * 3] = u;
      colors[i * 3 + 1] = 0.15 + 0.5 * (1 - Math.abs(u * 2 - 1));
      colors[i * 3 + 2] = 1 - u;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const line = new THREE.LineLoop(
      geom,
      new THREE.LineBasicMaterial({ vertexColors: true })
    );
    line.name = 'racingline';
    line.userData.vRange = [vmin, vmax];
    return line;
  }

  function buildAimMarkers() {
    const g = new THREE.Group();
    g.name = 'aim';
    const aim = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffee44 })
    );
    aim.name = 'aim-point';
    const tgt = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x44ffee })
    );
    tgt.name = 't-target';
    g.add(aim, tgt);
    return g;
  }

  function updateAimMarkers(group, driver) {
    if (!driver) return;
    const aim = group.getObjectByName('aim-point');
    const tgt = group.getObjectByName('t-target');
    // aim 点: aim_s のレーシングライン上の点。
    const aimWorld = lineWorldAt(racingLineMesh, driver.aimS, data.length);
    if (aimWorld && aim) aim.position.copy(aimWorld);
    // t_target 点: 現在 s の位置でトラック横方向へ t_target（+ が左）。
    const i = stationIndexAt(data, driver.s);
    const c = new THREE.Vector3(
      data.center[i * 3],
      data.center[i * 3 + 1],
      data.center[i * 3 + 2]
    );
    const left = new THREE.Vector3(
      data.left[i * 3] - c.x,
      data.left[i * 3 + 1] - c.y,
      data.left[i * 3 + 2] - c.z
    );
    if (left.lengthSq() > 1e-9) left.normalize();
    if (tgt) {
      tgt.position
        .copy(c)
        .addScaledVector(left, driver.tTarget)
        .setY(c.y + RACING_LINE_LIFT_M);
    }
  }

  /// 折れ線上の弧長 s に対応するワールド点（等間隔サンプルの線形補間）。
  function lineWorldAt(mesh, s, length) {
    if (!mesh) return null;
    const pos = mesh.geometry.getAttribute('position');
    const n = pos.count;
    const x = (((s % length) + length) % length) / length * n;
    const i0 = Math.floor(x) % n;
    const i1 = (i0 + 1) % n;
    const f = x - Math.floor(x);
    return new THREE.Vector3(
      pos.getX(i0) + (pos.getX(i1) - pos.getX(i0)) * f,
      pos.getY(i0) + (pos.getY(i1) - pos.getY(i0)) * f,
      pos.getZ(i0) + (pos.getZ(i1) - pos.getZ(i0)) * f
    );
  }

  // ---- チェイスカメラ（車体後方から。OrbitControls と排他）----
  let chaseCam = false;
  function updateChaseCamera() {
    const p = world.body_poses();
    const pos = new THREE.Vector3(p[0], p[1], p[2]);
    const q = new THREE.Quaternion(p[3], p[4], p[5], p[6]);
    const back = new THREE.Vector3(-1, 0, 0).applyQuaternion(q); // 車体前方の逆
    const up = new THREE.Vector3(0, 1, 0);
    camera.position.copy(pos).addScaledVector(back, 12).addScaledVector(up, 4.5);
    controls.target.copy(pos);
    controls.update();
  }

  let mode = 'curvature';
  const visibility = {};
  LAYERS.forEach((l) => {
    visibility[l.id] = true;
  });

  overlay.setTrackInfo(data);
  overlay.setModes(mode);
  overlay.setLayers(visibility);
  applyLegend(objects.legend, mode);

  function applyLegend(legend, activeMode) {
    overlay.setLegend(legend, activeMode);
    overlay.paintLegendBar((u) => legendColorAt(legend, u));
  }

  function setMode(id) {
    if (!COLOR_MODES.some((m) => m.id === id)) return;
    mode = id;
    const legend = recolorSurface(objects.surface, data, mode);
    overlay.setModes(mode);
    applyLegend(legend, mode);
  }

  function setLayerVisible(id, on) {
    if (!(id in objects.byId)) return;
    visibility[id] = on;
    objects.byId[id].visible = on;
    overlay.setLayers(visibility);
  }

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const modeEntry = COLOR_MODES.find((m) => m.key === key);
    if (modeEntry) {
      setMode(modeEntry.id);
      return;
    }
    const layer = LAYERS.find((l) => l.key === key);
    if (layer) {
      setLayerVisible(layer.id, !visibility[layer.id]);
    }
  });

  // ---- ホバーによる数値読み取り ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerActive = false;

  renderer.domElement.addEventListener('pointermove', (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pointerActive = true;
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    pointerActive = false;
    probe.visible = false;
    overlay.setReadout(null);
  });

  function updateReadout() {
    if (!pointerActive || !objects.surface.visible) return;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(objects.surface, false);
    if (hits.length === 0) {
      probe.visible = false;
      overlay.setReadout(null);
      return;
    }
    const p = hits[0].point;
    // 幾何の解釈は必ず Simulation Core 側に問い合わせる。
    const st = track.world_to_track(p.x, p.y, p.z);
    const s = st[0];
    const i = stationIndexAt(data, s);
    probe.position.copy(p);
    probe.visible = true;
    overlay.setReadout({
      s,
      t: st[1],
      curvature: data.curvature[i],
      banking: data.banking[i],
      width: data.width[i],
      widthLeft: distance3(data.left, data.center, i),
      widthRight: distance3(data.right, data.center, i),
      elevation: p.y,
      sector: `S${sectorOf(data, s) + 1}`,
    });
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    driveWorld(performance.now());
    controls.update();
    updateReadout();
    renderer.render(scene, camera);
  });

  // 自動検証とスクリーンショット取得のためのハンドル。
  // 計測器を外から操作できないと、表示の正しさを機械的に確認できない。
  // 読み出し・視点操作・ControlInput の指定のみ。位置や速度を直接書く API は足さない
  // （実シミュレーションの唯一の駆動手段が ControlInput のため setInput は許容される）。
  window.__engview = {
    THREE,
    scene,
    camera,
    controls,
    data,
    track,
    objects,
    world,
    car,
    // 検証用（読み出しのみ）: 初期化済みモジュールの WasmWorld と、起動時に読んだ
    // 定義 JSON。ネイティブ参照と突き合わせる別の World をブラウザ内で組める。
    WasmWorld,
    __trackJson: json,
    __specText: specText,
    setMode,
    setLayerVisible,
    /// `s` [m] の地点を、高さ `height` m から距離 `dist` m で見る。
    focusAt(s, dist = 60, height = 40) {
      const i = stationIndexAt(data, s);
      const p = new THREE.Vector3(
        data.center[i * 3],
        data.center[i * 3 + 1],
        data.center[i * 3 + 2]
      );
      controls.target.copy(p);
      camera.position.set(p.x, p.y + height, p.z + dist);
      camera.near = 0.5;
      camera.updateProjectionMatrix();
      controls.update();
      return { s: data.stationS[i], index: i };
    },
    /// 1 tick だけ進める（CDP 検証用）。AI 車なら 1 Simulation Tick、
    /// そうでなければ 1 物理 tick。描画も 1 回更新する。
    stepOnce() {
      if (hasAi) world.step_sim(1, EMPTY_MANUAL);
      else world.step(1, currentInputsFlat());
      applyBodyPose(car.chassis, world.body_poses(), 0);
      applyWheelPoses(car.wheels, world.wheel_poses(), 0);
      overlay.setTelemetry(readTelemetry(world, data));
      if (hasAi) {
        const d = readDriver(world, 0);
        overlay.setDriver(d);
        updateAimMarkers(aimGroup, d);
      }
      return { telemetry: readTelemetry(world, data), driver: readDriver(world, 0) };
    },
    /// 暫定スクリプト入力の上書き。指定したキーだけ更新する。
    setInput(partial = {}) {
      if ('steer' in partial) input.steer = partial.steer;
      if ('throttle' in partial) input.throttle = partial.throttle;
      if ('brake' in partial) input.brake = partial.brake;
      if ('gear' in partial) {
        input.gear = partial.gear;
        autoShift = false; // 明示指定されたら自動ギアを止める
      }
      if ('autoShift' in partial) autoShift = !!partial.autoShift;
      return { ...input, autoShift };
    },
    vehicle: {
      bodyPose: (i = 0) => Array.from(world.body_poses()).slice(i * 7, i * 7 + 7),
      wheelPoses: (i = 0) => Array.from(world.wheel_poses()).slice(i * 28, i * 28 + 28),
      telemetry: () => readTelemetry(world, data),
    },
    // 検証用（読み出しのみ）。Driver AI と走行計画。
    hasAi,
    driverTelemetry: (i = 0) => readDriver(world, i),
    racingLine: () => ({
      points: Array.from(world.sample_racing_line(RACING_LINE_STEP_M)),
      targetSpeed: Array.from(world.sample_target_speed(RACING_LINE_STEP_M)),
      vRange: racingLineMesh ? racingLineMesh.userData.vRange : null,
    }),
    /// 車体後方からのチェイスカメラ。OrbitControls の手動操作とは排他。
    followCar(on = true) {
      chaseCam = !!on;
      if (chaseCam) updateChaseCamera();
      return chaseCam;
    },
  };
}

/// driver_telemetry() の平坦配列（1 台ぶん 12 要素）を読みやすい形に展開する。
/// has_driver = 0 なら null。
function readDriver(world, i) {
  const t = world.driver_telemetry();
  const b = i * DRIVER_TELEMETRY_STRIDE;
  if (t.length < b + DRIVER_TELEMETRY_STRIDE || t[b] !== 1) return null;
  const tele = world.telemetry();
  const speed = tele.length >= 25 ? tele[i * 25 + 3] : 0;
  return {
    id: i,
    tTarget: t[b + 1],
    vTarget: t[b + 2],
    lookahead: t[b + 3],
    aimS: t[b + 4],
    mode: DRIVER_MODES[t[b + 5]] ?? `#${t[b + 5]}`,
    confidence: t[b + 6],
    s: t[b + 7],
    t: t[b + 8],
    headingError: t[b + 9],
    sideslip: t[b + 10],
    gripUsageMax: t[b + 11],
    speed,
  };
}

/// telemetry() の平坦配列（1 台ぶん 25 要素）を読みやすい形に展開する。
function readTelemetry(world, data) {
  const t = world.telemetry();
  if (t.length < 25) return null;
  const wheelLabels = ['FL', 'FR', 'RL', 'RR'];
  const wheels = wheelLabels.map((label, k) => {
    const b = 9 + k * 4;
    return {
      label,
      load: t[b],
      slipRatio: t[b + 1],
      slipAngle: t[b + 2],
      gripUsage: t[b + 3],
    };
  });
  return {
    s: t[0],
    t: t[1],
    laps: t[2],
    speedKmh: t[3] * 3.6,
    rpm: t[4],
    gear: t[5],
    inSteer: t[6],
    inThrottle: t[7],
    inBrake: t[8],
    sector: `S${sectorOf(data, t[0]) + 1}`,
    standing: world.standings()[0] === 0 ? 'P1' : `P${world.standings().indexOf(0) + 1}`,
    wheels,
  };
}

/// `Track::sector_of` と同じ規則（境界以上の個数）。
function sectorOf(data, s) {
  const wrapped = ((s % data.length) + data.length) % data.length;
  return data.sectorBoundaries.filter((b) => wrapped >= b).length;
}

function distance3(a, b, i) {
  return Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 1] - b[i * 3 + 1], a[i * 3 + 2] - b[i * 3 + 2]);
}

function createScene(data) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101216);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('viewport').appendChild(renderer.domElement);

  // トラックの広がりからカメラ距離を決める。
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < data.surface.length; i += 3) {
    v.set(data.surface[i], data.surface[i + 1], data.surface[i + 2]);
    box.expandByPoint(v);
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.z);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    1,
    extent * 20
  );
  camera.position.set(center.x, center.y + extent * 0.75, center.z + extent * 0.75);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.update();

  scene.userData.center = center;
  scene.userData.extent = extent;
  return { scene, camera, renderer, controls };
}

function buildObjects(scene, data) {
  const { mesh: surface, legend } = buildSurface(data, 'curvature');
  scene.add(surface);

  const centerline = buildLoop(data.center, 0xffffff, 0.05);
  centerline.name = 'centerline';
  scene.add(centerline);

  const edges = new THREE.Group();
  edges.name = 'edges';
  edges.add(buildLoop(data.left, 0x22ff88, 0.05));
  edges.add(buildLoop(data.right, 0xff8822, 0.05));
  scene.add(edges);

  const sectors = new THREE.Group();
  sectors.name = 'sectors';
  sectors.add(buildSectorMarkers(data));
  sectors.add(buildStartFinish(data));
  scene.add(sectors);

  const banking = buildBankingHighlight(data);
  banking.name = 'banking';
  scene.add(banking);

  const markers = buildDistanceMarkers(data);
  markers.name = 'markers';
  scene.add(markers);

  // y = 0 のグリッド。標高を目で読むための基準面。
  const extent = scene.userData.extent;
  const grid = new THREE.GridHelper(extent * 1.5, 30, 0x445566, 0x222a33);
  grid.position.set(scene.userData.center.x, 0, scene.userData.center.z);
  grid.name = 'grid';
  scene.add(grid);

  return {
    surface,
    legend,
    byId: { surface, centerline, edges, sectors, banking, markers, grid },
  };
}

/// ホバー位置を示す小さな球。装飾ではなく、読み取り位置の明示。
function createProbe(scene) {
  const probe = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  probe.visible = false;
  scene.add(probe);
  return probe;
}
