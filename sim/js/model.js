// Procedural Cessna 172S model, built as a glTF (GLB) in the browser: no downloaded assets.
// Adapted from David's 3D Flight Sim (Frenchbear1/3D-Flight-Sim); paint follows the portfolio render
// (white, navy and red cheat line, wheel fairings).
// Body frame used here: x forward, y left, z up (metres). Exported to glTF as X=y, Y=z, Z=x.

/** Representative training-level performance. NOT POH/AFM data — for education only. */
export const AIRCRAFT = {
  c172: { name: 'Cessna 172S Skyhawk', shape: { L: 8.28, span: 10.92, wing: 'high', gear: 'fixed', chord: [1.63, 1.13], color: [0.95, 0.95, 0.96] } },
};

// ---------------- tiny mesh builder ----------------
class Mesh {
  constructor() { this.p = []; this.n = []; }
  tri(a, b, c, na, nb, nc) {
    if (!na) { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; na = nb = nc = [nx / l, ny / l, nz / l]; }
    this.p.push(...a, ...b, ...c); this.n.push(...na, ...nb, ...nc);
  }
  quad(a, b, c, d, na, nb, nc, nd) { this.tri(a, b, c, na, nb, nc); this.tri(a, c, d, na, nc, nd); }
  /** Lofted body of elliptical sections [{x, w, h, z, y?}] with smooth normals. */
  loft(secs, seg = 18, capA = true, capB = true) {
    const ring = s => { const r = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * 2 * Math.PI, cy = Math.cos(a), sz = Math.sin(a); const sup = Math.sign(sz) * Math.pow(Math.abs(sz), 0.8), cup = Math.sign(cy) * Math.pow(Math.abs(cy), 0.8); const nl = Math.hypot(cy / Math.max(s.w, 0.01), sz / Math.max(s.h, 0.01)) || 1; r.push({ v: [s.x, (s.y || 0) + s.w * cup, (s.z || 0) + s.h * sup], n: [0, cy / Math.max(s.w, 0.01) / nl, sz / Math.max(s.h, 0.01) / nl] }); } return r; };
    const rings = secs.map(ring);
    for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < seg; i++) { const a = rings[k][i], b = rings[k][(i + 1) % seg], c = rings[k + 1][(i + 1) % seg], d = rings[k + 1][i]; this.quad(a.v, b.v, c.v, d.v, a.n, b.n, c.n, d.n); }
    const cap = (r, s, flip) => { const ctr = [s.x, s.y || 0, s.z || 0]; for (let i = 0; i < seg; i++) { const a = r[i].v, b = r[(i + 1) % seg].v; flip ? this.tri(ctr, b, a) : this.tri(ctr, a, b); } };
    if (capA) cap(rings[0], secs[0], true); if (capB) cap(rings[rings.length - 1], secs[secs.length - 1], false);
    return this;
  }
  /** Tapered aerofoil surface from root leading edge to tip leading edge. tdir = thickness direction. */
  surface(rootLE, tipLE, cr, ct, thick = 0.12, tdir = [0, 0, 1]) {
    const prof = [[0, 0], [0.03, 0.42], [0.12, 0.8], [0.3, 1], [0.55, 0.82], [0.8, 0.42], [1, 0.03], [0.8, -0.2], [0.55, -0.34], [0.3, -0.4], [0.12, -0.36], [0.03, -0.22]];
    const mk = (le, c) => prof.map(([u, t]) => [le[0] - u * c + tdir[0] * t * thick * c * 0.5, le[1] + tdir[1] * t * thick * c * 0.5, le[2] + tdir[2] * t * thick * c * 0.5]);
    const A = mk(rootLE, cr), B = mk(tipLE, ct), n = prof.length;
    const ctrA = A.reduce((s, v) => [s[0] + v[0] / n, s[1] + v[1] / n, s[2] + v[2] / n], [0, 0, 0]), ctrB = B.reduce((s, v) => [s[0] + v[0] / n, s[1] + v[1] / n, s[2] + v[2] / n], [0, 0, 0]);
    const outward = (a, b, c) => { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const mx = (a[0] + b[0] + c[0]) / 3 - (ctrA[0] + ctrB[0]) / 2, my = (a[1] + b[1] + c[1]) / 3 - (ctrA[1] + ctrB[1]) / 2, mz = (a[2] + b[2] + c[2]) / 3 - (ctrA[2] + ctrB[2]) / 2; return nx * mx + ny * my + nz * mz >= 0; };
    const T = (a, b, c) => (outward(a, b, c) ? this.tri(a, b, c) : this.tri(a, c, b));
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; T(A[i], A[j], B[j]); T(A[i], B[j], B[i]); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.tri(ctrB, B[i], B[j]); this.tri(ctrB, B[j], B[i]); this.tri(ctrA, A[i], A[j]); this.tri(ctrA, A[j], A[i]); }
    return this;
  }
  /** Cylinder between two points (axis along y or x or any). */
  cyl(a, b, r, seg = 12) {
    const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...ax), d = ax.map(v => v / l);
    const up = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], u = norm(cross(d, up)), v = cross(d, u), ra = [], rb = [];
    for (let i = 0; i < seg; i++) { const t = (i / seg) * 2 * Math.PI, c = Math.cos(t) * r, s = Math.sin(t) * r, o = [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s]; ra.push([a[0] + o[0], a[1] + o[1], a[2] + o[2]]); rb.push([b[0] + o[0], b[1] + o[1], b[2] + o[2]]); }
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; this.quad(ra[i], ra[j], rb[j], rb[i]); this.tri(a, ra[j], ra[i]); this.tri(b, rb[i], rb[j]); }
    return this;
  }
  disc(c, r, seg = 28) { for (let i = 0; i < seg; i++) { const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI, p0 = [c[0], c[1] + Math.cos(a0) * r, c[2] + Math.sin(a0) * r], p1 = [c[0], c[1] + Math.cos(a1) * r, c[2] + Math.sin(a1) * r]; this.tri(c, p0, p1); this.tri(c, p1, p0); } return this; }
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };

/** Build the airframe. Returns {meshes:{paint,accent,glass,dark,prop,gear}, gearH, tips} */
export function buildAirframe(key) {
  const S = AIRCRAFT[key].shape, L = S.L, k = L / 8.3, cg = 0.3;
  const X = s => (cg - s) * L;                                   // station (0 nose .. 1 tail) -> body x
  const navy = new Mesh(), red = new Mesh(), paint = new Mesh(), accent = new Mesh(), glass = new Mesh(), dark = new Mesh(), prop = new Mesh(), gear = new Mesh();
  const jet = S.twin === 'jet', big = L > 12;
  const surfs = [];                         // hinged control surfaces: geometry is stored relative to the hinge so each can rotate about it
  const panel = (name, mat, A, B, cA, cB, thick, tdir) => {
    if (!name) return void (mat === 'accent' ? accent : paint).surface(A, B, cA, cB, thick, tdir);
    const h = A.map((v, i) => (v + B[i]) / 2), m = new Mesh(); m.surface(A.map((v, i) => v - h[i]), B.map((v, i) => v - h[i]), cA, cB, thick, tdir);
    surfs.push({ name, mat, mesh: m, hinge: h, axis: norm(B.map((v, i) => v - A[i])) });
  };
  const fw = (big ? 0.78 : 0.56) * (big ? 1 : k), fh = (big ? 0.85 : 0.66) * (big ? 1 : k);     // max half width / height
  const sec = jet || big
    ? [[0, 0.02, 0.02, -0.1], [0.04, 0.42, 0.4, -0.05], [0.1, 0.78, 0.74, 0], [0.18, 0.98, 0.96, 0.02], [0.28, 1, 1, 0.03], [0.55, 1, 1, 0.03], [0.72, 0.8, 0.86, 0.1], [0.88, 0.42, 0.5, 0.22], [1, 0.08, 0.14, 0.34]]
    : [[0.02, 0.5, 0.5, -0.02], [0.05, 0.8, 0.72, -0.02], [0.14, 0.94, 0.8, 0], [0.22, 1, 0.94, 0.08], [0.3, 1, 1, 0.12], [0.46, 0.96, 0.98, 0.12], [0.6, 0.68, 0.7, 0.1], [0.8, 0.3, 0.36, 0.14], [1, 0.07, 0.16, 0.2]];
  const F = sec.map(([s, w, h, z]) => ({ x: X(s), w: fw * w, h: fh * h, z: fh * z }));
  paint.loft(F);
  // greenhouse
  const g0 = jet || big ? 0.1 : 0.2, g1 = jet || big ? 0.2 : 0.47;
  const at = s => { for (let i = 0; i < sec.length - 1; i++) if (s <= sec[i + 1][0]) { const f = (s - sec[i][0]) / (sec[i + 1][0] - sec[i][0]); return sec[i].map((v, j) => v + (sec[i + 1][j] - v) * f); } return sec[sec.length - 1]; };
  const G = []; for (let i = 0; i <= 5; i++) { const s = g0 + (g1 - g0) * i / 5, [, w, h, z] = at(s), e = Math.sin(Math.PI * i / 5) * 0.5 + 0.5; G.push({ x: X(s), w: fw * w * (0.9 + 0.115 * e), h: fh * h * 0.5 * e + 0.02, z: fh * (z + h * 0.56) }); }
  glass.loft(G, 16);
  if (big) for (let i = 0; i < 5; i++) for (const sy of [-1, 1]) glass.loft([{ x: X(0.3 + i * 0.07), y: sy * fw * 0.985, w: 0.03, h: 0.17, z: fh * 0.35 }, { x: X(0.33 + i * 0.07), y: sy * fw * 0.985, w: 0.03, h: 0.17, z: fh * 0.35 }], 10);
  // wings
  const high = S.wing === 'high', wz = high ? fh * 1.02 : -fh * 0.62, dih = high ? 0.03 : 0.1, half = S.span / 2, wx = X(jet ? 0.46 : 0.25), sweep = jet ? 1.3 : 0.25;
  for (const sy of [-1, 1]) {
    const tip = [wx - sweep, sy * half, wz + dih * half], root = [wx, sy * (high ? 0 : fw * 0.5), wz];
    paint.surface(root, tip, S.chord[0] * 0.76, S.chord[1] * 0.76, 0.17);
    // trailing edge: fixed pieces plus hinged flap (inboard) and aileron (outboard)
    const at = f => root.map((v, i) => v + (tip[i] - v) * f), ch = f => S.chord[0] + (S.chord[1] - S.chord[0]) * f, te = f => { const q = at(f); return [q[0] - 0.74 * ch(f), q[1], q[2]]; }, side = sy > 0 ? 'L' : 'R';
    for (const [f0, f1, nm] of [[0, 0.14, null], [0.14, 0.56, 'flap'], [0.56, 0.6, null], [0.6, 0.95, 'ail'], [0.95, 1, null]]) panel(nm && nm + side, 'paint', te(f0), te(f1), 0.27 * ch(f0), 0.27 * ch(f1), 0.2);
    accent.surface([tip[0] + 0.01, tip[1] - sy * 0.45, tip[2] - dih * 0.45 + 0.004], [tip[0] - 0.02, tip[1] + sy * 0.03, tip[2] + 0.004], S.chord[1] * 1.04, S.chord[1] * 0.9, 0.15);
    if (high) dark.cyl([wx - 0.5, sy * fw * 0.8, -fh * 0.7], [wx - 0.55, sy * half * 0.48, wz + dih * half * 0.48 - 0.05], 0.035 * k, 8);
  }
  // tail
  const tx = X(0.86), tz = fh * 0.2, finH = (big ? 2.3 : 1.45 * k), finC = (big ? 2.2 : 1.35 * k);
  { const A = [tx + finC * 0.2, 0, tz], B = [tx - finC * 0.55, 0, tz + finH], at = f => A.map((v, i) => v + (B[i] - v) * f), ch = f => finC * (1 - 0.5 * f), te = f => { const q = at(f); return [q[0] - 0.6 * ch(f), q[1], q[2]]; };
    accent.surface(A, B, finC * 0.62, finC * 0.31, 0.16, [0, 1, 0]); panel(null, 'accent', te(0), te(0.06), 0.4 * ch(0), 0.4 * ch(0.06), 0.14, [0, 1, 0]); panel('rud', 'accent', te(0.06), te(1), 0.4 * ch(0.06), 0.4 * ch(1), 0.14, [0, 1, 0]); }
  const hz = S.ttail ? tz + finH - 0.05 : tz + 0.05, hx = S.ttail ? tx - finC * 0.5 : tx + 0.1, hs = S.span * 0.17 + 0.6;
  for (const sy of [-1, 1]) { const A = [hx, 0, hz], B = [hx - 0.35, sy * hs, hz], cA = finC * 0.72, cB = finC * 0.42, at = f => A.map((v, i) => v + (B[i] - v) * f), ch = f => cA + (cB - cA) * f, te = f => { const q = at(f); return [q[0] - 0.58 * ch(f), q[1], q[2]]; };
    paint.surface(A, B, cA * 0.6, cB * 0.6, 0.16); panel(null, 'paint', te(0), te(0.08), 0.42 * ch(0), 0.42 * ch(0.08), 0.14); panel('elev' + (sy > 0 ? 'L' : 'R'), 'paint', te(0.08), te(1), 0.42 * ch(0.08), 0.42 * cB, 0.14); }
  // engines / props
  const tips = { left: [wx - sweep - S.chord[1] * 0.4, half, wz + dih * half], right: [wx - sweep - S.chord[1] * 0.4, -half, wz + dih * half], tail: [X(1), 0, fh * 0.3], top: [tx - finC * 0.6, 0, tz + finH], belly: [X(0.4), 0, -fh] };
  const propAt = (x, y, z, r) => {
    // propeller as two nodes about the hub: a blur disc (shown at speed) and two twisted blades (shown while slow)
    const disc = new Mesh(); disc.disc([0, 0, 0], r); surfs.push({ name: 'disc', mat: 'prop', mesh: disc, hinge: [x, y, z], axis: [1, 0, 0] });
    const bl = new Mesh(), N = 8;
    for (const sz of [1, -1]) for (let i = 0; i < N; i++) {
      const at = j => { const f = j / N, rr = 0.09 + (r - 0.09) * f, ch = (0.15 - 0.07 * f) * (1 - 0.6 * Math.max(0, f - 0.85) / 0.15), tw = (28 - 16 * f) * Math.PI / 180;
        const cx = Math.sin(tw) * ch / 2, cy = Math.cos(tw) * ch / 2 * sz; return [[cx, -cy, rr * sz], [-cx, cy, rr * sz]]; };
      const [a0, b0] = at(i), [a1, b1] = at(i + 1); bl.quad(a0, a1, b1, b0); bl.quad(a0, b0, b1, a1);
    }
    surfs.push({ name: 'blades', mat: 'blade', mesh: bl, hinge: [x, y, z], axis: [1, 0, 0] });
    dark.loft([{ x: x + 0.32 * k, y, w: 0.02, h: 0.02, z }, { x: x + 0.1 * k, y, w: 0.14 * k, h: 0.14 * k, z }, { x: x - 0.06, y, w: 0.17 * k, h: 0.17 * k, z }], 10); };
  if (S.twin === 'prop') for (const sy of [-1, 1]) { const y = sy * 1.75, z = wz + 0.12; paint.loft([{ x: wx + 1.25, y, w: 0.3, h: 0.3, z }, { x: wx + 0.9, y, w: 0.42, h: 0.4, z }, { x: wx - 0.4, y, w: 0.4, h: 0.36, z }, { x: wx - 1.5, y, w: 0.1, h: 0.1, z: z + 0.05 }], 12); propAt(wx + 1.3, y, z, 0.95); }
  else if (jet) for (const sy of [-1, 1]) { const y = sy * (fw + 0.5), z = fh * 0.45, x = X(0.68); paint.loft([{ x: x + 1.2, y, w: 0.4, h: 0.4, z }, { x: x + 0.6, y, w: 0.46, h: 0.46, z }, { x: x - 0.9, y, w: 0.4, h: 0.4, z }, { x: x - 1.4, y, w: 0.26, h: 0.26, z }], 14); dark.disc([x + 1.21, y, z], 0.34); dark.disc([x - 1.41, y, z], 0.22); }
  else propAt(X(0.02) + 0.02, 0, F[0].z, (big ? 1.33 : 0.95 * k));
  if (!jet && !big) accent.loft([{ x: X(0.02) + 0.01, w: fw * 0.52, h: fh * 0.52, z: F[0].z }, { x: X(0.05), w: fw * 0.81, h: fh * 0.73, z: F[1].z }, { x: X(0.1), w: fw * 0.9, h: fh * 0.78, z: -0.01 }], 18, false, false);
  // landing gear (separate node so retractables can tuck it away in flight)
  const gz = -(big ? 1.75 : 1.22 * k), wr = big ? 0.28 : 0.2 * k, mainX = X(big ? 0.42 : 0.37), mainY = big ? 1.9 : (high ? 1.15 : 1.5) * k, noseX = X(0.09);
  for (const [x, y] of [[noseX, 0], [mainX, mainY], [mainX, -mainY]]) { gear.cyl([x, y - 0.07, gz + wr], [x, y + 0.07, gz + wr], wr, 14); gear.cyl([x, y * (high ? 0.45 : 1), y ? (high ? -fh * 0.7 : wz) : -fh * 0.5], [x, y, gz + wr], 0.04 * (big ? 1.5 : k), 8); }
  // cheat line: navy band with a thin red pinstripe, nose to tail, plus a navy fin stripe
  const band = (m, z0, z1, i0 = 1) => {
    for (const sy of [-1, 1]) for (let i = i0; i < F.length - 1; i++) {
      const A = F[i], B = F[i + 1], yAt = (S2, z) => { const u = Math.min(0.98, Math.abs(z - S2.z) / S2.h); return sy * S2.w * Math.pow(1 - Math.pow(u, 2), 0.42) * 1.016 + sy * 0.004; };
      const lift = f => z0 + (z1 - z0) * 0 + f, t = i / (F.length - 1), t2 = (i + 1) / (F.length - 1), rise = x => x * x * 0.32;
      const za0 = A.z + z0 + rise(t), za1 = A.z + z1 + rise(t), zb0 = B.z + z0 + rise(t2), zb1 = B.z + z1 + rise(t2); void lift;
      const a0 = [A.x, yAt(A, za0), za0], a1 = [A.x, yAt(A, za1), za1], b0 = [B.x, yAt(B, zb0), zb0], b1 = [B.x, yAt(B, zb1), zb1];
      sy > 0 ? m.quad(a0, b0, b1, a1) : m.quad(a0, a1, b1, b0);
    }
  };
  band(navy, -0.2 * fh, -0.07 * fh); band(red, -0.03 * fh, 0.02 * fh);
  { const A = [tx + finC * 0.2, 0, tz], B = [tx - finC * 0.55, 0, tz + finH]; for (const sy of [-1, 1]) { const o = sy * 0.075; const P = (f, d) => [A[0] + (B[0] - A[0]) * f - d, o, A[2] + (B[2] - A[2]) * f]; sy > 0 ? navy.quad(P(0.18, 0.1), P(0.18, 0.75), P(0.5, 0.75), P(0.5, 0.1)) : navy.quad(P(0.18, 0.1), P(0.5, 0.1), P(0.5, 0.75), P(0.18, 0.75)); } }
  // wheel fairings
  for (const [x, y] of [[noseX, 0], [mainX, mainY], [mainX, -mainY]]) paint.loft([{ x: x + 0.42, y, w: 0.02, h: 0.04, z: gz + wr }, { x: x + 0.25, y, w: 0.13, h: 0.17, z: gz + wr + 0.02 }, { x: x - 0.1, y, w: 0.15, h: 0.2, z: gz + wr + 0.04 }, { x: x - 0.5, y, w: 0.03, h: 0.05, z: gz + wr + 0.1 }], 14);
  return { meshes: { paint, accent, glass, dark, prop, gear, navy, red }, surfs, gearH: -gz, tips, color: S.color, retract: S.gear === 'retract' };
}

/** Pack the airframe into a binary glTF and return {url, gearH, tips, retract}. */
export function buildAircraftModel(key) {
  const af = buildAirframe(key), mats = {
    paint: { pbrMetallicRoughness: { baseColorFactor: [0.95, 0.95, 0.96, 1], metallicFactor: 0.25, roughnessFactor: 0.38 } },
    accent: { pbrMetallicRoughness: { baseColorFactor: [...af.color, 1], metallicFactor: 0.25, roughnessFactor: 0.4 } },
    glass: { pbrMetallicRoughness: { baseColorFactor: [0.05, 0.09, 0.13, 1], metallicFactor: 0.6, roughnessFactor: 0.12 } },
    dark: { pbrMetallicRoughness: { baseColorFactor: [0.12, 0.12, 0.13, 1], metallicFactor: 0.3, roughnessFactor: 0.6 } },
    prop: { pbrMetallicRoughness: { baseColorFactor: [0.7, 0.72, 0.75, 0.16], metallicFactor: 0, roughnessFactor: 1 }, alphaMode: 'BLEND', doubleSided: true },
    gear: { pbrMetallicRoughness: { baseColorFactor: [0.1, 0.1, 0.11, 1], metallicFactor: 0.2, roughnessFactor: 0.8 } },
    navy: { pbrMetallicRoughness: { baseColorFactor: [0.06, 0.11, 0.33, 1], metallicFactor: 0.25, roughnessFactor: 0.4 }, doubleSided: true },
    red: { pbrMetallicRoughness: { baseColorFactor: [0.72, 0.07, 0.1, 1], metallicFactor: 0.25, roughnessFactor: 0.4 }, doubleSided: true },
    blade: { pbrMetallicRoughness: { baseColorFactor: [0.13, 0.13, 0.14, 1], metallicFactor: 0.4, roughnessFactor: 0.5 }, doubleSided: true },
  };
  const names = Object.keys(mats), bufs = [], accessors = [], views = [], prims = {}; let off = 0;
  const push = (arr, type) => { const f = new Float32Array(arr); views.push({ buffer: 0, byteOffset: off, byteLength: f.byteLength, target: 34962 }); const acc = { bufferView: views.length - 1, componentType: 5126, count: f.length / 3, type }; bufs.push(f); off += f.byteLength; accessors.push(acc); return acc; };
  const packMesh = (m, mi) => {
    const conv = a => { const o = new Array(a.length); for (let i = 0; i < a.length; i += 3) { o[i] = a[i + 1]; o[i + 1] = a[i + 2]; o[i + 2] = a[i]; } return o; };
    const P = conv(m.p), acc = push(P, 'VEC3'); let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < P.length; i += 3) for (let j = 0; j < 3; j++) { if (P[i + j] < mn[j]) mn[j] = P[i + j]; if (P[i + j] > mx[j]) mx[j] = P[i + j]; }
    acc.min = mn; acc.max = mx; const pi = accessors.length - 1; push(conv(m.n), 'VEC3');
    return { attributes: { POSITION: pi, NORMAL: pi + 1 }, material: mi, mode: 4 };
  };
  names.forEach((nm, mi) => { const m = af.meshes[nm]; if (m && m.p.length) prims[nm] = packMesh(m, mi); });
  const g3 = v => [v[1], v[2], v[0]], sMesh = af.surfs.map(sf => ({ primitives: [packMesh(sf.mesh, names.indexOf(sf.mat))] }));
  const surfs = af.surfs.map(sf => ({ name: sf.name, hinge: g3(sf.hinge), axis: g3(sf.axis), sgn: sf.name === 'rud' ? 1 : sf.axis[1] > 0 ? -1 : 1 }));
  const body = names.filter(n => n !== 'gear' && prims[n]).map(n => prims[n]);
  const json = { asset: { version: '2.0', generator: '3D-Flight-Sim procedural airframe' }, scene: 0, scenes: [{ nodes: [0, 1, ...surfs.map((_, i) => i + 2)] }], nodes: [{ name: 'body', mesh: 0 }, { name: 'gear', mesh: 1 }, ...surfs.map((sf, i) => ({ name: sf.name, mesh: i + 2, translation: sf.hinge }))], meshes: [{ primitives: body }, { primitives: [prims.gear] }, ...sMesh], materials: names.map(n => ({ name: n, ...mats[n] })), accessors, bufferViews: views, buffers: [{ byteLength: off }] };
  let js = JSON.stringify(json); while (js.length % 4) js += ' ';
  const jb = new TextEncoder().encode(js), total = 12 + 8 + jb.length + 8 + off, out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true); u8.set(jb, 20);
  let o = 20 + jb.length; dv.setUint32(o, off, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
  for (const f of bufs) { u8.set(new Uint8Array(f.buffer), o); o += f.byteLength; }
  return { glb: out, gearH: af.gearH, tips: af.tips, retract: af.retract, surfs };
}
