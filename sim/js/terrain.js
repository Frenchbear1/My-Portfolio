// Free global 3D terrain without Cesium ion: AWS Open Data "Terrain Tiles" (Terrarium PNG),
// decoded in workers and fed to Cesium's CustomHeightmapTerrainProvider. The same tile cache
// answers elevation queries for flight planning (terrain profile, AGL, airspace floors).
const TERRAIN_URL = window.SKYHAWK_TERRAIN || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';   // override used by offline tests
const C = window.Cesium;
const MAX_Z = 13, SAMPLE_Z = 11, N = 65, CACHE_MAX = [260, 120, 70][window.SKYHAWK_LITE || 0];
const cache = new Map();            // key -> Int16Array | Promise
let workers = [], rr = 0, seq = 0; const pending = new Map();
export const terrainStats = { ok: 0, fail: 0 };

function initWorkers() {
  const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./terrain-worker.js', import.meta.url));
    w.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.data); };
    workers.push(w);
  }
}
// one request to a worker, with a timeout: a single stalled download must never hold the globe hostage
function request(url, ms) {
  return new Promise((res, rej) => {
    const id = ++seq, timer = setTimeout(() => { if (pending.delete(id)) rej(new Error('timeout')); }, ms);
    pending.set(id, { res: d => { clearTimeout(timer); res(d); }, rej: e => { clearTimeout(timer); rej(e); } });
    workers[rr++ % workers.length].postMessage({ id, url });
  });
}
function loadTile(z, x, y) {
  const key = z + '/' + x + '/' + y, hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit instanceof Int16Array ? Promise.resolve(hit) : hit; }
  if (!workers.length) initWorkers();
  const n = 1 << z, url = new URL(TERRAIN_URL.replace('{z}', z).replace('{x}', ((x % n) + n) % n).replace('{y}', y), location.href).href;
  const p = request(url, 8000).catch(() => request(url, 10000)).catch(() => request(url, 14000))
    .then(d => { cache.set(key, d); terrainStats.ok++; return d; })
    .catch(() => { terrainStats.fail++; cache.delete(key); return new Int16Array(65536); });    // give up for now (not cached, so it is retried later)
  cache.set(key, p);
  if (cache.size > CACHE_MAX) { const k = cache.keys().next().value; if (cache.get(k) instanceof Int16Array) cache.delete(k); }
  return p;
}
function bilinear(d, fx, fy) {
  fx = fx < 0 ? 0 : fx > 255 ? 255 : fx; fy = fy < 0 ? 0 : fy > 255 ? 255 : fy;
  const x0 = fx | 0, y0 = fy | 0, x1 = x0 < 255 ? x0 + 1 : 255, y1 = y0 < 255 ? y0 + 1 : 255, tx = fx - x0, ty = fy - y0;
  const a = d[y0 * 256 + x0], b = d[y0 * 256 + x1], c = d[y1 * 256 + x0], e = d[y1 * 256 + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
}
export function createTerrainProvider() {
  return new C.CustomHeightmapTerrainProvider({
    width: N, height: N, tilingScheme: new C.WebMercatorTilingScheme(),
    credit: 'Terrain: Terrain Tiles (AWS Open Data) — USGS 3DEP, SRTM, GMTED2010, ETOPO1',
    callback: async (x, y, level) => {
      const zs = Math.min(level, MAX_Z), sh = level - zs, sx = x >> sh, sy = y >> sh;
      const d = await loadTile(zs, sx, sy);
      const scale = 1 / (1 << sh), ox = (x - (sx << sh)) * scale * 256, oy = (y - (sy << sh)) * scale * 256, span = 256 * scale;
      const out = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
        out[j * N + i] = bilinear(d, ox + (i / (N - 1)) * span - 0.5, oy + (j / (N - 1)) * span - 0.5);
      return out;
    },
  });
}
function tileXY(lat, lon, z) {
  const n = 1 << z, s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}
/** Elevation in metres MSL (async, fetches the tile if needed). */
export async function elevAsync(lat, lon, z = SAMPLE_Z) {
  const [fx, fy] = tileXY(lat, lon, z), x = Math.floor(fx), y = Math.floor(fy);
  const d = await loadTile(z, x, y);
  return bilinear(d, (fx - x) * 256 - 0.5, (fy - y) * 256 - 0.5);
}
/** Elevation in metres if the tile is already cached, else null (never blocks a frame). */
export function elevSync(lat, lon, z = SAMPLE_Z) {
  const [fx, fy] = tileXY(lat, lon, z), x = Math.floor(fx), y = Math.floor(fy);
  const d = cache.get(z + '/' + x + '/' + y);
  if (!(d instanceof Int16Array)) { if (!d) loadTile(z, x, y); return null; }
  return bilinear(d, (fx - x) * 256 - 0.5, (fy - y) * 256 - 0.5);
}
export async function elevMany(points, z = SAMPLE_Z) {   // [[lat,lon],...] -> Float32Array metres
  const out = new Float32Array(points.length);
  await Promise.all(points.map(async (p, i) => { out[i] = await elevAsync(p[0], p[1], z); }));
  return out;
}
