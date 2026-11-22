// Cessna 172S flight model: a small six-degree-of-freedom rigid body with stability-derivative
// aerodynamics (values in the range published for the 172 in Roskam / Napolitano), a stall break,
// post-stall autorotation (so an uncoordinated stall can drop a wing and spin), propeller
// left-turning tendencies, and three spring-damper landing-gear legs with brakes and nose-wheel
// steering. Pure math, no rendering, so it can be unit-tested in Node.
// Representative behaviour for fun and practice: NOT a certified model of any aircraft.

const D2R = Math.PI / 180, G = 9.80665, KT = 0.514444, FT = 0.3048;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sig = x => 1 / (1 + Math.exp(-x));

/** Airframe constants (SI). Body axes: x forward, y right, z down, origin at the CG. */
export const C172 = {
  name: 'Cessna 172S Skyhawk', m: 1043, S: 16.17, b: 10.92, c: 1.494, Ixx: 1285, Iyy: 1825, Izz: 2667,
  P: 134e3, eta: 0.72, Tstatic: 2250, vne: 163, vno: 129, vfe: [163, 110, 85, 85], flapDeg: [0, 10, 20, 30],
  // aerodynamic coefficients
  CL0: 0.31, CLa: 5.14, CLq: 3.9, CLde: 0.43, CD0: 0.034, k: 0.054,
  Cm0: 0.045, Cma: -0.89, Cmq: -12.4, Cmde: -1.28,
  CYb: -0.31, CYdr: 0.187, Clb: -0.089, Clp: -0.47, Clr: 0.096, Clda: 0.178, Cldr: 0.0147,
  Cnb: 0.065, Cnp: -0.03, Cnr: -0.099, Cnda: -0.053, Cndr: 0.0657,
  flapCL: [0, 0.34, 0.6, 0.78], flapCD: [0, 0.012, 0.04, 0.075], flapCm: [0, -0.012, -0.022, -0.03], flapStall: [0, -0.8, -1.4, -1.9],
  aStall: 16.5 * D2R,
  // landing gear contact points (body, metres) and spring/damper per leg
  gear: [
    { x: 1.74, y: 0, z: 1.22, k: 52000, c: 5200, nose: true },
    { x: -0.58, y: -1.15, z: 1.22, k: 78000, c: 7000 },
    { x: -0.58, y: 1.15, z: 1.22, k: 78000, c: 7000 },
  ],
  // points that must never touch the ground
  hard: [
    { x: -0.3, y: -5.46, z: -0.84, what: 'Left wingtip strike' }, { x: -0.3, y: 5.46, z: -0.84, what: 'Right wingtip strike' },
    { x: 2.05, y: 0, z: 0.96, what: 'Prop strike' }, { x: -5.6, y: 0, z: 0.0, what: 'Tail strike', soft: 0.25 }, { x: 0.2, y: 0, z: 0.7, what: 'Belly landing' },
  ],
};

/**
 * The airframe as loaded: weight (lb) and CG (inches aft of the datum, the firewall). Heavier means
 * more mass and inertia (longer ground roll, higher stall and lift-off speeds, slower response).
 * The CG moves the pitch stability: forward CG is stiff and nose-heavy (more elevator to flare,
 * stall speed up a little); aft CG is light and twitchy, and past the aft limit it gets close to
 * neutral stability and the spin is harder to stop. The reference airframe is 2,300 lb at 41.0 in.
 */
export function configure(lb, cgIn, base = C172) {
  const m = lb * 0.45359237, k = m / base.m, dx = (cgIn - 41.0) * 0.0254, dxc = dx / base.c;
  return { ...base, m, Ixx: base.Ixx * (0.55 + 0.45 * k), Iyy: base.Iyy * (0.6 + 0.4 * k), Izz: base.Izz * (0.55 + 0.45 * k), lb, cgIn, dx,
    Cm0: base.Cm0 + base.CL0 * dxc, Cma: base.Cma + base.CLa * dxc, dCLcg: 0.35 * dxc, spinRec: clamp(1 - 7 * Math.max(0, dxc - 0.05), 0.15, 1),
    gear: base.gear.map(g => ({ ...g, x: g.x + dx })), hard: base.hard.map(h => ({ ...h, x: h.x + dx })) };
}

/**
 * Auto-trim, run by the caller each frame: slowly trims out held elevator pressure and pitch rate,
 * and centres the slip ball with rudder trim. It stays out of the way near the stall and whenever
 * rudder is being used, so a deliberately uncoordinated stall still drops a wing and spins.
 * t = { pt, rt } trim offsets (-1..1), mutated and returned.
 */
export function autoTrim(s, c, t, dt) {
  t.pt ??= 0; t.rt ??= 0; t.ai ??= 0; t.damp = 0; t.ad = 0; t.rd = 0;
  if (s.crashed) return t;
  if (s.onGround) { t.rt += -t.rt * Math.min(1, dt * 2); t.ai = 0; t.ref = null; t.bank = null; return t; }
  if (s.stall > 0.2 || s.warn) { t.ref = null; t.bank = null; return t; }
  const e = eulerFromQ(s.q);
  // pitch: trim follows held elevator; once released, hold the attitude where the nose settled
  if (Math.abs(c.de) > 0.08) { t.ref = null; t.pt += 0.25 * c.de * dt; }
  else {
    if (t.ref == null || Math.abs(s.qr) > 0.04 && !t.locked) { t.ref = clamp(e.th, -12 * D2R, 15 * D2R); t.locked = false; } else t.locked = true;
    if (s.ias < 68 && t.ref > -2 * D2R) t.ref -= (68 - s.ias) * 0.0012 * dt * 60 * D2R;   // getting slow: let the nose come down
    t.pt += 2.2 * (t.ref - e.th) * dt; t.damp = clamp(-1.8 * s.qr, -0.35, 0.35);
  }
  t.pt = clamp(t.pt, -1, 1);
  // roll: once the ailerons are released, hold that bank (trims out torque and the slow spiral)
  if (Math.abs(c.da) > 0.08) t.bank = null;
  else { if (t.bank == null && Math.abs(s.p) < 0.05) t.bank = e.phi; t.ad = clamp(-0.35 * s.p, -0.2, 0.2); if (t.bank != null) t.ai = clamp(t.ai + 0.4 * (t.bank - e.phi) * dt, -0.25, 0.25); }
  // rudder: centre the ball (a slow trim plus a direct slip term, which also damps the Dutch roll)
  t.rd = 0;
  if (Math.abs(c.dr) < 0.12) { t.rt = clamp(t.rt + 0.8 * s.beta * dt, -0.5, 0.5); t.rd = clamp(4 * s.beta, -0.35, 0.35); }
  return t;
}
/** Controls with the auto-trim applied. */
export function trimmed(c, t) { return { ...c, trim: clamp((c.trim || 0) + t.pt + t.damp, -1, 1), da: clamp(c.da + t.ai + t.ad, -1, 1), rtrim: t.rt + t.rd }; }

// ---------- quaternion helpers (body -> NED) ----------
function qmul(a, b) {
  return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
}
export function qFromEuler(phi, th, psi) {
  const cr = Math.cos(phi / 2), sr = Math.sin(phi / 2), cp = Math.cos(th / 2), sp = Math.sin(th / 2), cy = Math.cos(psi / 2), sy = Math.sin(psi / 2);
  return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy];
}
export function eulerFromQ(q) {
  const [w, x, y, z] = q;
  return { phi: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)), th: Math.asin(clamp(2 * (w * y - z * x), -1, 1)), psi: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) };
}
/** Rotation matrix body->NED (row-major 3x3). */
export function dcm(q) {
  const [w, x, y, z] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}
const toNed = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const toBody = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];

export const neutralControls = () => ({ de: 0, da: 0, dr: 0, thr: 0, flaps: 0, brk: 0, trim: 0 });
const rhoAt = h => 1.225 * Math.pow(Math.max(0.2, 1 - 2.25577e-5 * h), 4.2559);

/**
 * New state. n/e are metres north/east of the caller's origin, h is metres (same datum as the ground
 * heights the caller supplies). Heading in degrees true. kt = true airspeed if airborne.
 */
export function createState({ n = 0, e = 0, h, hdg = 0, kt = 0, pitchDeg = 0, onGround = true, fuelGal = 53 }) {
  const psi = hdg * D2R, th = pitchDeg * D2R;
  return { n, e, h, q: qFromEuler(0, th, psi), u: kt * KT * Math.cos(th), v: 0, w: kt * KT * Math.sin(th) * 0, p: 0, qr: 0, r: 0,
    pw: onGround ? 0.1 : 0.6, flap: 0, t: 0, crashed: null, msg: '', onGround, alpha: 0, beta: 0, nz: 1, stall: 0, warn: false, rpm: 700,
    vn: 0, ve: 0, vd: 0, lastSink: 0, gearLoad: [0, 0, 0], spin: 0, buffet: 0, _rand: 0,
    fuelL: fuelGal / 2, fuelR: fuelGal / 2, starveT: 0, starved: false, running: true };
}

/**
 * Advance by dt seconds (internally sub-stepped). c = controls, env = { ground: metres under the CG,
 * wind: { dir, kt } (from), gust: 0..1 }. Mutates and returns s.
 */
export function step(s, c, dt, env = {}, ac = C172) {
  if (s.crashed) return s;
  dt = Math.min(dt, 0.1);
  const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
  for (let i = 0; i < n && !s.crashed; i++) sub(s, c, h, env, ac);
  return s;
}

function sub(s, c, dt, env, ac) {
  s.t += dt;
  const R = dcm(s.q), rho = rhoAt(s.h), sg = rho / 1.225, W = ac.m * G, gnd = env.ground ?? -1e9;
  // --- wind (NED, the direction the air moves to) ---
  const wk = (env.wind?.kt || 0) * KT, wdir = ((env.wind?.dir || 0) + 180) * D2R;
  let gust = 0; if (env.gust) { s._rand += (Math.random() - 0.5) * 2 * dt * 3; s._rand *= 1 - dt * 0.8; gust = s._rand * env.gust * 6; }
  const agl = s.h - gnd, shear = clamp(agl / 60, 0.35, 1);       // the wind is lighter near the ground
  const wN = Math.cos(wdir) * (wk * shear + gust), wE = Math.sin(wdir) * (wk * shear + gust);
  const wb = toBody(R, [wN, wE, gust * 0.15]);
  const ua = s.u - wb[0], va = s.v - wb[1], wa = s.w - wb[2], V = Math.hypot(ua, va, wa), Vs = Math.max(V, 6);
  const alpha = V > 2 ? Math.atan2(wa, ua) : 0, beta = V > 2 ? Math.asin(clamp(va / V, -1, 1)) : 0;
  const qbar = 0.5 * rho * V * V;
  // --- engine (180 hp Lycoming, fixed-pitch prop) ---
  const thr = clamp(c.thr, 0, 1), mx = c.mx ?? 1, ign = c.ign ?? 3;
  // fuel: the selector feeds LEFT, RIGHT or BOTH tanks; no flow for a few seconds starves the engine
  const sel = c.shutoff ? 'OFF' : (c.sel || 'B');
  const canL = s.fuelL > 0.05 && (sel === 'L' || sel === 'B'), canR = s.fuelR > 0.05 && (sel === 'R' || sel === 'B');
  if (canL || canR) { s.starveT = Math.max(0, s.starveT - dt * 2); if (s.starveT === 0) s.starved = false; } else if ((s.starveT += dt) > 6) s.starved = true;
  s.running = c.eng !== false && !s.starved && mx >= 0.08 && ign > 0;
  const ideal = clamp(1 - (s.h / FT) / 26000, 0.35, 1), mix = clamp(1 - 2.4 * (mx - ideal) ** 2, 0.55, 1) * (ign === 1 || ign === 2 ? 0.96 : 1);
  s.pw += clamp((s.running ? thr * mix : 0) - s.pw, -dt / 0.6, dt / 0.8);
  if (s.running) {
    const gph = 1.6 + 10.5 * s.pw * (0.7 + 0.3 * mx), burn = gph / 3600 * dt;
    if (canL && canR) { s.fuelL -= burn / 2; s.fuelR -= burn / 2; } else if (canL) s.fuelL -= burn; else if (canR) s.fuelR -= burn;
    s.fuelL = Math.max(0, s.fuelL); s.fuelR = Math.max(0, s.fuelR);
  }
  const Pavail = ac.P * s.pw * Math.pow(sg, 1.1);
  let T = s.pw * Math.pow(sg, 1.1) * Math.min(ac.Tstatic - 8 * V, ac.eta * ac.P / Math.max(V, 1));
  T -= 0.002 * qbar * ac.S * (1 - s.pw);                         // windmilling prop drag at idle
  s.rpm += ((s.running ? 650 + 2050 * s.pw + 9 * Math.max(0, V - 30) * (1 - 0.4 * s.pw) : Math.max(0, 15 * (V - 22))) - s.rpm) * Math.min(1, dt * (s.running ? 3 : 1.2));
  // --- flaps (motor runs ~2.5 s per notch) ---
  const fl = clamp(Math.round(c.flaps), 0, 3); s.flap += clamp(fl - s.flap, -dt / 2.5, dt / 2.5);
  const fi = Math.min(2, Math.floor(s.flap)), ff = s.flap - fi, lerpF = arr => arr[fi] + (arr[fi + 1] - arr[fi]) * ff;
  const dCLf = lerpF(ac.flapCL), dCDf = lerpF(ac.flapCD), dCmf = lerpF(ac.flapCm), aS = ac.aStall + lerpF(ac.flapStall) * D2R;
  // --- surfaces ---
  const de = -clamp(c.de, -1, 1) * (c.de > 0 ? 28 : 23) * D2R - clamp(c.trim || 0, -1, 1) * 9 * D2R;   // + = trailing edge down
  const drIn = clamp(c.dr + (s.onGround ? 0 : c.rtrim || 0), -1, 1), da = clamp(c.da, -1, 1) * 19 * D2R, dr = drIn * 24 * D2R;
  s.surf = { elev: clamp(c.de + (c.trim || 0) * 0.3, -1, 1), ail: clamp(c.da, -1, 1), rud: drIn, flap: s.flap * 10 };
  // --- aerodynamics ---
  const ph = s.p * ac.b / (2 * Vs), qh = s.qr * ac.c / (2 * Vs), rh = s.r * ac.b / (2 * Vs);
  const sigma = Math.max(sig((alpha - aS) / 0.022), sig((-alpha - 0.2) / 0.022));        // 0 attached .. 1 fully stalled
  const CLlin = ac.CL0 + (ac.dCLcg || 0) + ac.CLa * alpha + dCLf + ac.CLq * qh + ac.CLde * de;
  const CLmax = ac.CL0 + (ac.dCLcg || 0) + ac.CLa * aS + dCLf, CLpost = alpha > 0 ? Math.max(1.12 * Math.sin(2 * alpha) + 0.3 * dCLf, CLmax * (0.8 - 1.1 * (alpha - aS))) : 1.12 * Math.sin(2 * alpha);
  const CL = (1 - sigma) * CLlin + sigma * CLpost;
  const CD = ac.CD0 + dCDf + (1 - sigma) * ac.k * CLlin * CLlin + sigma * (1.3 * Math.sin(alpha) ** 2 + 0.08) + 0.25 * beta * beta;
  const CY = ac.CYb * beta - ac.CYdr * dr;
  // the wing that is stalled deeper loses lift and its drag rises: roll damping turns into autorotation
  const ClpE = ac.Clp * (1 - 0.8 * sigma), ClrE = ac.Clr + 0.45 * sigma, CnrE = ac.Cnr * (1 - 0.45 * sigma);
  let Cl = (ac.Clb - 0.32 * sigma) * beta + ClpE * ph + ClrE * rh + ac.Clda * (1 - 0.55 * sigma) * da - ac.Cldr * dr;
  let Cm = ac.Cm0 + ac.Cma * alpha + ac.Cmq * qh + ac.Cmde * (1 - 0.5 * sigma) * (sigma > 0.5 && de > 0 ? ac.spinRec ?? 1 : 1) * de + dCmf - 0.9 * sigma * Math.max(0, alpha - aS);
  let Cn = ac.Cnb * beta + ac.Cnp * ph + CnrE * rh + ac.Cnda * da + ac.Cndr * (sigma > 0.5 && dr * s.r < 0 ? 0.5 * (ac.spinRec ?? 1) : 1) * dr;   // anti-spin rudder is weak while the wing is stalled, weaker still at aft CG
  // stall buffet: small random rolling/pitching shudder
  if (sigma > 0.15 && V > 15) { s.buffet = sigma; Cl += (Math.random() - 0.5) * 0.012 * sigma; Cm += (Math.random() - 0.5) * 0.02 * sigma; } else s.buffet = 0;
  const qS = qbar * ac.S;
  const L = qS * CL, D = qS * CD, Y = qS * CY;
  let X = 0, Yb = 0, Z = 0;
  if (V > 0.5) {
    const vx = ua / V, vy = va / V, vz = wa / V;
    X = -D * vx + L * Math.sin(alpha); Yb = -D * vy + Y; Z = -D * vz - L * Math.cos(alpha);
  }
  let Lm = qS * ac.b * Cl, Mm = qS * ac.c * Cm, Nm = qS * ac.b * Cn;
  // propeller: thrust, P-factor + slipstream (yaw left), engine torque (roll left), slipstream over the tail
  X += T;
  const Tpos = Math.max(T, 0);
  Nm -= Tpos * (0.05 + 0.55 * clamp(alpha, 0, 0.35)) * (1 - 0.4 * clamp(V / 60, 0, 1));
  Lm -= 0.15 * Pavail / (s.rpm * Math.PI / 30 + 1);
  const qProp = Tpos / (Math.PI * 0.95 * 0.95) * 0.9;            // extra dynamic pressure behind the prop
  Nm += qProp * 1.2 * ac.b * ac.Cndr * dr * 0.55; Mm += qProp * 1.6 * ac.c * ac.Cmde * de * 0.35;
  // gravity
  const gb = toBody(R, [0, 0, W]); X += gb[0]; Yb += gb[1]; Z += gb[2];
  // --- landing gear and ground contact ---
  let onG = false, sinkMax = 0;
  const vN = toNed(R, [s.u, s.v, s.w]);
  for (let i = 0; i < ac.gear.length; i++) {
    const g = ac.gear[i], rN = toNed(R, [g.x, g.y, g.z]), pen = (gnd) - (s.h - rN[2]);
    s.gearLoad[i] = 0;
    if (pen <= 0) continue;
    onG = true;
    // velocity of the contact point (NED): v + omega x r
    const wr = [s.qr * g.z - s.r * g.y, s.r * g.x - s.p * g.z, s.p * g.y - s.qr * g.x], wrN = toNed(R, wr);
    const pv = [vN[0] + wrN[0], vN[1] + wrN[1], vN[2] + wrN[2]];
    sinkMax = Math.max(sinkMax, pv[2]);
    const Fn = Math.max(0, g.k * Math.min(pen, 0.35) + g.c * pv[2]);
    s.gearLoad[i] = Fn;
    // wheel direction on the ground (nose wheel steers with the rudder pedals)
    const R0 = toNed(R, [1, 0, 0]); let hx = R0[0], hy = R0[1]; const hl = Math.hypot(hx, hy) || 1; hx /= hl; hy /= hl;
    if (g.nose) { const st = clamp(c.dr, -1, 1) * 10 * D2R * clamp(1.2 - Math.hypot(pv[0], pv[1]) / 40, 0.3, 1), cs = Math.cos(st), sn = Math.sin(st); [hx, hy] = [hx * cs - hy * sn, hx * sn + hy * cs]; }
    const vlong = pv[0] * hx + pv[1] * hy, vlat = -pv[0] * hy + pv[1] * hx;
    const brake = g.nose ? 0 : clamp(c.brk, 0, 1) * (c.brkDiff ? 1 + c.brkDiff * (g.y > 0 ? 1 : -1) : 1);
    const mu = 0.02 + 0.55 * clamp(brake, 0, 1);
    const Flong = -Fn * mu * clamp(vlong / 0.4, -1, 1), Flat = -Fn * 0.75 * clamp(vlat / 0.35, -1, 1);
    const FN = [Flong * hx - Flat * hy, Flong * hy + Flat * hx, -Fn], Fb = toBody(R, FN);
    X += Fb[0]; Yb += Fb[1]; Z += Fb[2];
    Lm += g.y * Fb[2] - g.z * Fb[1]; Mm += g.z * Fb[0] - g.x * Fb[2]; Nm += g.x * Fb[1] - g.y * Fb[0];
  }
  if (onG && !s.onGround) {
    const fpm = s.vd / FT * 60; s.lastSink = fpm;
    s.msg = fpm > 700 ? `Firm touchdown · ${Math.round(fpm)} fpm` : `Touchdown · ${Math.round(fpm)} fpm`;
    if (fpm > 1150) return crash(s, `Hard landing · ${Math.round(fpm)} fpm, gear collapsed`);
  }
  if (!onG && s.onGround && V > 20) s.msg = 'Airborne';
  s.onGround = onG;
  // ground drag: a wheel on the runway at rest should stay put
  if (onG && Math.hypot(s.u, s.v) < 0.25 && thr < 0.15) { s.u *= 0.9; s.v *= 0.9; }
  // --- integrate ---
  const m = ac.m;
  const udot = X / m - (s.qr * s.w - s.r * s.v), vdot = Yb / m - (s.r * s.u - s.p * s.w), wdot = Z / m - (s.p * s.v - s.qr * s.u);
  const pdot = (Lm - (ac.Izz - ac.Iyy) * s.qr * s.r) / ac.Ixx, qdot = (Mm - (ac.Ixx - ac.Izz) * s.p * s.r) / ac.Iyy, rdot = (Nm - (ac.Iyy - ac.Ixx) * s.p * s.qr) / ac.Izz;
  s.u += udot * dt; s.v += vdot * dt; s.w += wdot * dt; s.p += pdot * dt; s.qr += qdot * dt; s.r += rdot * dt;
  const dq = qmul(s.q, [0, s.p, s.qr, s.r]);
  for (let k = 0; k < 4; k++) s.q[k] += 0.5 * dq[k] * dt;
  const ql = Math.hypot(...s.q); for (let k = 0; k < 4; k++) s.q[k] /= ql;
  const R2 = dcm(s.q), vn = toNed(R2, [s.u, s.v, s.w]);
  s.n += vn[0] * dt; s.e += vn[1] * dt; s.h -= vn[2] * dt; s.vn = vn[0]; s.ve = vn[1]; s.vd = vn[2];
  // --- bookkeeping ---
  s.alpha = alpha; s.beta = beta; s.V = V; s.tas = V / KT; s.ias = V * Math.sqrt(sg) / KT; s.stall = sigma;
  s.nz = -(Z - gb[2]) / W;                                       // load factor felt by the pilot
  const aWarn = aS - 5 * D2R; s.warn = !onG && V > 12 && alpha > aWarn;
  s.spin = !onG && sigma > 0.5 && Math.abs(s.r) > 0.6 ? Math.sign(s.r) : 0;
  s.slip = clamp(-(Yb - gb[1]) / W * 6, -1, 1);                  // inclinometer ball (+ = ball right)
  const vne = s.ias > ac.vne; s.overspeed = vne;
  s.overG = !onG && (s.nz > 5.7 || s.nz < -3.0);
  if (s.ias > ac.vne * 1.12) return crash(s, 'Structural failure · exceeded Vne');
  // hard points that must not touch the ground
  if (s.h - gnd < 8) for (const hp of ac.hard) {
    const rN = toNed(R2, [hp.x, hp.y, hp.z]);
    const pen = gnd - (s.h - rN[2]);
    if (hp.soft && pen > 0 && pen < hp.soft) { s.msg = hp.what + '!'; s.qr = Math.min(s.qr, 0.05); s.h += pen * 0.5; continue; }   // a scrape, not a crash
    if (pen > 0.03) return crash(s, s.vd / FT * 60 > 1500 ? `Hit the ground at ${Math.round(V / KT)} kt` : hp.what + (hp.what === 'Belly landing' ? '' : ` at ${Math.round(V / KT)} kt`));
  }
  if (s.h < gnd - 1.5) return crash(s, 'Controlled flight into terrain');
}
function crash(s, why) { s.crashed = why; s.u = s.v = s.w = s.p = s.qr = s.r = 0; return s; }

/** Display values (knots, feet, degrees). groundM = terrain under the aircraft. */
export function readout(s, groundM = 0) {
  const e = eulerFromQ(s.q), gs = Math.hypot(s.vn, s.ve) / KT;
  return {
    ias: s.ias || 0, tas: s.tas || 0, gs, alt: s.h / FT, agl: (s.h - groundM) / FT - 4, vs: -s.vd / FT * 60,
    hdg: ((e.psi / D2R) + 360) % 360, trk: gs > 3 ? ((Math.atan2(s.ve, s.vn) / D2R) + 360) % 360 : ((e.psi / D2R) + 360) % 360,
    pitch: e.th / D2R, bank: e.phi / D2R, alpha: s.alpha / D2R, beta: s.beta / D2R, nz: s.nz, rpm: s.rpm, flap: s.flap,
    stall: s.stall, warn: s.warn, spin: s.spin, slip: s.slip, onGround: s.onGround, crashed: s.crashed, overspeed: s.overspeed, overG: s.overG,
    yawRate: s.r / D2R, buffet: s.buffet, fuelL: s.fuelL, fuelR: s.fuelR, running: s.running, starved: s.starved,
  };
}
