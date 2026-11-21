// Fly the Skyhawk: a compact hand-flown Cessna 172S simulator on a real 3D globe.
// CesiumJS (no ion) + free terrain (AWS Terrain Tiles) + USGS imagery + FAA airports and charts.
import { C172, createState, step, readout } from './fdm.js';
import { buildAircraftModel } from './model.js';
import { createTerrainProvider, elevAsync, elevSync } from './terrain.js';
import { findAirport } from './airport.js';
import { createControls } from './controls.js';
import { createHud, createMinimap, createAudio } from './hud.js';

const C = window.Cesium, D2R = Math.PI / 180, R2D = 180 / Math.PI, FT = 0.3048, KT = 0.514444, RE = 6371000;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), angDiff = (a, b) => ((b - a + 540) % 360) - 180;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services', FAA_TILES = 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services';
const SAT_TILES = USGS + '/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
const EMBED = window.parent !== window;
document.body.classList.toggle('touch', IS_TOUCH);

// ---------------------------------------------------------------- state
const sim = { flying: false, paused: false, crashedShown: false, cam: 'chase', look: { yaw: 0, pitch: 0, drag: false }, trail: [], trailT: 0, hdgS: null, fly: null, gnd: null, toastT: 0, lastMsg: '', miniT: 0 };
const opts = Object.assign({ icao: 'KLYH', rwy: null, start: 'runway', time: 'day', sky: 'few', wind: 'calm', map: 'sat', input: 'stick' }, (() => { try { return JSON.parse(localStorage.getItem('skyhawk-setup') || '{}'); } catch { return {}; } })());
let apt = null, s = null, origin = null, viewer, scene, model, meta, lights, rwyLights, clouds, layers = {};

// ---------------------------------------------------------------- world
function tiles(url, { min = 0, max = 16, credit, rect }) {
  const p = new C.UrlTemplateImageryProvider({ url, maximumLevel: max, credit, rectangle: rect, enablePickFeatures: false });
  if (min > 0) { const orig = p.requestImage.bind(p), c = document.createElement('canvas'); c.width = c.height = 1; p.requestImage = (x, y, l, r) => (l < min ? Promise.resolve(c) : orig(x, y, l, r)); }
  return p;
}
async function initWorld() {
  C.Ion.defaultAccessToken = undefined;
  viewer = new C.Viewer('globe', {
    baseLayer: false, terrainProvider: createTerrainProvider(), animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, vrButton: false,
    msaaSamples: IS_TOUCH ? 1 : 4, scene3DOnly: true, showRenderLoopErrors: false, contextOptions: { webgl: { powerPreference: 'high-performance' } },
  });
  scene = viewer.scene; const globe = scene.globe;
  viewer.clock.shouldAnimate = false; scene.screenSpaceCameraController.enableInputs = false;
  globe.depthTestAgainstTerrain = true; globe.enableLighting = true; globe.dynamicAtmosphereLighting = true; globe.dynamicAtmosphereLightingFromSun = true;   // sky follows the real sun even under moonlight
   globe.showGroundAtmosphere = true; globe.baseColor = C.Color.fromCssColorString('#0b1a24');
  globe.maximumScreenSpaceError = IS_TOUCH ? 2.4 : 1.6; globe.tileCacheSize = IS_TOUCH ? 140 : 300; globe.preloadSiblings = true;
  scene.fog.enabled = true; scene.fog.density = 2.2e-4; scene.fog.minimumBrightness = 0.06; scene.highDynamicRange = false;
  scene.postProcessStages.fxaa.enabled = IS_TOUCH; viewer.useBrowserRecommendedResolution = false; viewer.resolutionScale = Math.min(devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2);
  scene.camera.frustum.near = 0.5;
  const il = scene.imageryLayers, US = C.Rectangle.fromDegrees(-180, 13, -64, 72);
  try { layers.natural = il.addImageryProvider(await C.TileMapServiceImageryProvider.fromUrl(C.buildModuleUrl('Assets/Textures/NaturalEarthII'))); } catch (e) { console.warn('base imagery', e); }
  layers.sat = il.addImageryProvider(tiles(SAT_TILES, { max: 16, min: 3, rect: US, credit: 'Imagery: USDA / USGS The National Map' }));
  layers.topo = il.addImageryProvider(tiles(USGS + '/USGSTopo/MapServer/tile/{z}/{y}/{x}', { max: 16, min: 3, rect: US, credit: 'Map: USGS The National Map' }));
  layers.sec = il.addImageryProvider(tiles(FAA_TILES + '/VFR_Sectional/MapServer/tile/{z}/{y}/{x}', { min: 8, max: 12, rect: US, credit: 'Charts: FAA' }));
  layers.tac = il.addImageryProvider(tiles(FAA_TILES + '/VFR_Terminal/MapServer/tile/{z}/{y}/{x}', { min: 10, max: 12, rect: US, credit: 'Charts: FAA' }));
  layers.city = il.addImageryProvider(tiles('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg', { max: 8, credit: 'City lights: NASA GIBS' }));
  layers.city.dayAlpha = 0; layers.city.nightAlpha = 0.9;
  applyMap();
  // lighting: sun by day, a cool moonlight at night so the ground never goes fully black
  const moon = new C.DirectionalLight({ direction: new C.Cartesian3(0, 0, -1), color: C.Color.fromCssColorString('#8fa8d8'), intensity: 0.5 }), sun = new C.SunLight();
  sim.lighting = () => { const el = sim.sunEl ?? 30; if (el < -4) { C.Cartesian3.negate(C.Cartesian3.normalize(scene.camera.positionWC, new C.Cartesian3()), moon.direction); moon.intensity = 0.42; scene.light = moon; } else scene.light = sun; };
  scene.camera.setView({ destination: C.Cartesian3.fromDegrees(-80, 37, 3.2e6) });
  meta = buildAircraftModel('c172');
  model = await C.Model.fromGltfAsync({ url: URL.createObjectURL(new Blob([meta.glb], { type: 'model/gltf-binary' })), show: false, incrementallyLoadTextures: false, enableVerticalExaggeration: false });
  scene.primitives.add(model);
  lights = scene.primitives.add(new C.PointPrimitiveCollection());
  for (let i = 0; i < 5; i++) lights.add({ pixelSize: 5, color: C.Color.WHITE, show: false, scaleByDistance: new C.NearFarScalar(30, 1.6, 2e4, 0.6) });
  rwyLights = scene.primitives.add(new C.PointPrimitiveCollection());
  let last = performance.now();
  scene.preUpdate.addEventListener(() => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; frame(dt); });
}
function applyMap() {
  const m = opts.map;
  if (layers.sat) layers.sat.show = m !== 'topo';
  if (layers.topo) layers.topo.show = m === 'topo';
  if (layers.sec) { layers.sec.show = m === 'sectional'; layers.sec.alpha = 0.88; }
  if (layers.tac) { layers.tac.show = m === 'sectional'; layers.tac.alpha = 0.88; }
}

// ---------------------------------------------------------------- time of day + sky
function sunElevation(date, lat, lon) {
  const norm = d => ((d % 360) + 360) % 360, jd = date.getTime() / 86400000 + 2440587.5, n = jd - 2451545.0;
  const L = norm(280.46 + 0.9856474 * n), g = norm(357.528 + 0.9856003 * n) * D2R, lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, eps = (23.439 - 4e-7 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam)), ha = (norm(280.46061837 + 360.98564736629 * n) + lon) * D2R - ra;
  return Math.asin(Math.sin(lat * D2R) * Math.sin(dec) + Math.cos(lat * D2R) * Math.cos(dec) * Math.cos(ha)) * R2D;
}
function setTime(kind) {
  const lat = apt ? apt.lat : 37, lon = apt ? apt.lon : -80, d0 = new Date(); d0.setUTCHours(0, 0, 0, 0);
  const at = solarH => new Date(d0.getTime() + ((solarH - lon / 15 + 48) % 24) * 3600e3);
  let date = at(13.5);
  if (kind === 'dusk') { for (let h = 14; h < 22; h += 1 / 30) { if (sunElevation(at(h), lat, lon) < 3) { date = at(h); break; } } }
  if (kind === 'night') date = at(23.5);
  viewer.clock.currentTime = C.JulianDate.fromDate(date); sim.sunEl = sunElevation(date, lat, lon); sim.lighting();
  rwyLights.show = kind !== 'day'; if (layers.city) layers.city.show = kind !== 'day';   // city lights only cost bandwidth after sunset
  scene.skyAtmosphere.show = true; scene.sun.show = true; scene.moon.show = true;
}
function setSky(kind) {
  if (clouds) { scene.primitives.remove(clouds); clouds = null; }
  scene.fog.density = kind === 'ovc' ? 4.5e-4 : 2.2e-4;
  if (kind === 'clear' || !C.CloudCollection || !apt) return;
  clouds = scene.primitives.add(new C.CloudCollection({ noiseDetail: 16 }));
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = kind === 'ovc' ? 170 : 70, base = apt.elevFt * FT + (kind === 'ovc' ? 2600 : 4200) * FT, R = kind === 'ovc' ? 16000 : 26000;
  for (let i = 0; i < n; i++) {
    const a = rnd() * 2 * Math.PI, r = Math.sqrt(rnd()) * R, sx = (kind === 'ovc' ? 1300 : 700) + rnd() * 900, sy = sx * (0.32 + rnd() * 0.18);
    const lat = apt.lat + Math.cos(a) * r / RE * R2D, lon = apt.lon + Math.sin(a) * r / (RE * Math.cos(apt.lat * D2R)) * R2D;
    clouds.add({ position: C.Cartesian3.fromDegrees(lon, lat, base + rnd() * (kind === 'ovc' ? 120 : 500) + sy * 0.4), scale: new C.Cartesian2(sx, sy), maximumSize: new C.Cartesian3(sx * 0.9, sy, sy * 0.85), slice: 0.36 + rnd() * 0.1, brightness: kind === 'ovc' ? 0.78 : 1 });
  }
}

// ---------------------------------------------------------------- airport + runway lights
function toNE(lat, lon) { return [(lat - origin.lat) * D2R * RE, (lon - origin.lon) * D2R * RE * Math.cos(origin.lat * D2R)]; }
function toLL(n, e) { return [origin.lat + n / RE * R2D, origin.lon + e / (RE * Math.cos(origin.lat * D2R)) * R2D]; }
function offset(lat, lon, brg, m) { return [lat + Math.cos(brg * D2R) * m / RE * R2D, lon + Math.sin(brg * D2R) * m / (RE * Math.cos(lat * D2R)) * R2D]; }
async function buildRunwayLights() {
  rwyLights.removeAll(); if (!apt) return;
  for (const rw of apt.runways) {
    const [a, b] = rw.ends, hdg = a.hdg, len = rw.lengthFt * FT, half = rw.widthFt * FT / 2 + 1.5;
    const fb = apt.elevFt * FT, [ha, hb] = await Promise.all([elevAsync(a.lat, a.lon, 13).catch(() => fb), elevAsync(b.lat, b.lon, 13).catch(() => fb)]);
    const n = Math.max(2, Math.round(len / 60));
    for (let i = 0; i <= n; i++) {
      const f = i / n, [lat, lon] = offset(a.lat, a.lon, hdg, len * f), h = ha + (hb - ha) * f + 0.6;
      for (const side of [-1, 1]) { const [la, lo] = offset(lat, lon, hdg + 90 * side, half); rwyLights.add({ position: C.Cartesian3.fromDegrees(lo, la, h), pixelSize: 4, color: i === 0 || i === n ? C.Color.fromCssColorString('#4dff7a') : C.Color.fromCssColorString('#fff3c4'), scaleByDistance: new C.NearFarScalar(200, 1.5, 15000, 0.4) }); }
    }
    for (const [e, hE] of [[a, ha], [b, hb]]) for (let k = -3; k <= 3; k++) { const [la, lo] = offset(e.lat, e.lon, e.hdg + 90, k * half / 3.2); rwyLights.add({ position: C.Cartesian3.fromDegrees(lo, la, hE + 0.6), pixelSize: 5, color: C.Color.fromCssColorString('#4dff7a'), scaleByDistance: new C.NearFarScalar(200, 1.5, 15000, 0.4) }); }
  }
}

// ---------------------------------------------------------------- setup screen
const aptInfo = $('#aptInfo'), icao = $('#icao'), rwys = $('#rwys'), startBtn = $('#startBtn');
let findSeq = 0, findTimer = 0;
async function lookup() {
  const id = icao.value.trim().toUpperCase(); if (id.length < 3) { aptInfo.textContent = 'US airports, live FAA data'; aptInfo.className = ''; return; }
  const my = ++findSeq; aptInfo.textContent = 'Looking up ' + id + '…'; aptInfo.className = ''; startBtn.disabled = true;
  try {
    const a = await findAirport(id); if (my !== findSeq) return;
    if (!a) { apt = null; aptInfo.textContent = `No airport found for ${id}`; aptInfo.className = 'err'; rwys.innerHTML = '<i class="muted">—</i>'; return; }
    if (!a.runways.length) { apt = null; aptInfo.textContent = `${a.name}: no usable runway data`; aptInfo.className = 'err'; return; }
    apt = a; opts.icao = id;
    aptInfo.textContent = `${titleCase(a.name)} · ${titleCase(a.city || '')}, ${a.state || ''} · ${Math.round(a.elevFt)} ft`; aptInfo.className = 'ok';
    rwys.innerHTML = '';
    const keep = opts.rwy && opts.rwy.icao === id ? opts.rwy.name : null; let chosen = null;
    a.runways.forEach((rw, ri) => rw.ends.forEach((e, ei) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = e.name; b.title = `${Math.round(rw.lengthFt)} ft × ${Math.round(rw.widthFt)} ft`;
      b.onclick = () => { $$('#rwys button').forEach(x => x.classList.remove('on')); b.classList.add('on'); opts.rwy = { icao: id, ri, ei, name: e.name }; startBtn.disabled = false; };
      rwys.append(b); if ((keep && e.name === keep) || (!keep && !chosen && ri === 0 && ei === 0)) chosen = b;
    }));
    chosen && chosen.click();
    flyOverview();
  } catch (e) { if (my !== findSeq) return; console.warn(e); aptInfo.textContent = 'Could not reach the FAA airport service. Try again.'; aptInfo.className = 'err'; }
}
const titleCase = t => String(t).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\bIntl\b/, 'Intl');
icao.addEventListener('input', () => { icao.value = icao.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); clearTimeout(findTimer); findTimer = setTimeout(lookup, 550); });
icao.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(findTimer); lookup(); } });
$('#findApt').onclick = () => { clearTimeout(findTimer); lookup(); };
$$('.seg[data-opt]').forEach(seg => {
  const k = seg.dataset.opt, bs = [...seg.querySelectorAll('button')];
  bs.forEach(b => { b.classList.toggle('on', b.dataset.v === opts[k]); b.onclick = () => { bs.forEach(x => x.classList.remove('on')); b.classList.add('on'); opts[k] = b.dataset.v; if (k === 'map') applyMap(); }; });
});
function flyOverview() { if (!apt || sim.flying) return; scene.camera.flyTo({ destination: C.Cartesian3.fromDegrees(apt.lon, apt.lat - 0.06, apt.elevFt * FT + 5200), orientation: { heading: 0, pitch: -35 * D2R, roll: 0 }, duration: 2.2 }); }
$('#setupForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!apt || !opts.rwy) return;
  try { localStorage.setItem('skyhawk-setup', JSON.stringify(opts)); } catch { /* private mode */ }
  audio.init();
  if (IS_TOUCH && opts.input === 'tilt') { const ok = await controls.enableTilt(); if (!ok) { opts.input = 'stick'; toast('Tilt not available, using joystick'); } }
  controls.setMode(IS_TOUCH ? opts.input : 'keys');
  if (!EMBED && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  await begin();
});

// ---------------------------------------------------------------- start / restart
async function begin() {
  show('#setup', false); show('#crash', false); show('#pause', false); show('#loading', true);
  sim.flying = false; sim.paused = false; sim.crashedShown = false; sim.trail = []; sim.hdgS = null; sim.fly = null; sim.gnd = null; sim.look.yaw = sim.look.pitch = 0;
  origin = { lat: apt.lat, lon: apt.lon };
  const rw = apt.runways[opts.rwy.ri], end = rw.ends[opts.rwy.ei], other = rw.ends[1 - opts.rwy.ei];
  let lat, lon, hdg, air = opts.start === 'pattern';
  if (!air) { [lat, lon] = offset(end.lat, end.lon, end.hdg, 30); hdg = end.hdg; }
  else { const mid = [(end.lat + other.lat) / 2, (end.lon + other.lon) / 2]; [lat, lon] = offset(mid[0], mid[1], end.hdg - 90, 0.9 * 1852); hdg = (end.hdg + 180) % 360; }
  const windDir = opts.wind === 'light' ? end.hdg + 30 : end.hdg - 40;
  sim.env = { wind: { dir: (windDir + 360) % 360, kt: opts.wind === 'light' ? 9 : opts.wind === 'gusty' ? 13 : 0 }, gust: opts.wind === 'gusty' ? 1 : 0 };
  setTime(opts.time); setSky(opts.sky); applyMap(); buildRunwayLights();
  const withTimeout = (p, ms, v) => Promise.race([p.catch(() => v), new Promise(r => setTimeout(() => r(v), ms))]);
  const g0 = await withTimeout(elevAsync(lat, lon, 13), 5000, apt.elevFt * FT);
  const gh = air ? apt.elevFt * FT + 1000 * FT : g0 + C172.gear[1].z - 0.045;
  const [n, e] = toNE(lat, lon);
  s = createState({ n, e, h: gh, hdg, kt: air ? 90 : 0, onGround: !air });
  if (air) { s.pw = 0.55; s.w = s.u * 0.033; }
  controls.reset(air ? { thr: 0.55, trim: -0.08 } : { thr: 0 });
  controls.st.flaps = 0; updateFlapInd();
  sim.cam = 'chase'; model.show = true; placeModel(); updateCamera(0.016);
  // let the terrain and imagery under the aircraft stream in before the clock starts
  const t0 = performance.now();
  await new Promise(res => { const chk = () => { if ((scene.globe.tilesLoaded && performance.now() - t0 > 700) || performance.now() - t0 > 9000) res(); else setTimeout(chk, 120); }; chk(); });
  if (!air) { sim.gnd = g0; const gr = groundAt(lat, lon); s.h = gr + C172.gear[1].z - 0.045; sim.gnd = gr; }
  show('#loading', false); document.body.classList.add('flying'); sim.flying = true;
  toast(`${apt.icao || apt.ident} · RWY ${end.name}${sim.env.wind.kt ? ` · Wind ${String(Math.round(sim.env.wind.dir / 10) * 10 || 360).padStart(3, '0')}@${sim.env.wind.kt}${sim.env.gust ? 'G' + (sim.env.wind.kt + 8) : ''}` : ''}`);
  audio.resume();
}
function show(sel, on) { $(sel).classList.toggle('on', on); }

// ---------------------------------------------------------------- per frame
function groundAt(lat, lon) {
  // source elevation (exact tile data) is the truth; the rendered mesh height is used when it agrees,
  // so the wheels sit on the terrain that is actually drawn. Unloaded "fill" tiles can report nonsense.
  const src = elevSync(lat, lon, 13) ?? elevSync(lat, lon, 11), h = scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
  if (src != null) return h !== undefined && Math.abs(h - src) < 12 ? h : src;
  return sim.gnd ?? apt.elevFt * FT;                     // tile still loading: hold the last known ground
}
const NWU = C.Transforms.localFrameToFixedFrameGenerator('north', 'west');
const hpr = new C.HeadingPitchRoll(), scratchM = new C.Matrix4();
let M = new C.Matrix4(), pos = new C.Cartesian3();
function placeModel() {
  const [lat, lon] = toLL(s.n, s.e), r = readout(s, sim.gnd ?? 0);
  pos = C.Cartesian3.fromDegrees(lon, lat, s.h, C.Ellipsoid.WGS84, pos);
  hpr.heading = r.hdg * D2R; hpr.pitch = r.pitch * D2R; hpr.roll = r.bank * D2R;
  M = C.Transforms.headingPitchRollToFixedFrame(pos, hpr, C.Ellipsoid.WGS84, NWU, scratchM);
  model.modelMatrix = C.Matrix4.clone(M, model.modelMatrix);
  model.show = sim.cam !== 'cockpit';
  if (s.surf) applySurfaces(s.surf);
  const T = meta.tips, t = performance.now() / 1000, night = opts.time !== 'day';
  const P = (v, i, col, on) => { const p = lights.get(i); p.position = C.Matrix4.multiplyByPoint(M, new C.Cartesian3(v[0], v[1], v[2]), new C.Cartesian3()); p.color = col; p.show = on && sim.cam !== 'cockpit'; p.pixelSize = night ? 6 : 4; };
  P(T.left, 0, C.Color.RED, true); P(T.right, 1, C.Color.LIME, true); P(T.tail, 2, C.Color.WHITE, true);
  P(T.top, 3, C.Color.RED, t % 1.2 < 0.12); P(T.belly, 4, C.Color.WHITE, t % 1.5 < 0.06 || (t + 0.2) % 1.5 < 0.06);
  return { lat, lon, r };
}
const surfCache = {};
function applySurfaces(d) {
  if (!model.ready) return;
  for (const sf of meta.surfs) {
    const n = sf.name, deg = n.startsWith('flap') ? d.flap : n === 'ailL' ? d.ail * 18 : n === 'ailR' ? -d.ail * 18 : n.startsWith('elev') ? -d.elev * 24 : d.rud * 24, th = (n === 'rud' ? 1 : sf.sgn) * deg * D2R;
    if (Math.abs((surfCache[n] ?? 9) - th) < 0.004) continue; surfCache[n] = th;
    try { const node = model.getNode(n); if (node) node.matrix = C.Matrix4.fromRotationTranslation(C.Matrix3.fromQuaternion(C.Quaternion.fromAxisAngle(new C.Cartesian3(...sf.axis), th)), new C.Cartesian3(...sf.hinge)); } catch { /* node api */ }
  }
}
const v3 = (x, y, z) => new C.Cartesian3(x, y, z);
function updateCamera(dt) {
  const cam = scene.camera, r = readout(s, sim.gnd ?? 0);
  if (!sim.look.drag) { sim.look.yaw += -sim.look.yaw * Math.min(1, dt * 2.5); sim.look.pitch += -sim.look.pitch * Math.min(1, dt * 2.5); }
  if (sim.cam === 'chase') {
    // straight behind the aircraft along its (smoothed) heading, camera level, so the horizon stays put
    sim.hdgS = sim.hdgS == null ? r.hdg : (sim.hdgS + angDiff(sim.hdgS, r.hdg) * Math.min(1, dt * 3.2) + 360) % 360;
    const enu = C.Transforms.eastNorthUpToFixedFrame(pos), yaw = (sim.hdgS + sim.look.yaw) * D2R, lp = sim.look.pitch * D2R;
    const f = [Math.sin(yaw), Math.cos(yaw)], D = 24, up = 2.5 + Math.sin(lp) * D;
    const eye = C.Matrix4.multiplyByPoint(enu, v3(-f[0] * D * Math.cos(lp), -f[1] * D * Math.cos(lp), up), new C.Cartesian3());
    const tgt = C.Matrix4.multiplyByPoint(enu, v3(f[0] * 90, f[1] * 90, 2.1), new C.Cartesian3());
    // never below the terrain
    const ec = C.Cartographic.fromCartesian(eye), gh = scene.globe.getHeight(ec);
    if (gh !== undefined && ec.height < gh + 1.5) { ec.height = gh + 1.5; C.Cartographic.toCartesian(ec, C.Ellipsoid.WGS84, eye); }
    const dir = C.Cartesian3.normalize(C.Cartesian3.subtract(tgt, eye, new C.Cartesian3()), new C.Cartesian3());
    const upv = C.Matrix4.multiplyByPointAsVector(enu, v3(0, 0, 1), new C.Cartesian3());
    const right = C.Cartesian3.normalize(C.Cartesian3.cross(dir, upv, new C.Cartesian3()), new C.Cartesian3());
    cam.setView({ destination: eye, orientation: { direction: dir, up: C.Cartesian3.cross(right, dir, new C.Cartesian3()) } });
    cam.frustum.fov = 62 * D2R;
  } else if (sim.cam === 'cockpit') {
    const yaw = sim.look.yaw * D2R, pit = (sim.look.pitch - 3) * D2R;
    const eye = C.Matrix4.multiplyByPoint(M, v3(0.3, 0.27, 0.62), new C.Cartesian3());
    const dir = C.Matrix4.multiplyByPointAsVector(M, v3(Math.cos(pit) * Math.cos(yaw), -Math.cos(pit) * Math.sin(yaw), Math.sin(pit)), new C.Cartesian3());
    const up = C.Matrix4.multiplyByPointAsVector(M, v3(-Math.sin(pit) * Math.cos(yaw), Math.sin(pit) * Math.sin(yaw), Math.cos(pit)), new C.Cartesian3());
    cam.setView({ destination: eye, orientation: { direction: C.Cartesian3.normalize(dir, dir), up: C.Cartesian3.normalize(up, up) } });
    cam.frustum.fov = 72 * D2R;
  } else {
    // fly-by: park the camera ahead of the aircraft, beside its path, and watch it pass
    if (!sim.fly || C.Cartesian3.distance(sim.fly, pos) > 520) {
      const enu = C.Transforms.eastNorthUpToFixedFrame(pos), tr = (Math.hypot(s.vn, s.ve) > 3 ? Math.atan2(s.ve, s.vn) : r.hdg * D2R), side = Math.random() < 0.5 ? -1 : 1;
      const p = C.Matrix4.multiplyByPoint(enu, v3(Math.sin(tr) * 280 + Math.cos(tr) * 40 * side, Math.cos(tr) * 280 - Math.sin(tr) * 40 * side, -s.vd * 4 + 4), new C.Cartesian3());
      const c = C.Cartographic.fromCartesian(p), gh = groundAt(c.latitude * R2D, c.longitude * R2D); if (c.height < gh + 3) { c.height = gh + 3; C.Cartographic.toCartesian(c, C.Ellipsoid.WGS84, p); }
      sim.fly = p;
    }
    const dir = C.Cartesian3.normalize(C.Cartesian3.subtract(pos, sim.fly, new C.Cartesian3()), new C.Cartesian3());
    const upv = C.Cartesian3.normalize(sim.fly, new C.Cartesian3()), right = C.Cartesian3.normalize(C.Cartesian3.cross(dir, upv, new C.Cartesian3()), new C.Cartesian3());
    cam.setView({ destination: sim.fly, orientation: { direction: dir, up: C.Cartesian3.cross(right, dir, new C.Cartesian3()) } });
    cam.frustum.fov = clamp(40 * 120 / Math.max(60, C.Cartesian3.distance(sim.fly, pos)), 22, 55) * D2R;
  }
}
const chipsEl = $('#chips'); let chipsKey = '';
function frame(dt) {
  if (!s || !model) return;
  if (sim.flying && !sim.paused) {
    const c = controls.update(dt), [lat, lon] = toLL(s.n, s.e);
    let g = groundAt(lat, lon); if (sim.gnd != null) g = sim.gnd + clamp(g - sim.gnd, -30 * dt, 30 * dt); sim.gnd = g;
    for (let k = 0; k < (sim.timeScale || 1); k++) step(s, c, dt, { ground: g, wind: sim.env.wind, gust: sim.env.gust });   // timeScale: test hook
  }
  const { lat, lon, r } = placeModel();
  if (sim.flying) updateCamera(dt);
  if (!sim.flying) return;
  hud.draw(r, { touch: IS_TOUCH, thr: controls.st.thr, trim: controls.st.trim, cam: sim.cam });
  audio.update(r, sim.paused);
  // status chips
  const chips = [];
  if (r.spin) chips.push(['SPIN', 'red']); else if (r.warn) chips.push(['STALL', 'red']);
  if (r.overspeed) chips.push(['VNE', 'red']); if (r.overG) chips.push(['G', 'red']);
  if (controls.st.brk) chips.push(['BRK', 'amber']);
  if (sim.env.wind.kt && sim.cam) chips.push([`${String(Math.round(sim.env.wind.dir / 10) * 10 || 360).padStart(3, '0')}/${sim.env.wind.kt}`, '']);
  const key = chips.map(c => c.join()).join('|'); if (key !== chipsKey) { chipsKey = key; chipsEl.innerHTML = chips.map(([t, c]) => `<b class="${c}">${t}</b>`).join(''); }
  if (s.msg && s.msg !== sim.lastMsg) { sim.lastMsg = s.msg; toast(s.msg); setTimeout(() => { if (sim.lastMsg === s.msg) { s.msg = ''; sim.lastMsg = ''; } }, 2500); }
  const now = performance.now();
  if (now - sim.trailT > 1500) { sim.trailT = now; sim.trail.push([lat, lon]); if (sim.trail.length > 500) sim.trail.shift(); }
  if (now - sim.miniT > 150 && !$('#minimap').classList.contains('off')) { sim.miniT = now; minimap.draw(lat, lon, r.hdg, sim.trail.concat([[lat, lon]]), apt.runways); }
  if (s.crashed && !sim.crashedShown) { sim.crashedShown = true; setTimeout(() => { $('#crashWhy').textContent = s.crashed; show('#crash', true); }, 1300); }
}

// ---------------------------------------------------------------- actions
let toastTimer = 0;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2600); }
function updateFlapInd() { $('#flapInd').textContent = C172.flapDeg[controls.st.flaps] + '°'; }
function pause(on) {
  if (!sim.flying || (s && s.crashed)) return; sim.paused = on; show('#pause', on);
  on ? audio.suspend() : audio.resume();
}
const CAMS = ['chase', 'cockpit', 'flyby'];
function act(a) {
  const helpOpen = $('#help').classList.contains('on');
  switch (a) {
    case 'pause': if (helpOpen) return act('closeHelp'); pause(!sim.paused); break;
    case 'resume': pause(false); break;
    case 'escape': if (helpOpen) act('closeHelp'); else if ($('#setup').classList.contains('on')) { if (sim.flying) { show('#setup', false); pause(true); } else act('exit'); } else if (sim.flying) pause(!sim.paused); break;
    case 'cam': sim.cam = CAMS[(CAMS.indexOf(sim.cam) + 1) % CAMS.length]; sim.fly = null; sim.hdgS = null; toast({ chase: 'Chase view', cockpit: 'Cockpit view', flyby: 'Fly-by view' }[sim.cam]); break;
    case 'flapsDown': controls.st.flaps = Math.min(3, controls.st.flaps + 1); updateFlapInd(); break;
    case 'flapsUp': controls.st.flaps = Math.max(0, controls.st.flaps - 1); updateFlapInd(); break;
    case 'map': opts.map = { sat: 'sectional', sectional: 'topo', topo: 'sat' }[opts.map]; applyMap(); toast({ sat: 'Satellite', sectional: 'VFR sectional', topo: 'Topo map' }[opts.map]); syncSeg('map'); break;
    case 'time': opts.time = { day: 'dusk', dusk: 'night', night: 'day' }[opts.time]; setTime(opts.time); toast({ day: 'Day', dusk: 'Dusk', night: 'Night' }[opts.time]); syncSeg('time'); break;
    case 'mini': $('#minimap').classList.toggle('off'); break;
    case 'sound': audio.on = !audio.on; $('#bar').dataset.sound = audio.on ? 'on' : 'off'; if (!audio.on) audio.suspend(); break;
    case 'help': if (!sim.flying) return; show('#help', !helpOpen); if (!helpOpen && !sim.paused) { sim.helpPaused = true; sim.paused = true; } break;
    case 'closeHelp': show('#help', false); if (sim.helpPaused) { sim.helpPaused = false; sim.paused = false; } break;
    case 'recenter': controls.recenter(); toast('Tilt centered'); break;
    case 'restart': if (apt && opts.rwy) begin(); break;
    case 'setup': sim.paused = true; show('#pause', false); show('#crash', false); show('#setup', true); document.body.classList.remove('flying'); sim.flying = false; audio.suspend(); break;
    case 'exit':
      audio.suspend(); sim.paused = true;
      if (EMBED) window.parent.postMessage({ type: 'skyhawk:exit' }, '*');
      else { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); location.href = '../#flight-sim'; }
      break;
  }
}
function syncSeg(k) { $$(`.seg[data-opt=${k}] button`).forEach(b => b.classList.toggle('on', b.dataset.v === opts[k])); }
$$('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
document.addEventListener('visibilitychange', () => { if (document.hidden && sim.flying && !sim.paused) pause(true); });
window.addEventListener('message', e => { if (e.source === window.parent && e.data && e.data.type === 'skyhawk:pause' && sim.flying) pause(true); });

// mouse drag to look around (desktop)
const gEl = $('#globe');
gEl.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' || !sim.flying) return; sim.look.drag = { x: e.clientX, y: e.clientY, yaw: sim.look.yaw, pitch: sim.look.pitch }; gEl.setPointerCapture(e.pointerId); });
gEl.addEventListener('pointermove', e => { const d = sim.look.drag; if (!d) return; sim.look.yaw = clamp(d.yaw + (e.clientX - d.x) * 0.35, -170, 170); sim.look.pitch = clamp(d.pitch - (e.clientY - d.y) * 0.25, -40, 60); });
gEl.addEventListener('pointerup', () => { sim.look.drag = false; });

// ---------------------------------------------------------------- boot
const controls = createControls({ onAction: act }), hud = createHud($('#hud')), minimap = createMinimap($('#minimap'), SAT_TILES), audio = createAudio();
if (IS_TOUCH) $('#minimap').width = $('#minimap').height = 240;
else $('#minimap').width = $('#minimap').height = 300;
await initWorld();
icao.value = opts.icao || ''; if (icao.value) lookup();
setTimeout(() => { if (!IS_TOUCH) icao.focus({ preventScroll: true }); }, 300);
window.__sim = { sim, opts, get s() { return s; }, get apt() { return apt; }, act, readout: () => s && readout(s), viewer: () => viewer, controls };
