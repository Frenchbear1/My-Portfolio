// A small pannable / zoomable map (drag or one finger to pan, wheel or pinch to zoom, tap to place a
// marker). Used to drop the airplane anywhere. P(e) and R(el) translate pointer coordinates when the
// page is rotated by the landscape lock (see orient.js).
export function createSlippy(canvas, { tileUrl, maxZ = 16, onPick, P = e => ({ x: e.clientX, y: e.clientY }), R = el => el.getBoundingClientRect() }) {
  const g = canvas.getContext('2d'), cache = new Map();
  const v = { lat: 37, lon: -79, z: 10, mark: null, hdg: 0, plane: null, url: tileUrl, maxZ };
  const merc = (lat, lon, z) => { const n = 256 * 2 ** z, s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; };
  const unmerc = (x, y, z) => { const n = 256 * 2 ** z, lon = x / n * 360 - 180, t = Math.PI * (1 - 2 * y / n); return [Math.atan(Math.sinh(t)) * 180 / Math.PI, lon]; };
  const tile = (z, x, y) => {
    const n = 2 ** z; x = ((x % n) + n) % n; if (y < 0 || y >= n) return null;
    const k = v.url + z + '/' + x + '/' + y; let im = cache.get(k);
    if (!im) { im = new Image(); im.decoding = 'async'; im.onload = () => draw(); im.src = v.url.replace('{z}', z).replace('{x}', x).replace('{y}', y); cache.set(k, im); if (cache.size > 220) cache.delete(cache.keys().next().value); }
    return im.complete && im.naturalWidth ? im : null;
  };
  let W = 0, H = 0, dpr = 1;
  function size() { dpr = Math.min(2, devicePixelRatio || 1); W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  function arrow(x, y, hdg, col, sc = 1) { g.save(); g.translate(x, y); g.rotate(hdg * Math.PI / 180); g.scale(sc, sc); g.fillStyle = col; g.strokeStyle = '#04101f'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -20); g.lineTo(4, -6); g.lineTo(20, 2); g.lineTo(20, 6); g.lineTo(4, 4); g.lineTo(3, 14); g.lineTo(8, 18); g.lineTo(-8, 18); g.lineTo(-3, 14); g.lineTo(-4, 4); g.lineTo(-20, 6); g.lineTo(-20, 2); g.lineTo(-4, -6); g.closePath(); g.stroke(); g.fill(); g.restore(); }
  function draw() {
    if (!W) size(); if (!W) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#16303a'; g.fillRect(0, 0, W, H);
    const tz = Math.min(Math.round(v.z), v.maxZ), k = 2 ** (v.z - tz), [cx, cy] = merc(v.lat, v.lon, tz), ts = 256 * k;
    const x0 = Math.floor((cx - W / 2 / k) / 256), x1 = Math.floor((cx + W / 2 / k) / 256), y0 = Math.floor((cy - H / 2 / k) / 256), y1 = Math.floor((cy + H / 2 / k) / 256);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const im = tile(tz, x, y); if (im) g.drawImage(im, W / 2 + (x * 256 - cx) * k, H / 2 + (y * 256 - cy) * k, ts + 0.5, ts + 0.5); }
    const at = (lat, lon) => { const [x, y] = merc(lat, lon, v.z), [ox, oy] = merc(v.lat, v.lon, v.z); return [W / 2 + x - ox, H / 2 + y - oy]; };
    if (v.plane) { const [x, y] = at(v.plane.lat, v.plane.lon); arrow(x, y, v.plane.hdg, 'rgba(255,255,255,.75)', 0.8); }
    if (v.mark) { const [x, y] = at(v.mark.lat, v.mark.lon); g.strokeStyle = '#ffc857'; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath(); g.arc(x, y, 30, 0, 7); g.stroke(); g.setLineDash([]); arrow(x, y, v.hdg, '#ffc857', 1.1); }
    g.fillStyle = 'rgba(4,16,31,.7)'; g.fillRect(0, H - 18, 120, 18); g.fillStyle = '#fff'; g.font = '600 10px ui-monospace,monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(`${v.lat.toFixed(3)}, ${v.lon.toFixed(3)}`, 6, H - 9);
  }
  // pointers: drag to pan, pinch to zoom, tap to place
  const pts = new Map(); let moved = 0, pinch = null;
  const local = e => { const p = P(e), r = R(canvas); return [p.x - r.left, p.y - r.top]; };
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: v.z }; } });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; const prev = pts.get(e.pointerId), cur = local(e); pts.set(e.pointerId, cur);
    if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; v.z = Math.max(3, Math.min(17, pinch.z + Math.log2(Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d))); moved = 99; draw(); return; }
    const dx = cur[0] - prev[0], dy = cur[1] - prev[1]; moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) { const [x, y] = merc(v.lat, v.lon, v.z); [v.lat, v.lon] = unmerc(x - dx, y - dy, v.z); draw(); }
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return; const p = pts.get(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
    if (moved <= 6 && pts.size === 0) { const [x, y] = merc(v.lat, v.lon, v.z); const [lat, lon] = unmerc(x + p[0] - W / 2, y + p[1] - H / 2, v.z); v.mark = { lat, lon }; draw(); onPick && onPick(v.mark); }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = null; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); v.z = Math.max(3, Math.min(17, v.z - e.deltaY * 0.002)); draw(); }, { passive: false });
  new ResizeObserver(() => { size(); draw(); }).observe(canvas);
  return { v, draw, size, zoom(d) { v.z = Math.max(3, Math.min(17, Math.round(v.z) + d)); draw(); }, center(lat, lon, z) { v.lat = lat; v.lon = lon; if (z) v.z = z; draw(); } };
}
