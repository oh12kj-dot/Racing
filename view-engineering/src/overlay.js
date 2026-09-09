// overlay.js — 数値表示の HUD。
//
// 計測器なので「数値が読めること」がすべて。装飾は行わない（ADR-0003）。

/// 着色モードの定義。main.js のキー割り当てと対応する。
export const COLOR_MODES = [
  { id: 'curvature', key: '1', label: '曲率' },
  { id: 'banking', key: '2', label: 'バンク' },
  { id: 'elevation', key: '3', label: '標高' },
];

/// 表示レイヤの定義。`id` は main.js が作る Three.js オブジェクトの名前と対応する。
export const LAYERS = [
  { id: 'surface', key: 'q', label: '路面' },
  { id: 'centerline', key: 'w', label: 'センターライン' },
  { id: 'edges', key: 'e', label: 'コース端' },
  { id: 'sectors', key: 'r', label: 'セクター/SF' },
  { id: 'banking', key: 't', label: 'バンク区間' },
  { id: 'markers', key: 'y', label: '距離目盛り' },
  { id: 'grid', key: 'g', label: 'グリッド (y=0)' },
  { id: 'racingline', key: 'u', label: 'レーシングライン (v_target 着色)' },
  { id: 'aim', key: 'i', label: 'AI 目標 (aim / t_target)' },
];

export class Overlay {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = `
      <div id="panel">
        <div id="track-info"></div>
        <div class="section" id="legend"></div>
        <div class="section" id="modes"></div>
        <div class="section" id="layers"></div>
      </div>
      <div id="telemetry">車両テレメトリ待機中</div>
      <div id="driver">Driver AI 待機中</div>
      <div id="readout">カーソルを路面に合わせると数値を表示</div>
    `;
    this.info = this.root.querySelector('#track-info');
    this.legend = this.root.querySelector('#legend');
    this.modes = this.root.querySelector('#modes');
    this.layers = this.root.querySelector('#layers');
    this.telemetry = this.root.querySelector('#telemetry');
    this.driver = this.root.querySelector('#driver');
    this.readout = this.root.querySelector('#readout');
  }

  /// Driver AI の内部状態。計測器なので数値だけ（ADR-0003）。
  /// `d` は main.js の readDriver が返す形。null なら AI 不在。
  setDriver(d) {
    if (!d) {
      this.driver.textContent = 'Driver AI 待機中';
      return;
    }
    const deg = (r) => ((r * 180) / Math.PI).toFixed(2);
    this.driver.innerHTML = `
      <div class="label">Driver AI（VehicleId ${d.id}）</div>
      <table>
        <tr><th>mode</th><td>${d.mode}</td>
            <th>confidence</th><td>${d.confidence.toFixed(3)}</td></tr>
        <tr><th>v_target</th><td>${d.vTarget.toFixed(1)} m/s</td>
            <th>speed</th><td>${d.speed.toFixed(1)} m/s</td></tr>
        <tr><th>Δv (tar−spd)</th><td>${(d.vTarget - d.speed).toFixed(1)} m/s</td>
            <th>lookahead</th><td>${d.lookahead.toFixed(1)} m</td></tr>
        <tr><th>t_target</th><td>${d.tTarget.toFixed(2)} m</td>
            <th>t</th><td>${d.t.toFixed(2)} m</td></tr>
        <tr><th>heading err</th><td>${deg(d.headingError)}°</td>
            <th>sideslip</th><td>${deg(d.sideslip)}°</td></tr>
        <tr><th>grip usage max</th><td>${(d.gripUsageMax * 100).toFixed(0)}%</td>
            <th></th><td></td></tr>
      </table>`;
  }

  /// 車両テレメトリ。main.js の readTelemetry が返す形をそのまま受ける。
  /// 計測器なので数値だけ。色分け・グラフは付けない（ADR-0003）。
  setTelemetry(v) {
    if (!v) {
      this.telemetry.textContent = '車両テレメトリ待機中';
      return;
    }
    const wheelRows = v.wheels
      .map(
        (w) =>
          `<tr><th>${w.label}</th>` +
          `<td>${w.load.toFixed(0)} N</td>` +
          `<td>${w.slipRatio.toFixed(3)}</td>` +
          `<td>${((w.slipAngle * 180) / Math.PI).toFixed(2)}°</td>` +
          `<td>${(w.gripUsage * 100).toFixed(0)}%</td></tr>`
      )
      .join('');
    this.telemetry.innerHTML = `
      <div class="label">車両テレメトリ（${v.standing}）</div>
      <table>
        <tr><th>速度</th><td>${v.speedKmh.toFixed(1)} km/h</td>
            <th>rpm</th><td>${v.rpm.toFixed(0)}</td>
            <th>gear</th><td>${v.gear === 0 ? 'N' : v.gear < 0 ? 'R' : v.gear}</td></tr>
        <tr><th>throttle</th><td>${v.inThrottle.toFixed(2)}</td>
            <th>brake</th><td>${v.inBrake.toFixed(2)}</td>
            <th>steer</th><td>${v.inSteer.toFixed(2)}</td></tr>
        <tr><th>lap</th><td>${v.laps}</td>
            <th>s</th><td>${v.s.toFixed(1)} m</td>
            <th>t</th><td>${v.t.toFixed(2)} m</td></tr>
        <tr><th>sector</th><td>${v.sector}</td><th></th><td></td><th></th><td></td></tr>
      </table>
      <table class="wheels">
        <tr><th></th><th>load</th><th>slipR</th><th>slipA</th><th>grip</th></tr>
        ${wheelRows}
      </table>`;
  }

  /// トラックの基本諸元。起動時に一度だけ書く。
  setTrackInfo(data) {
    const sectors = data.sectorBoundaries.map((s) => s.toFixed(1)).join(' / ');
    this.info.innerHTML = `
      <div class="title">${escapeHtml(data.name)}</div>
      <table>
        <tr><th>全長</th><td>${data.length.toFixed(3)} m</td></tr>
        <tr><th>サンプル</th><td>${data.stationCount} pt @ ${data.step.toFixed(4)} m</td></tr>
        <tr><th>セクター境界</th><td>${sectors} m</td></tr>
        <tr><th>Start/Finish</th><td>${data.startFinishS.toFixed(3)} m</td></tr>
      </table>`;
  }

  /// 現在の着色モードの凡例。実際の値域を数値で出す。
  setLegend(legend, mode) {
    const swatches = [];
    const steps = 9;
    for (let i = 0; i < steps; i += 1) {
      const u = i / (steps - 1);
      let value;
      if (legend.kind === 'sequential') {
        value = legend.min + (legend.max - legend.min) * u;
      } else {
        value = legend.maxAbs * (u * 2 - 1);
      }
      swatches.push(value);
    }
    const cells = swatches
      .map((v) => `<span class="tick">${formatLegendValue(v, legend.unit)}</span>`)
      .join('');
    this.legend.innerHTML = `
      <div class="label">${legend.label} [${legend.unit}]</div>
      <canvas id="legend-bar" width="240" height="14"></canvas>
      <div class="ticks">${cells}</div>
      <div class="note">${
        legend.kind === 'diverging'
          ? '正規化は signed sqrt（0 付近の勾配を立ててスパイクを見つけやすくするため）'
          : '線形正規化'
      }</div>`;
    this.currentLegend = legend;
    this.currentMode = mode;
  }

  /// 凡例のカラーバーを描く。色の生成は呼び出し側（track_mesh）に任せる。
  paintLegendBar(colorAt) {
    const canvas = this.legend.querySelector('#legend-bar');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    for (let x = 0; x < canvas.width; x += 1) {
      const c = colorAt(x / (canvas.width - 1));
      ctx.fillStyle = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(
        c[2] * 255
      )})`;
      ctx.fillRect(x, 0, 1, canvas.height);
    }
  }

  setModes(activeId) {
    this.modes.innerHTML =
      '<div class="label">着色モード</div>' +
      COLOR_MODES.map(
        (m) =>
          `<div class="row${m.id === activeId ? ' on' : ''}"><kbd>${m.key}</kbd>${m.label}</div>`
      ).join('');
  }

  setLayers(visibility) {
    this.layers.innerHTML =
      '<div class="label">表示レイヤ</div>' +
      LAYERS.map(
        (l) =>
          `<div class="row${visibility[l.id] ? ' on' : ''}"><kbd>${l.key}</kbd>${l.label}</div>`
      ).join('');
  }

  /// マウスホバーの数値表示。
  setReadout(values) {
    if (!values) {
      this.readout.textContent = 'カーソルを路面に合わせると数値を表示';
      return;
    }
    const { s, t, curvature, banking, width, elevation, sector, widthLeft, widthRight } = values;
    const radius = Math.abs(curvature) > 1e-9 ? 1.0 / curvature : Infinity;
    const radiusText = Number.isFinite(radius)
      ? `${radius > 0 ? '左' : '右'} R=${Math.abs(radius).toFixed(1)} m`
      : '直線';
    this.readout.innerHTML = `
      <span><b>s</b> ${s.toFixed(2)} m</span>
      <span><b>t</b> ${t.toFixed(3)} m</span>
      <span><b>曲率</b> ${curvature.toExponential(3)} 1/m (${radiusText})</span>
      <span><b>バンク</b> ${banking.toFixed(4)} rad (${((banking * 180) / Math.PI).toFixed(2)}°)</span>
      <span><b>幅</b> ${width.toFixed(2)} m (L ${widthLeft.toFixed(2)} / R ${widthRight.toFixed(
        2
      )})</span>
      <span><b>標高</b> ${elevation.toFixed(2)} m</span>
      <span><b>セクター</b> ${sector}</span>`;
  }

  setError(message) {
    this.readout.innerHTML = `<span class="error">${escapeHtml(message)}</span>`;
  }
}

function formatLegendValue(v, unit) {
  if (unit === '1/m') return v.toExponential(1);
  return v.toFixed(unit === 'rad' ? 3 : 1);
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
