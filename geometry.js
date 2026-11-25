// Roof rectangle and panel layout in a local east/north metric frame around the first corner.
export const PANEL_LONG = 1.961;
export const PANEL_SHORT = 1.134;
export const PANEL_KW = 0.5;
export const GAP = 0.02;
export const EDGE = Object.freeze({ pitched: 0.3, flat: 0.5 });

const RAD = Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dot = (p, q) => p.x * q.x + p.y * q.y;
const add = (p, q, k = 1) => ({ x: p.x + q.x * k, y: p.y + q.y * k });

export function metersPerDegree(lat) {
  const phi = lat * RAD;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    lon: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi)
  };
}

export function toLocal(origin, point) {
  const scale = metersPerDegree(origin.lat);
  return { x: (point.lng - origin.lng) * scale.lon, y: (point.lat - origin.lat) * scale.lat };
}

export function toLatLng(origin, local) {
  const scale = metersPerDegree(origin.lat);
  return { lat: origin.lat + local.y / scale.lat, lng: origin.lng + local.x / scale.lon };
}

// Compass bearing of a local vector, degrees clockwise from north.
export function bearing(vector) {
  return (Math.atan2(vector.x, vector.y) / RAD + 360) % 360;
}

const direction = degrees => ({ x: Math.sin(degrees * RAD), y: Math.cos(degrees * RAD) });

// Line A runs from the first to the second tap; line B is the perpendicular distance to the third tap.
export function rectFromPoints(first, second, third) {
  const end = toLocal(first, second);
  const a = Math.hypot(end.x, end.y);
  if (a < 0.3) return null;
  const u = { x: end.x / a, y: end.y / a };
  let v = { x: -u.y, y: u.x };
  let b = dot(add(toLocal(first, third), end, -1), v);
  if (b < 0) {
    v = { x: -v.x, y: -v.y };
    b = -b;
  }
  return b < 0.3 ? null : { origin: first, u, v, a, b };
}

// A typed-in rectangle centred on a point, line A running east and line B running south.
export function manualRect(center, a, b) {
  const u = { x: 1, y: 0 };
  const v = { x: 0, y: -1 };
  const origin = toLatLng(center, { x: -a / 2, y: b / 2 });
  return { origin, u, v, a, b };
}

export function resizeRect(rect, a, b) {
  return { ...rect, a, b };
}

const pointAt = (rect, s, t) => toLatLng(rect.origin, add(add({ x: 0, y: 0 }, rect.u, s), rect.v, t));

export function rectCorners(rect) {
  return [pointAt(rect, 0, 0), pointAt(rect, rect.a, 0), pointAt(rect, rect.a, rect.b), pointAt(rect, 0, rect.b)];
}

export function rectCenter(rect) {
  return pointAt(rect, rect.a / 2, rect.b / 2);
}

// Jacobson & Jadhav (2018) fit of the annual optimum tilt for fixed panels.
export function optimalTilt(lat) {
  const phi = Math.abs(lat);
  return Math.round(clamp(1.3793 + phi * (1.2011 + phi * (-0.014404 + phi * 0.000080509)), 10, 45));
}

// Noon sun height on the winter solstice: rows spaced for it do not shade each other at midday all year.
export function winterNoonElevation(lat) {
  return Math.max(12, 90 - Math.abs(lat) - 23.44);
}

function fit(length, size) {
  return length < size ? 0 : Math.floor((length + GAP) / (size + GAP));
}

function pitchedLayout(rect, { azimuth, tilt }) {
  const facing = direction(azimuth);
  const runIsV = Math.abs(dot(rect.v, facing)) >= Math.abs(dot(rect.u, facing));
  const ridgePlan = runIsV ? rect.a : rect.b;
  const runPlan = runIsV ? rect.b : rect.a;
  const cos = Math.cos(tilt * RAD);
  const runTrue = runPlan / cos;
  const ridgeUse = ridgePlan - 2 * EDGE.pitched;
  const runUse = runTrue - 2 * EDGE.pitched;

  const options = [
    { orientation: 'portrait', alongRidge: PANEL_SHORT, alongRun: PANEL_LONG },
    { orientation: 'landscape', alongRidge: PANEL_LONG, alongRun: PANEL_SHORT }
  ].map(option => {
    const perRow = fit(ridgeUse, option.alongRidge);
    const rows = fit(runUse, option.alongRun);
    return { ...option, perRow, rows, count: perRow * rows };
  });
  const best = options[1].count > options[0].count ? options[1] : options[0];

  const panels = [];
  if (best.count) {
    const ridgeStart = EDGE.pitched + (ridgeUse - (best.perRow * (best.alongRidge + GAP) - GAP)) / 2;
    const runStart = EDGE.pitched + (runUse - (best.rows * (best.alongRun + GAP) - GAP)) / 2;
    for (let row = 0; row < best.rows; row += 1) {
      const q0 = (runStart + row * (best.alongRun + GAP)) * cos;
      const q1 = q0 + best.alongRun * cos;
      for (let col = 0; col < best.perRow; col += 1) {
        const r0 = ridgeStart + col * (best.alongRidge + GAP);
        const r1 = r0 + best.alongRidge;
        const corner = (r, q) => (runIsV ? pointAt(rect, r, q) : pointAt(rect, q, r));
        panels.push([corner(r0, q0), corner(r1, q0), corner(r1, q1), corner(r0, q1)]);
      }
    }
  }

  return {
    roof: 'pitched', azimuth, tilt, count: best.count, orientation: best.orientation,
    rows: best.rows, perRow: best.perRow, slopeArea: ridgePlan * runTrue, panels
  };
}

function flatLayout(rect, { lat }) {
  const rowIsU = Math.abs(rect.u.x) >= Math.abs(rect.v.x);
  const rowAxis = rowIsU ? rect.u : rect.v;
  const depthAxis = rowIsU ? rect.v : rect.u;
  const rowLength = rowIsU ? rect.a : rect.b;
  const depthLength = rowIsU ? rect.b : rect.a;
  // Panels face whichever way along the depth axis points closer to south.
  const towardSouth = depthAxis.y <= 0 ? 1 : -1;
  const azimuth = Math.round(bearing({ x: depthAxis.x * towardSouth, y: depthAxis.y * towardSouth }));
  const tilt = optimalTilt(lat);
  const sun = winterNoonElevation(lat);
  const offSouth = Math.cos((azimuth - 180) * RAD);
  const rowUse = rowLength - 2 * EDGE.flat;
  const depthUse = depthLength - 2 * EDGE.flat;

  const options = [
    { orientation: 'portrait', up: PANEL_LONG, along: PANEL_SHORT },
    { orientation: 'landscape', up: PANEL_SHORT, along: PANEL_LONG }
  ].map(option => {
    const depth = option.up * Math.cos(tilt * RAD);
    const shadow = option.up * Math.sin(tilt * RAD) * offSouth / Math.tan(sun * RAD);
    const pitch = depth + shadow;
    const perRow = fit(rowUse, option.along);
    const rows = depthUse < depth ? 0 : Math.floor((depthUse - depth) / pitch) + 1;
    return { ...option, depth, shadow, pitch, perRow, rows, count: perRow * rows };
  });
  const best = options[1].count > options[0].count ? options[1] : options[0];

  const panels = [];
  if (best.count) {
    const rowStart = EDGE.flat + (rowUse - (best.perRow * (best.along + GAP) - GAP)) / 2;
    const used = best.depth + (best.rows - 1) * best.pitch;
    const frontStart = EDGE.flat + (depthUse - used) / 2;
    // Depth is measured from the southern edge; convert it to the rectangle's own coordinate.
    const depthCoord = d => (towardSouth > 0 ? depthLength - d : d);
    for (let row = 0; row < best.rows; row += 1) {
      const d0 = depthCoord(frontStart + row * best.pitch);
      const d1 = depthCoord(frontStart + row * best.pitch + best.depth);
      for (let col = 0; col < best.perRow; col += 1) {
        const r0 = rowStart + col * (best.along + GAP);
        const r1 = r0 + best.along;
        const corner = (r, d) => (rowIsU ? pointAt(rect, r, d) : pointAt(rect, d, r));
        panels.push([corner(r0, d0), corner(r1, d0), corner(r1, d1), corner(r0, d1)]);
      }
    }
  }

  return {
    roof: 'flat', azimuth, tilt, sun, count: best.count, orientation: best.orientation,
    rows: best.rows, perRow: best.perRow, rowGap: best.shadow, pitch: best.pitch, panels
  };
}

export function layoutPanels(rect, options) {
  if (!rect) return null;
  return options.roof === 'flat' ? flatLayout(rect, options) : pitchedLayout(rect, options);
}
