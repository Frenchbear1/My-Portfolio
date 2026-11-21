// Minimal HUD (speed tape, altitude tape with VSI, heading strip, slip ball, power/trim gauges),
// a north-up moving map from USGS imagery tiles, and engine + stall-horn sound.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pad3 = n => String(Math.round(((n % 360) + 360) % 360) || 360).padStart(3, '0');

export function createHud(canvas) {
  const g = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; canvas.width = W * dpr; canvas.height = H * dpr; };
  resize(); addEventListener('resize', resize);
  const font = (w, s) => `${w} ${s}px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;
  function box(x, y, w, h, r = 10) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

  function tape(x, y, w, h, val, step, label, side, extra) {
    g.save(); box(x, y, w, h, 12); g.fillStyle = 'rgba(7,17,38,.45)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,.22)'; g.stroke(); g.clip();
    const pxPer = h / (step * 6), cy = y + h / 2;
    if (extra) extra(cy, pxPer);
    g.fillStyle = '#fff'; g.font = font(600, 12); g.textBaseline = 'middle';
    const base = Math.floor(val / step) * step;
    for (let v = base - step * 4; v <= base + step * 4; v += step / 2) {
      const yy = cy - (v - val) * pxPer, major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.5; g.beginPath();
      if (side === 'l') { g.moveTo(x + w - (major ? 12 : 7), yy); g.lineTo(x + w, yy); } else { g.moveTo(x, yy); g.lineTo(x + (major ? 12 : 7), yy); }
      g.stroke();
      if (major && v >= 0) { g.textAlign = side === 'l' ? 'right' : 'left'; g.fillText(String(v), side === 'l' ? x + w - 16 : x + 16, yy); }
    }
    g.restore();
    // readout window
    const rw = w + 8, rh = 30, rx = side === 'l' ? x - 2 : x - 6;
    box(rx, cy - rh / 2, rw, rh, 8); g.fillStyle = '#04101f'; g.fill(); g.strokeStyle = '#ffc857'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#fff'; g.font = font(800, 17); g.textAlign = 'center'; g.fillText(String(Math.round(val)), rx + rw / 2, cy + 1);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.font = font(700, 10); g.fillText(label, x + w / 2, y - 9);
  }

  function draw(r, ui) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    // tapes sit clear of the minimap (top right), the icon bar and, on touch screens, the stick and throttle
    const small = W < 760 || H < 480, tw = small ? 58 : 70, top = ui.touch ? (small ? 60 : 140) : 190;
    const th = clamp(Math.min(H * 0.36, H - top - (ui.touch ? 70 : 150)), 110, 300), ty = Math.max(top, H * 0.42 - th / 2);
    const lx = ui.touch ? (small ? 164 : 190) : 24, rx = W - tw - (ui.touch ? (small ? 140 : 150) : 24);
    // speed tape with white/green/yellow arcs as bands
    tape(lx, ty, tw, th, r.ias, 10, 'KIAS', 'l', (cy, pp) => {
      const band = (a, b, col, off) => { g.fillStyle = col; const y1 = cy - (b - r.ias) * pp, y2 = cy - (a - r.ias) * pp; g.fillRect(lx + tw - off, y1, 5, y2 - y1); };
      band(40, 85, '#f4f7ff', 5); band(48, 129, '#3ddc84', 10); band(129, 163, '#ffc857', 10); band(163, 400, '#ff5d5d', 10);
    });
    tape(rx, ty, tw, th, r.alt, 100, 'FT', 'r');
    // VSI pointer beside the altitude tape
    const vsx = rx - 14, vcy = ty + th / 2, vy = clamp(-r.vs / 2000, -1, 1) * th * 0.45;
    g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 2; g.beginPath(); g.moveTo(vsx, ty + th * 0.05); g.lineTo(vsx, ty + th * 0.95); g.stroke();
    g.strokeStyle = Math.abs(r.vs) > 1500 ? '#ffc857' : '#5aa9ff'; g.lineWidth = 5; g.beginPath(); g.moveTo(vsx, vcy); g.lineTo(vsx, vcy + vy); g.stroke();
    g.fillStyle = '#fff'; g.font = font(700, 11); g.textAlign = 'center'; g.fillText((r.vs > 0 ? '+' : '') + Math.round(r.vs / 10) * 10, rx + tw / 2, ty + th + 16);
    g.fillText(`GS ${Math.round(r.gs)}`, lx + tw / 2, ty + th + 16);
    if (r.agl < 2500 && !r.onGround) { g.fillStyle = '#9ff0c0'; g.fillText(`AGL ${Math.max(0, Math.round(r.agl / 10) * 10)}`, rx + tw / 2, ty + th + 32); }
    // heading strip
    const hw = Math.min(small ? 260 : 360, W * 0.5), hx = W / 2 - hw / 2, hy = 10 + (ui.st || 0);
    g.save(); box(hx, hy, hw, 34, 10); g.fillStyle = 'rgba(7,17,38,.45)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1; g.stroke(); g.clip();
    const ppd = hw / 70; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let d = Math.floor((r.hdg - 40) / 5) * 5; d <= r.hdg + 40; d += 5) {
      const x = W / 2 + (d - r.hdg) * ppd, maj = d % 10 === 0; g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, hy + 34); g.lineTo(x, hy + 34 - (maj ? 9 : 5)); g.stroke();
      if (d % 30 === 0) { const n = ((d % 360) + 360) % 360; g.fillStyle = '#fff'; g.font = font(700, 12); g.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] ?? String(n / 10), x, hy + 12); }
    }
    // track marker
    const tx = W / 2 + clamp(((r.trk - r.hdg + 540) % 360) - 180, -34, 34) * ppd; g.fillStyle = '#ff5ad8'; g.beginPath(); g.arc(tx, hy + 30, 3, 0, 7); g.fill();
    g.restore();
    box(W / 2 - 26, hy + 36, 52, 22, 7); g.fillStyle = '#04101f'; g.fill(); g.strokeStyle = '#ffc857'; g.stroke();
    g.fillStyle = '#fff'; g.font = font(800, 14); g.textAlign = 'center'; g.fillText(pad3(r.hdg), W / 2, hy + 48);
    // slip ball under the speed tape
    const bx = lx + tw / 2, by = ty + th + (small ? 36 : 40), bw = 64;
    box(bx - bw / 2, by - 9, bw, 18, 9); g.fillStyle = 'rgba(7,17,38,.5)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,.35)'; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.moveTo(bx - 9, by - 9); g.lineTo(bx - 9, by + 9); g.moveTo(bx + 9, by - 9); g.lineTo(bx + 9, by + 9); g.stroke();
    g.fillStyle = Math.abs(r.slip) > 0.5 ? '#ffc857' : '#fff'; g.beginPath(); g.arc(bx + r.slip * (bw / 2 - 9), by, 7, 0, 7); g.fill();
    // power + trim micro gauges (desktop: under the altitude tape; touch shows its own throttle)
    if (!ui.touch) {
      const gx = rx + tw / 2, gy = ty + th + 42;
      g.fillStyle = 'rgba(255,255,255,.75)'; g.font = font(700, 11); g.fillText(`${Math.round(r.rpm / 10) * 10} RPM`, gx, gy);
      const bw2 = tw; box(gx - bw2 / 2, gy + 9, bw2, 6, 3); g.fillStyle = 'rgba(255,255,255,.18)'; g.fill(); box(gx - bw2 / 2, gy + 9, bw2 * ui.thr, 6, 3); g.fillStyle = '#5aa9ff'; g.fill();
    }
    // trim indicator (small vertical bar left of the speed tape)
    const tix = lx + tw + 10, tiy = ty + th * 0.3, tih = th * 0.4;
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(tix, tiy, 3, tih); g.fillStyle = '#3ddc84'; g.beginPath(); g.arc(tix + 1.5, tiy + tih / 2 - ui.trim * tih / 2, 5, 0, 7); g.fill();
    // cockpit view: horizon reference + flight path marker
    if (ui.cam === 'cockpit') {
      g.strokeStyle = 'rgba(255,200,87,.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2 - 40, H / 2); g.lineTo(W / 2 - 12, H / 2); g.lineTo(W / 2, H / 2 + 8); g.lineTo(W / 2 + 12, H / 2); g.lineTo(W / 2 + 40, H / 2); g.stroke();
    }
  }
  return { draw };
}

// ---------------- moving map ----------------
export function createMinimap(canvas, tileUrl) {
  const g = canvas.getContext('2d'), cache = new Map(); let zoom = 13;
  canvas.addEventListener('click', () => { zoom = zoom === 13 ? 11 : zoom === 11 ? 15 : 13; });
  const tile = (z, x, y) => {
    const k = z + '/' + x + '/' + y; let im = cache.get(k);
    if (!im) { im = new Image(); im.decoding = 'async'; im.src = tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y); cache.set(k, im); if (cache.size > 120) cache.delete(cache.keys().next().value); }
    return im.complete && im.naturalWidth ? im : null;
  };
  const merc = (lat, lon, z) => { const n = 256 * 2 ** z, s = Math.sin(lat * Math.PI / 180); return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; };
  function draw(lat, lon, hdg, trail, runways) {
    const S = canvas.width, c = S / 2, [px, py] = merc(lat, lon, zoom);
    g.save(); g.clearRect(0, 0, S, S); g.beginPath(); g.arc(c, c, c, 0, 7); g.clip(); g.fillStyle = '#16303a'; g.fillRect(0, 0, S, S);
    const tx0 = Math.floor((px - c) / 256), ty0 = Math.floor((py - c) / 256), tx1 = Math.floor((px + c) / 256), ty1 = Math.floor((py + c) / 256);
    for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) { const im = tile(zoom, x, y); if (im) g.drawImage(im, x * 256 - px + c, y * 256 - py + c, 256, 256); }
    g.fillStyle = 'rgba(4,16,31,.18)'; g.fillRect(0, 0, S, S);
    // runways
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    for (const rw of runways || []) { const [a, b] = rw.ends.map(e => merc(e.lat, e.lon, zoom)); g.lineWidth = Math.max(3, rw.widthFt * 0.3048 / (156543 * Math.cos(lat * Math.PI / 180) / 2 ** zoom)); g.beginPath(); g.moveTo(a[0] - px + c, a[1] - py + c); g.lineTo(b[0] - px + c, b[1] - py + c); g.stroke(); }
    // trail
    if (trail.length > 1) { g.strokeStyle = 'rgba(255,90,216,.9)'; g.lineWidth = 3; g.beginPath(); trail.forEach((p, i) => { const [x, y] = merc(p[0], p[1], zoom); i ? g.lineTo(x - px + c, y - py + c) : g.moveTo(x - px + c, y - py + c); }); g.stroke(); }
    // aircraft
    g.translate(c, c); g.rotate(hdg * Math.PI / 180); g.fillStyle = '#ffc857'; g.strokeStyle = '#04101f'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -20); g.lineTo(4, -6); g.lineTo(20, 2); g.lineTo(20, 6); g.lineTo(4, 4); g.lineTo(3, 14); g.lineTo(8, 18); g.lineTo(-8, 18); g.lineTo(-3, 14); g.lineTo(-4, 4); g.lineTo(-20, 6); g.lineTo(-20, 2); g.lineTo(-4, -6); g.closePath(); g.stroke(); g.fill();
    g.restore();
    g.fillStyle = '#fff'; g.font = '800 22px ui-monospace,monospace'; g.textAlign = 'center'; g.fillText('N', c, 26);
  }
  return { draw };
}

// ---------------- sound ----------------
export function createAudio() {
  let ctx = null, eng, engGain, noiseGain, horn, hornGain, filt, on = true;
  function init() {
    if (ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC(); const master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
    eng = ctx.createOscillator(); eng.type = 'sawtooth'; filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 420;
    engGain = ctx.createGain(); engGain.gain.value = 0; eng.connect(filt); filt.connect(engGain); engGain.connect(master); eng.start();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const nz = ctx.createBufferSource(); nz.buffer = buf; nz.loop = true; const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.6;
    noiseGain = ctx.createGain(); noiseGain.gain.value = 0; nz.connect(nf); nf.connect(noiseGain); noiseGain.connect(master); nz.start();
    horn = ctx.createOscillator(); horn.type = 'square'; horn.frequency.value = 780; const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1500;
    hornGain = ctx.createGain(); hornGain.gain.value = 0; horn.connect(hf); hf.connect(hornGain); hornGain.connect(master); horn.start();
  }
  function update(r, paused) {
    if (!ctx) return; const t = ctx.currentTime, live = on && !paused && !r.crashed;
    eng.frequency.setTargetAtTime(r.rpm / 60 * 2, t, 0.08); filt.frequency.setTargetAtTime(250 + r.rpm * 0.18, t, 0.1);
    engGain.gain.setTargetAtTime(live ? 0.05 + 0.07 * clamp((r.rpm - 600) / 2100, 0, 1) : 0, t, 0.08);
    noiseGain.gain.setTargetAtTime(live ? clamp(r.tas / 140, 0, 1) * 0.12 + 0.02 : 0, t, 0.15);
    hornGain.gain.setTargetAtTime(live && r.warn ? 0.06 : 0, t, 0.03);
  }
  return {
    init, update,
    set on(v) { on = v; if (ctx) (v ? ctx.resume() : null); }, get on() { return on; },
    suspend() { ctx?.suspend(); }, resume() { if (on) ctx?.resume(); },
  };
}
