// Pilot inputs: keyboard (smoothed so taps give small corrections), on-screen joystick, rudder
// pedals, throttle slider, brakes and trim for touch screens, and device tilt as the yoke.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const toward = (v, t, rate, dt) => v + clamp(t - v, -rate * dt, rate * dt);
const expo = (v, p) => Math.sign(v) * Math.abs(v) ** p;      // soft around centre, full deflection still available

export function createControls({ onAction, orient }) {
  const OP = e => orient.P(e), OR = el => orient.R(el);
  const keys = new Set();
  const st = { de: 0, da: 0, dr: 0, thr: 0, brk: 0, trim: 0, flaps: 0 }, raw = { de: 0, da: 0 };
  const touch = { x: 0, y: 0, active: false, rud: 0, brk: 0, trimDir: 0 };
  const tilt = { on: false, roll: 0, pitch: 0, ref: null, raw: null, ok: false };
  let mode = 'keys';
  const DOWN = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, KeyA: 1, KeyD: 1, KeyW: 1, KeyS: 1, Space: 1, KeyQ: 1, KeyE: 1, KeyZ: 1, KeyX: 1, KeyI: 1, ShiftLeft: 1, ControlLeft: 1, PageUp: 1, PageDown: 1 };
  const ACT = { KeyF: 'flapsDown', KeyV: 'flapsUp', KeyC: 'cam', KeyP: 'pause', KeyM: 'map', KeyN: 'time', KeyK: 'mini', KeyH: 'help', KeyU: 'sound', Escape: 'escape', KeyR: 'restart' };
  addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (DOWN[e.code]) { keys.add(e.code); e.preventDefault(); }
    else if (ACT[e.code] && !e.repeat) { onAction(ACT[e.code]); e.preventDefault(); }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // ----- joystick -----
  const stick = document.getElementById('stick'), knob = document.getElementById('knob');
  let stickId = null;
  const stickMove = e => {
    const r = OR(stick), R = r.width / 2;
    let x = (OP(e).x - r.left - R) / (R * 0.78), y = (OP(e).y - r.top - R) / (R * 0.78); const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    touch.x = x; touch.y = y; knob.style.transform = `translate(${x * R * 0.78}px,${y * R * 0.78}px)`;
  };
  stick.addEventListener('pointerdown', e => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); touch.active = true; stickMove(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
  const stickUp = e => { if (e.pointerId !== stickId) return; stickId = null; touch.active = false; touch.x = touch.y = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', stickUp); stick.addEventListener('pointercancel', stickUp);

  // ----- hold buttons -----
  const hold = (id, on, off) => {
    const el = document.getElementById(id);
    const down = e => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); el.classList.add('on'); on(); };
    const up = () => { el.classList.remove('on'); off(); };
    el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
  };
  hold('rudL', () => { touch.rud = -1; }, () => { if (touch.rud < 0) touch.rud = 0; });
  hold('rudR', () => { touch.rud = 1; }, () => { if (touch.rud > 0) touch.rud = 0; });
  hold('brake', () => { touch.brk = 1; }, () => { touch.brk = 0; });
  hold('crankBtn', () => { touch.crank = 1; }, () => { touch.crank = 0; });
  hold('trimUp', () => { touch.trimDir = 1; }, () => { touch.trimDir = 0; });
  hold('trimDn', () => { touch.trimDir = -1; }, () => { touch.trimDir = 0; });

  // ----- throttle slider -----
  const thr = document.getElementById('throttle'), fill = document.getElementById('thrFill'), tk = document.getElementById('thrKnob');
  let thrId = null;
  const thrMove = e => { const r = OR(thr); st.thr = clamp(1 - (OP(e).y - r.top - 13) / (r.height - 26), 0, 1); };
  thr.addEventListener('pointerdown', e => { thrId = e.pointerId; thr.setPointerCapture(e.pointerId); thrMove(e); });
  thr.addEventListener('pointermove', e => { if (e.pointerId === thrId) thrMove(e); });
  thr.addEventListener('pointerup', () => { thrId = null; });
  const drawThr = () => { const h = thr.clientHeight - 26; tk.style.transform = `translateY(${-st.thr * h}px)`; fill.style.height = (st.thr * h + 13) + 'px'; };

  // ----- device tilt (gravity direction in screen axes, so any orientation works) -----
  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
    const up = [-Math.sin(g) * Math.cos(b), Math.sin(b), Math.cos(g) * Math.cos(b)];   // earth "up" in device axes
    orient.up({ x: up[0], y: up[1] });
    const ang = orient.angle() * Math.PI / 180;        // the landscape the cockpit is locked to, even if the browser flipped to portrait
    const ux = up[0] * Math.cos(ang) - up[1] * Math.sin(ang), uy = up[0] * Math.sin(ang) + up[1] * Math.cos(ang), uz = up[2];
    tilt.raw = { roll: Math.asin(clamp(-ux, -1, 1)), pitch: Math.atan2(uy, uz) };
    if (!tilt.ref) tilt.ref = { ...tilt.raw };
    tilt.ok = true;
  }
  async function enableTilt() {
    try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') return false; } } catch { return false; }
    addEventListener('deviceorientation', onOrient); tilt.on = true; tilt.ref = null; return true;
  }
  const recenter = () => { tilt.ref = tilt.raw ? { ...tilt.raw } : null; };

  // ----- per-frame update -----
  function update(dt) {
    const k = c => keys.has(c);
    // keyboard: hold to deflect further, release to centre
    const pitchKey = (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0), rollKey = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0);
    const rudKey = (k('KeyD') || k('KeyX') ? 1 : 0) - (k('KeyA') || k('KeyZ') ? 1 : 0);
    let de, da, dr;
    if (mode === 'tilt' && tilt.ok && tilt.ref) {
      let r = tilt.raw.roll - tilt.ref.roll, p = tilt.ref.pitch - tilt.raw.pitch;
      const dz = (v, z) => Math.sign(v) * Math.max(0, Math.abs(v) - z);
      // full aileron at about 65 degrees of wheel-turn, full elevator at about 40 degrees of tip
      da = expo(clamp(dz(r, 0.04) / 1.13, -1, 1), 1.8); de = expo(clamp(dz(p, 0.04) / 0.7, -1, 1), 1.8);
      st.de = toward(st.de, de, 6, dt); st.da = toward(st.da, da, 8, dt);
    } else if (touch.active) {
      st.de = toward(st.de, expo(touch.y, 2.1), 6, dt); st.da = toward(st.da, expo(touch.x, 1.9), 8, dt);
    } else {
      // keys build up deflection gradually (about 1.7 s to full) and the output is shaped, so taps are small corrections
      raw.de = pitchKey ? toward(raw.de, pitchKey, pitchKey * raw.de < 0 ? 3 : 0.6, dt) : toward(raw.de, 0, 2.4, dt);
      raw.da = rollKey ? toward(raw.da, rollKey, rollKey * raw.da < 0 ? 4 : 0.9, dt) : toward(raw.da, 0, 3.5, dt);
      st.de = expo(raw.de, 1.8); st.da = expo(raw.da, 1.6);
    }
    dr = rudKey || touch.rud; st.dr = dr ? toward(st.dr, dr, dr * st.dr < 0 ? 5 : 2.2, dt) : toward(st.dr, 0, 3.5, dt);
    if (k('KeyW') || k('ShiftLeft') || k('PageUp')) st.thr = clamp(st.thr + dt * 0.55, 0, 1);
    if (k('KeyS') || k('ControlLeft') || k('PageDown')) st.thr = clamp(st.thr - dt * 0.55, 0, 1);
    st.brk = k('Space') || touch.brk ? 1 : 0; st.crank = k('KeyI') || !!touch.crank;
    const trimDir = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0) || touch.trimDir;
    if (trimDir) st.trim = clamp(st.trim + trimDir * dt * 0.28, -1, 1);
    drawThr();
    return st;
  }
  return {
    st, update, enableTilt, recenter,
    setMode(m) { mode = m; document.body.classList.toggle('tilt', m === 'tilt'); },
    get mode() { return mode; },
    reset(o = {}) { raw.de = raw.da = 0; Object.assign(st, { de: 0, da: 0, dr: 0, thr: 0, brk: 0, trim: 0, flaps: 0 }, o); keys.clear(); },
  };
}
