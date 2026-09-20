// vehicle_mesh.js — 車両をプリミティブで組む。
//
// これはデバッグ用計測器であり製品レンダラではない（DECISIONS.md ADR-0003）。
// GLB（Blender 生成メッシュ）は読み込まない。マテリアルの作り込み・ライティング・
// 影・反射・エフェクトは付けない。すべて MeshBasicMaterial の単色で、
// 姿勢とサスペンションの動きが読めることだけを目的にする。
//
// 座標系は sim の規約そのまま（トラックと同じく変換を挟まない）:
//   車両ローカル +X 前方 / +Y 上 / +Z 右。
//   WASM の body_poses / wheel_poses が返すクォータニオンをそのまま quaternion に入れる。
//
// body_poses は重心のワールド姿勢、wheel_poses は各車輪の独立したワールド姿勢を返す。
// したがって外側の group は常に原点・無回転に保ち、chassis と各 wheel を
// それぞれのワールド姿勢で直接置く（車輪を chassis の子にしない）。

import * as THREE from 'three';

/// 車両スペック JSON を取得する（テキストのまま。WasmWorld にも同じ文字列を渡す）。
export async function loadVehicleSpecText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`車両スペック ${url} を取得できない (${res.status})`);
  return res.text();
}

/// `spec` は loadVehicleSpecText の戻り値を JSON.parse したもの。
export function buildVehicle(spec) {
  const d = spec.dimensions;
  const cgHeight = spec.mass.cg_height;

  const group = new THREE.Group();
  group.name = 'vehicle';

  // --- シャシー（車体 + ノーズ）。原点は重心。---
  const chassis = new THREE.Group();
  chassis.name = 'chassis';

  const bodyColor = colorFromArray(spec.visual?.livery?.base_color, 0x1b3a6b);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(d.length, d.height, d.width),
    new THREE.MeshBasicMaterial({ color: bodyColor })
  );
  body.name = 'body';
  // 箱の中心は床から height/2。重心は床から cg_height。差ぶん上へずらす。
  body.position.set(0, d.height / 2 - cgHeight, 0);
  body.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff })
    )
  );
  chassis.add(body);

  // 前方向（+X）を目で確認するノーズマーカー。
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.45, 8),
    new THREE.MeshBasicMaterial({ color: 0xffcc22 })
  );
  nose.geometry.rotateZ(-Math.PI / 2); // 頂点を +X へ
  nose.position.set(d.length / 2 + 0.22, body.position.y, 0);
  chassis.add(nose);

  group.add(chassis);

  // --- 車輪 4 個。WheelIndex::ALL の順（FL, FR, RL, RR）。---
  const wheels = [];
  const labels = ['FL', 'FR', 'RL', 'RR'];
  for (let i = 0; i < 4; i += 1) {
    const tyre = i < 2 ? spec.tyre.front : spec.tyre.rear;
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(tyre.radius, tyre.radius, tyre.width, 20),
      new THREE.MeshBasicMaterial({ color: 0x232a35 })
    );
    // CylinderGeometry の軸は +Y。車輪ローカルの車軸は +Z なので +Y -> +Z を焼き込む。
    wheel.geometry.rotateX(Math.PI / 2);
    wheel.name = `wheel-${labels[i]}`;
    // 回転が見える半径方向のマーカー板。
    wheel.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(tyre.radius * 1.8, tyre.radius * 0.16, tyre.width * 1.06),
        new THREE.MeshBasicMaterial({ color: 0xff8822 })
      )
    );
    group.add(wheel);
    wheels.push(wheel);
  }

  return { group, chassis, body, nose, wheels };
}

/// body_poses() の 1 台ぶん（7 要素）を chassis に適用する。
export function applyBodyPose(chassis, poses, i = 0) {
  const b = i * 7;
  chassis.position.set(poses[b], poses[b + 1], poses[b + 2]);
  chassis.quaternion.set(poses[b + 3], poses[b + 4], poses[b + 5], poses[b + 6]);
}

/// wheel_poses() の 1 台ぶん（28 要素）を 4 車輪へ適用する。
export function applyWheelPoses(wheels, poses, i = 0) {
  for (let k = 0; k < 4; k += 1) {
    const b = i * 28 + k * 7;
    wheels[k].position.set(poses[b], poses[b + 1], poses[b + 2]);
    wheels[k].quaternion.set(poses[b + 3], poses[b + 4], poses[b + 5], poses[b + 6]);
  }
}

function colorFromArray(rgb, fallback) {
  if (!Array.isArray(rgb) || rgb.length < 3) return fallback;
  return new THREE.Color(rgb[0], rgb[1], rgb[2]);
}
