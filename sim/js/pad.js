// Phone / tablet cockpit for Fly the Skyhawk. Cessna 172S controls: split ALT/BAT master, avionics
// bus switches, light switches, key ignition, push-pull throttle and red mixture, fuel selector and
// shutoff, elevator trim wheel, flap lever, rudder pedals with toe brakes and parking brake. The yoke
// is the phone's tilt. Controls stream to the computer over WebRTC (PeerJS); the tach and fuel gauges
// come back. Adapted from the cockpit in David's 3D Flight Sim (Frenchbear1/3D-Flight-Sim).
const $ = id => document.getElementById(id), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PREFIX = 'skyhawk-dl-';
const room = (location.hash.slice(1) || new URLSearchParams(location.search).get('room') || '').replace(/[^A-Za-z0-9]/g, '');
const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const saved = (() => { try { return JSON.parse(localStorage.getItem('skyhawk-pad') || '{}'); } catch { return {}; } })();
const opt = Object.assign({ invP: false, invR: false, sens: 1, tilt: true }, saved), save = () => { try { localStorage.setItem('skyhawk-pad', JSON.stringify(opt)); } catch { /* private mode */ } };
const ctl = { a: 0, e: 0, r: 0, th: 0, mx: 1, fl: 0, brkL: 0, brkR: 0, park: 1, pt: 0, ign: 3, eng: true, sel: 'B', shutoff: false, bat: true, alt: true, avn: true, lights: { nav: true, bcn: true, strobe: true, land: false, taxi: false }, cmd: null };
const sw = { alt: true, bat: true, bus1: true, bus2: true, pump: false, bcn: true, land: false, taxi: false, nav: true, strobe: true, pitot: false };
let tel = null, cmdId = 0, lastOk = 0, tiltOk = false, base = null, raw = { u: 1, r: 0, z: 0 }, touchStick = null, keyPos = 3, crank = 0, engMsg = '', conn = null, peer = null;
const buzz = (ms = 10) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* unsupported */ } };
const draws = [];

// ---------- push-pull engine controls (in = up, out = toward you) ----------
function pushPull(id, key, fmt) {
  const el = $(id), track = el.querySelector('.track'), knob = el.querySelector('.knob'), shaft = el.querySelector('.shaft'), val = el.querySelector('.val');
  const geo = () => { const H = track.clientHeight, R = knob.offsetWidth / 2 || 20; return { y0: 11 + R * 0.62, y1: H - R * 1.12 }; };
  const draw = () => { const g = geo(), y = g.y0 + (1 - ctl[key]) * (g.y1 - g.y0); knob.style.top = y + 'px'; knob.style.transform = `translate(-50%,-50%) scale(${1 + (1 - ctl[key]) * 0.13})`; shaft.style.height = Math.max(0, y - 9) + 'px'; val.textContent = fmt(ctl[key]); };
  let grab = 0;
  const set = e => { const g = geo(), r = track.getBoundingClientRect(); let v = clamp(1 - (e.clientY - r.top - grab - g.y0) / (g.y1 - g.y0), 0, 1); if (v > 0.975) v = 1; if (v < 0.025) v = 0; if ((v === 0 || v === 1) && v !== ctl[key]) buzz(14); ctl[key] = v; draw(); };
  track.addEventListener('pointerdown', e => { track.setPointerCapture(e.pointerId); const g = geo(), r = track.getBoundingClientRect(), ky = g.y0 + (1 - ctl[key]) * (g.y1 - g.y0), d = e.clientY - r.top - ky; grab = Math.abs(d) < knob.offsetWidth * 0.7 ? d : 0; set(e); });
  track.addEventListener('pointermove', e => { if (track.hasPointerCapture(e.pointerId)) set(e); });
  new ResizeObserver(draw).observe(track); draw(); draws.push(draw);
}
pushPull('lvTh', 'th', v => Math.round(v * 100) + '%'); pushPull('lvMx', 'mx', v => (v < 0.08 ? 'IDLE CUT-OFF' : v > 0.97 ? 'RICH' : Math.round(v * 100) + '%'));

// ---------- rocker switches, laid out like the 172S switch panel ----------
const ROW_A = [['alt', 'ALT', 'red'], ['bat', 'BAT', 'red'], ['bus1', 'Avionics<br>bus 1'], ['bus2', 'Avionics<br>bus 2'], ['pump', 'Fuel<br>pump']], ROW_B = [['bcn', 'BCN'], ['land', 'LAND'], ['taxi', 'TAXI'], ['nav', 'NAV'], ['strobe', 'STROBE'], ['pitot', 'Pitot<br>heat']];
function rockers() {
  const mk = ([k, label, cls]) => `<button class="rk ${cls || ''} ${sw[k] ? 'on' : ''}" data-sw="${k}"><b></b><span class="plac">${label}</span><i></i></button>`;
  $('swA').innerHTML = `<div class="pair">${ROW_A.slice(0, 2).map(mk).join('')}</div><div class="pair">${ROW_A.slice(2, 4).map(mk).join('')}</div>` + mk(ROW_A[4]); $('swB').innerHTML = ROW_B.map(mk).join('');
  document.querySelectorAll('[data-sw]').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); const k = b.dataset.sw; sw[k] = !sw[k]; if (k === 'bat' && !sw.bat) sw.alt = false; if (k === 'alt' && sw.alt) sw.bat = true; buzz(8); rockers(); }));
  const p = sw.bat; Object.assign(ctl, { bat: sw.bat, alt: sw.alt, avn: sw.bus1 || sw.bus2 });
  ctl.lights = { nav: p && sw.nav, bcn: p && sw.bcn, strobe: p && sw.strobe, land: p && sw.land, taxi: p && sw.taxi };
}
rockers();
// ---------- key ignition: OFF  R  L  BOTH  START ----------
{ const K = $('key'), names = ['OFF', 'R', 'L', 'BOTH', 'START'], ang = [-72, -36, 0, 36, 72];
  names.forEach((n, i) => { const s = document.createElement('span'), a = (ang[i] - 90) * Math.PI / 180; s.textContent = n; s.style.left = 50 + Math.cos(a) * 47 + '%'; s.style.top = 52 + Math.sin(a) * 45 + '%'; s.dataset.i = i; K.appendChild(s); });
  const show = () => { $('keyB').style.transform = `rotate(${ang[keyPos]}deg)`; K.querySelectorAll('span').forEach(s => s.classList.toggle('cur', +s.dataset.i === keyPos)); };
  let hold = 0, moved = false;
  K.addEventListener('pointerdown', e => { e.preventDefault(); K.setPointerCapture(e.pointerId); const r = K.getBoundingClientRect(), right = e.clientX > r.left + r.width / 2; moved = false; clearTimeout(hold);
    if (right && keyPos === 3) hold = setTimeout(() => { keyPos = 4; moved = true; buzz(30); show(); }, 220);
    K._right = right; });
  const up = () => { clearTimeout(hold); if (keyPos === 4) { keyPos = 3; crank = 0; } else if (!moved) { keyPos = clamp(keyPos + (K._right ? 1 : -1), 0, 3); buzz(8); } show(); };
  K.addEventListener('pointerup', up); K.addEventListener('pointercancel', up); show(); draws.push(show); }
function engine(dt) {            // small engine-management model; fuel starvation is decided by the simulator
  if (keyPos === 0) { if (ctl.eng) engMsg = 'Magnetos OFF: engine stopped'; ctl.eng = false; }
  else if (ctl.mx < 0.08 && ctl.eng) { ctl.eng = false; engMsg = 'Mixture at idle cut-off: engine stopped'; }
  else if (tel && tel.starved && ctl.eng) { ctl.eng = false; engMsg = tel.fuelL + tel.fuelR < 0.2 ? 'Out of fuel: engine stopped' : 'Fuel starvation: engine stopped'; }
  if (keyPos === 4 && !ctl.eng) {
    if (!sw.bat) engMsg = 'No start: MASTER (BAT) is off';
    else if (ctl.mx < 0.3) engMsg = 'Cranking… push the MIXTURE in (rich)';
    else if (ctl.shutoff) engMsg = 'Cranking… FUEL SHUTOFF is pulled';
    else if (tel && tel.noFuel) engMsg = 'Cranking… no fuel to the engine';
    else { crank += dt; engMsg = 'Cranking…'; if (crank > 1.1) { ctl.eng = true; crank = 0; engMsg = ''; buzz(60); } }
  } else if (!ctl.eng && keyPos !== 0 && !/Cranking|No start|stopped/.test(engMsg)) engMsg = 'Engine off: key to BOTH, then press and hold for START';
  if (ctl.eng) engMsg = '';
  ctl.ign = Math.min(keyPos, 3);
}
// ---------- rudder pedals, toe brakes, trim, flaps, fuel ----------
{ const el = $('rud'), k = $('rudK'); const set = v => { ctl.r = v; k.style.left = 50 + v * 32 + '%'; };
  const mv = e => { const r = el.getBoundingClientRect(); set(clamp(((e.clientX - r.left) / r.width - 0.5) * 2.4, -1, 1)); };
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); mv(e); }); el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) mv(e); });
  const up = () => set(0); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); }
for (const [id, key] of [['bBrkL', 'brkL'], ['bBrkR', 'brkR']]) { const b = $(id); const dn = e => { e.preventDefault(); ctl[key] = 1; b.classList.add('on'); }, up = () => { ctl[key] = 0; b.classList.remove('on'); }; b.addEventListener('pointerdown', dn); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up); }
{ const el = $('ptW'); let last = null, acc = 0; const show = () => { el.style.backgroundPositionY = ctl.pt * 150 + 'px'; $('ptI').style.top = 50 + ctl.pt * 36 + '%'; };
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); last = e.clientY; });
  el.addEventListener('pointermove', e => { if (last == null) return; const d = e.clientY - last; last = e.clientY; ctl.pt = clamp(ctl.pt + d * 0.0045, -1, 1); acc += Math.abs(d); if (acc > 14) { acc = 0; buzz(4); } show(); });   // roll the wheel down (toward you) = nose up
  const up = () => (last = null); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); draws.push(show); show(); }
{ const T = $('flT'), K = $('flK'), pos = [12, 37, 62, 88]; const show = () => (K.style.top = pos[ctl.fl] + '%');
  const set = e => { const r = T.getBoundingClientRect(), p = (e.clientY - r.top) / r.height * 100; let b = 0; pos.forEach((v, i) => { if (Math.abs(v - p) < Math.abs(pos[b] - p)) b = i; }); if (b !== ctl.fl) { ctl.fl = b; buzz(16); show(); } };
  T.addEventListener('pointerdown', e => { T.setPointerCapture(e.pointerId); set(e); }); T.addEventListener('pointermove', e => { if (T.hasPointerCapture(e.pointerId)) set(e); }); show(); draws.push(show); }
{ const S = $('sel'), ang = { L: -60, B: 0, R: 60 }; const show = () => { $('selH').style.transform = `rotate(${ang[ctl.sel]}deg)`; S.querySelectorAll('span').forEach(s => s.classList.toggle('cur', s.dataset.v === ctl.sel)); };
  S.addEventListener('pointerdown', e => { e.preventDefault(); const r = S.getBoundingClientRect(), f = (e.clientX - r.left) / r.width; const v = f < 0.36 ? 'L' : f > 0.64 ? 'R' : 'B'; if (v !== ctl.sel) { ctl.sel = v; buzz(18); show(); } }); show(); draws.push(show); }
$('shut').onclick = () => { ctl.shutoff = !ctl.shutoff; $('shut').classList.toggle('off', ctl.shutoff); buzz(16); };
$('bPark').onclick = () => { ctl.park = ctl.park ? 0 : 1; buzz(); };
$('bCenter').onclick = () => recenter();
const cmd = t => { ctl.cmd = { id: ++cmdId + '-' + Date.now(), type: t }; buzz(); };
$('bCam').onclick = () => cmd('cam');
$('bMore').onclick = () => ($('shMore').hidden = false); $('shMore').addEventListener('click', e => { if (e.target === $('shMore')) $('shMore').hidden = true; });
document.querySelectorAll('[data-cmd]').forEach(b => (b.onclick = () => { const t = b.dataset.cmd; cmd(t);
  if (t.startsWith('restart')) { Object.assign(ctl, { th: t === 'restart-air' ? 0.55 : 0, park: t === 'restart-air' ? 0 : 1, fl: 0, pt: 0, mx: 1, eng: true, sel: 'B', shutoff: false }); keyPos = 3; Object.assign(sw, { bat: true, alt: true, bus1: true, bus2: true }); $('shut').classList.remove('off'); rockers(); draws.forEach(d => d()); base = null; $('shMore').hidden = true; } }));
const optUi = () => { $('invPL').textContent = opt.invP ? 'inverted' : 'normal'; $('invRL').textContent = opt.invR ? 'inverted' : 'normal'; $('sensL').textContent = opt.sens > 1.2 ? 'high' : opt.sens < 0.8 ? 'low' : 'normal'; $('bTilt').style.color = opt.tilt && tiltOk ? '#52e07f' : ''; };
$('bInvP').onclick = () => { opt.invP = !opt.invP; save(); optUi(); }; $('bInvR').onclick = () => { opt.invR = !opt.invR; save(); optUi(); };
$('bSens').onclick = () => { opt.sens = opt.sens > 1.2 ? 0.65 : opt.sens < 0.8 ? 1 : 1.5; save(); optUi(); };
$('bTilt').onclick = async () => { if (!tiltOk) await enableTilt(); else opt.tilt = !opt.tilt; save(); optUi(); };
$('bFull').onclick = () => { const d = document.documentElement; try { (document.fullscreenElement ? document.exitFullscreen() : d.requestFullscreen && d.requestFullscreen())?.catch?.(() => {}); } catch { /* unsupported */ } };

// ---------- tilt = yoke ----------
function onMotion(ev) {
  const g = ev.accelerationIncludingGravity; if (!g || g.x == null) return;
  const s = iOS ? -1 : 1, m = Math.hypot(g.x, g.y, g.z) || 1, x = g.x * s / m, y = g.y * s / m, z = g.z * s / m;   // iOS reports the opposite sign
  const ang = (screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : +window.orientation || 90), flip = ang === 270 || ang === -90;
  const u = flip ? -x : x, r = flip ? y : -y, k = tiltOk ? 0.35 : 1;
  raw.u += (u - raw.u) * k; raw.r += (r - raw.r) * k; raw.z += (z - raw.z) * k; tiltOk = true;
}
function recenter() { base = null; buzz(25); $('tiltState').textContent = 'tilt centered'; setTimeout(() => { if ($('tiltState').textContent === 'tilt centered') $('tiltState').textContent = ''; }, 1500); }
async function enableTilt() {
  try {
    if (typeof DeviceMotionEvent === 'undefined') throw new Error('no motion sensors in this browser');
    if (typeof DeviceMotionEvent.requestPermission === 'function') { const r = await DeviceMotionEvent.requestPermission(); if (r !== 'granted') throw new Error('motion permission was declined'); }
    window.addEventListener('devicemotion', onMotion); opt.tilt = true;
    setTimeout(() => { if (!tiltOk) $('tiltState').textContent = 'no tilt data: drag the gauges'; optUi(); }, 1500);
    return true;
  } catch (e) { $('tiltState').textContent = 'Tilt off: ' + e.message; return false; }
}
function readTilt() {
  if (touchStick) { ctl.a = touchStick.a; ctl.e = touchStick.e; return; }
  if (!tiltOk || !opt.tilt) { ctl.a = 0; ctl.e = 0; return; }
  if (!base) base = { u: raw.u, r: raw.r, z: raw.z };
  const dp = Math.atan2(base.u * raw.z - base.z * raw.u, base.u * raw.u + base.z * raw.z);
  const dr = Math.asin(clamp(base.r, -1, 1)) - Math.asin(clamp(raw.r, -1, 1)), dz = v => (Math.abs(v) < 0.04 ? 0 : v - Math.sign(v) * 0.04);
  const ex = (v, p) => Math.sign(v) * Math.abs(v) ** p;   // full aileron at ~65 deg of wheel-turn, full elevator at ~40 deg of tip; gentle around centre
  const a = ex(clamp(dz(dr) / (1.13 / opt.sens), -1, 1), 1.8) * (opt.invR ? -1 : 1), e = ex(clamp(-dz(dp) / (0.7 / opt.sens), -1, 1), 1.8) * (opt.invP ? -1 : 1);
  ctl.a += (a - ctl.a) * 0.5; ctl.e += (e - ctl.e) * 0.5;
}
{ let t = 0; const free = el => !el.closest('.track,#rud,.toes,#ptW,#flT,#key,#sel,button,.sheet,#start');
  document.addEventListener('touchstart', e => { clearTimeout(t); if (e.touches.length === 2 && [...e.touches].every(x => free(x.target))) t = setTimeout(recenter, 350); }, { passive: true });
  const stop = e => { if (e.touches.length < 2) clearTimeout(t); }; document.addEventListener('touchend', stop, { passive: true }); document.addEventListener('touchcancel', stop, { passive: true }); }
{ const w = $('inst'), st = $('stick'); let o = null; const ex2 = v => Math.sign(v) * v * v;
  w.addEventListener('pointerdown', e => { if (tiltOk && opt.tilt) return; w.setPointerCapture(e.pointerId); o = [e.clientX, e.clientY]; touchStick = { a: 0, e: 0 }; st.hidden = false; const r = w.getBoundingClientRect(); st.style.left = o[0] - r.left + 'px'; st.style.top = o[1] - r.top + 'px'; });
  w.addEventListener('pointermove', e => { if (!o) return; const R = Math.min(w.clientWidth, w.clientHeight) * 0.38; const ax = clamp((e.clientX - o[0]) / R, -1, 1), ey = clamp((e.clientY - o[1]) / R, -1, 1); touchStick = { a: ex2(ax), e: ex2(ey) }; const r = w.getBoundingClientRect(); st.style.left = clamp(o[0] - r.left + ax * R, 0, r.width) + 'px'; st.style.top = clamp(o[1] - r.top + ey * R, 0, r.height) + 'px'; });
  const up = () => { o = null; touchStick = null; st.hidden = true; }; w.addEventListener('pointerup', up); w.addEventListener('pointercancel', up); }

// ---------- gauges ----------
function gauge(cv, draw) {
  const g = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); draw(g, W, H);
}
function face(g, cx, cy, R) { g.fillStyle = '#0a0b0c'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill(); g.strokeStyle = '#3c4043'; g.lineWidth = R * 0.07; g.stroke(); }
function needle(g, cx, cy, R, a) { g.save(); g.translate(cx, cy); g.rotate(a); g.fillStyle = '#f4f4ee'; g.beginPath(); g.moveTo(-R * 0.04, R * 0.12); g.lineTo(0, -R * 0.86); g.lineTo(R * 0.04, R * 0.12); g.closePath(); g.fill(); g.restore(); g.fillStyle = '#2b2e30'; g.beginPath(); g.arc(cx, cy, R * 0.08, 0, 7); g.fill(); }
function drawTach(rpm, on) {
  gauge($('tach'), (g, W, H) => {
    const R = Math.min(W, H) / 2 - 2, cx = W / 2, cy = H / 2, a0 = -0.75 * Math.PI - Math.PI / 2, a1 = 0.75 * Math.PI - Math.PI / 2, A = v => a0 + (a1 - a0) * v / 3500;
    face(g, cx, cy, R);
    const arc = (v0, v1, col, w = 0.09) => { g.strokeStyle = col; g.lineWidth = R * w; g.beginPath(); g.arc(cx, cy, R * 0.8, A(v0), A(v1)); g.stroke(); };
    arc(2100, 2700, '#2fbf5a'); arc(2690, 2710, '#e0261a', 0.16);
    g.fillStyle = '#e9e7dc'; g.font = `700 ${R * 0.16}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let v = 0; v <= 3500; v += 500) { const a = A(v); g.strokeStyle = '#e9e7dc'; g.lineWidth = R * 0.03; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9); g.lineTo(cx + Math.cos(a) * R * 0.7, cy + Math.sin(a) * R * 0.7); g.stroke(); if (v % 1000 === 0 || v === 500) g.fillText(v / 100, cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55); }
    g.font = `700 ${R * 0.1}px Arial`; g.fillText('RPM', cx, cy + R * 0.34); g.fillText('×100', cx, cy + R * 0.48);
    needle(g, cx, cy, R, A(clamp(rpm, 0, 3500)) + Math.PI / 2);
    if (!on) { g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill(); }
  });
}
function drawFuel(id, gal, label, powered) {
  gauge($(id), (g, W, H) => {
    const R = Math.min(W, H * 1.1) / 2 - 2, cx = W / 2, cy = H * 0.58, a0 = -Math.PI * 0.8, a1 = -Math.PI * 0.2, A = f => a0 + (a1 - a0) * f;
    g.fillStyle = '#0a0b0c'; g.strokeStyle = '#3c4043'; g.lineWidth = 3; g.beginPath(); g.roundRect ? g.roundRect(2, 2, W - 4, H - 4, 8) : g.rect(2, 2, W - 4, H - 4); g.fill(); g.stroke();
    g.strokeStyle = '#e0261a'; g.lineWidth = R * 0.09; g.beginPath(); g.arc(cx, cy, R * 0.8, A(0), A(5 / 26.5)); g.stroke();
    g.strokeStyle = '#e9e7dc'; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { const a = A(i / 4); g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9); g.lineTo(cx + Math.cos(a) * R * 0.7, cy + Math.sin(a) * R * 0.7); g.stroke(); }
    g.fillStyle = '#e9e7dc'; g.font = `800 ${R * 0.17}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('E', cx + Math.cos(A(0)) * R * 0.52, cy + Math.sin(A(0)) * R * 0.52); g.fillText('F', cx + Math.cos(A(1)) * R * 0.52, cy + Math.sin(A(1)) * R * 0.52);
    g.font = `700 ${R * 0.13}px Arial`; g.fillText('FUEL · ' + label, cx, cy + R * 0.2); g.font = `700 ${R * 0.12}px ui-monospace,monospace`; g.fillStyle = '#fff36a'; g.fillText(powered ? gal.toFixed(1) + ' GAL' : '', cx, cy + R * 0.38);
    if (powered) { g.save(); g.translate(cx, cy); g.rotate(A(clamp(gal / 26.5, 0, 1)) + Math.PI / 2); g.fillStyle = '#f4f4ee'; g.beginPath(); g.moveTo(-R * 0.03, 0); g.lineTo(0, -R * 0.88); g.lineTo(R * 0.03, 0); g.fill(); g.restore(); }
  });
}

// ---------- link (WebRTC through the free PeerJS broker) ----------
function connect() {
  if (!window.Peer) { $('msg').textContent = 'Could not load the pairing library. Check your connection.'; return; }
  if (!peer || peer.destroyed) {
    peer = new window.Peer({ debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } });
    peer.on('open', dial);
    peer.on('error', e => { $('dot').className = ''; $('msg').textContent = e.type === 'peer-unavailable' ? 'Simulator not found: open the QR code on the computer again.' : 'Pairing service: ' + e.type; setTimeout(dial, 2500); });
    peer.on('disconnected', () => setTimeout(() => { try { peer.reconnect(); } catch { /* retry */ } }, 1500));
  } else dial();
}
function dial() {
  if (!peer || peer.disconnected) return;
  if (conn && conn.open) return;
  $('dot').className = 'wait'; $('msg').textContent = 'Connecting to the simulator…';
  const c = conn = peer.connect(PREFIX + room, { serialization: 'json', reliable: true });
  setTimeout(() => { if (conn === c && !c.open) { try { c.close(); } catch { /* not open */ } conn = null; dial(); } }, 10000);   // a stalled attempt: try again
  c.on('open', () => { $('dot').className = 'on'; lastOk = Date.now(); $('msg').textContent = 'Connected: press Start on the computer'; });
  c.on('data', d => { if (!d) return; lastOk = Date.now(); if (d.t === 'tel') { tel = d.d; tel.at = Date.now(); } else if (d.t === 'hi' && (!tel || Date.now() - tel.at > 2000)) { $('dot').className = 'on'; $('msg').textContent = 'Connected: press Start on the computer'; } });
  c.on('close', () => { if (conn !== c) return; conn = null; $('dot').className = ''; $('msg').textContent = 'Lost the simulator. Reconnecting…'; setTimeout(dial, 1500); });
}
function loop() {
  let prev = performance.now();
  setInterval(() => {
    const t0 = performance.now(); engine(Math.min(0.3, (t0 - prev) / 1000)); prev = t0; readTilt();
    if (conn && conn.open) { try { conn.send({ t: 'ctl', c: ctl }); } catch { /* closing */ } }
    if (Date.now() - lastOk > 4000 && conn && conn.open) { $('dot').className = 'wait'; $('msg').textContent = 'Waiting for the simulator…'; }
    if (Date.now() - lastOk > 12000 && conn && conn.open) { try { conn.close(); } catch { /* closing */ } }   // the computer went away: reconnect
  }, 40);
}
function render() {
  requestAnimationFrame(render);
  const t = tel || { rpm: 0, fuelL: 0, fuelR: 0 }, powered = sw.bat || (sw.alt && ctl.eng);
  drawTach(t.rpm || 0, true); drawFuel('fuelL', t.fuelL || 0, 'LEFT', powered); drawFuel('fuelR', t.fuelR || 0, 'RIGHT', powered);
  $('bPark').classList.toggle('set', !!ctl.park);
  const an = [];
  if (tel) {
    if (tel.crashed) an.push(['red', tel.crashed.toUpperCase()]);
    else {
      if (tel.warn) an.push(['red', 'STALL']);
      if (powered) { if (!ctl.eng || tel.rpm < 500) an.push(['red', 'OIL PRESS']); if (tel.fuelL < 5) an.push(['amb', 'LOW FUEL L']); if (tel.fuelR < 5) an.push(['amb', 'LOW FUEL R']); if (!sw.alt) an.push(['amb', 'LOW VOLTS']); }
      if (tel.paused) an.push(['amb', 'PAUSED']); if (ctl.park && tel.onGround) an.push(['amb', 'PARK BRAKE']);
    }
  }
  $('ann').innerHTML = an.map(([c, x]) => `<span class="an ${c}">${x}</span>`).join('');
  if (Date.now() - lastOk < 3000 && tel && Date.now() - tel.at < 2000) $('msg').textContent = tel.crashed ? 'MENU → Restart to try again' : engMsg || tel.msg || (tel.onGround ? 'On the ground' : 'Flying');
  if (tel && tel.crashed && navigator.vibrate && !render.v) { render.v = 1; navigator.vibrate([120, 60, 200]); } if (tel && !tel.crashed) render.v = 0;
}
// ---------- start ----------
if (!room) { $('startMsg').textContent = 'This page needs the link from the simulator. In Fly the Skyhawk on your computer, press Phone cockpit and scan the QR code.'; $('go').hidden = true; }
$('go').onclick = async () => {
  await enableTilt(); $('start').remove(); optUi(); draws.forEach(d => d());
  try { if (navigator.wakeLock) { let wl = await navigator.wakeLock.request('screen'); document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') wl = await navigator.wakeLock.request('screen').catch(() => wl); }); } } catch { /* optional */ }
  try { const d = document.documentElement; if (!iOS && d.requestFullscreen) await d.requestFullscreen().catch(() => {}); screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch { /* optional */ }
  connect(); loop(); render();
};
window.__pad = { ctl, sw, get tel() { return tel; }, get conn() { return conn; } };
// ---------- no zooming (iOS Safari ignores the viewport setting) ----------
{ let lastTap = 0;
  document.addEventListener('touchend', e => { const now = Date.now(); if (now - lastTap < 400) { e.preventDefault(); const b = e.target.closest && e.target.closest('button'); if (b) b.click(); } lastTap = now; }, { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  for (const t of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) document.addEventListener(t, e => e.preventDefault(), { passive: false }); }
