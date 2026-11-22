// Fly the Skyhawk: a compact hand-flown Cessna 172S simulator on a real 3D globe.
// CesiumJS (no ion) + free terrain (AWS Terrain Tiles) + USGS imagery + FAA airports and charts.
import { C172, createState, step, readout, configure, autoTrim, trimmed } from './fdm.js?v=3';
import { STATIONS, compute as wbCompute, defaults as wbDefaults, drawEnvelope } from './wb.js';
import { createLink } from './link.js?v=2';
import { createOrient } from './orient.js';
import { createSlippy } from './slippy.js';
import { createClouds } from './clouds.js?v=3';
import { buildAircraftModel } from './model.js?v=2';
import { createTerrainProvider, elevAsync, elevSync } from './terrain.js?v=3';
import { findAirport, setBusyHandler } from './airport.js?v=2';
import { createControls } from './controls.js?v=3';
import { createHud, createMinimap, createAudio } from './hud.js?v=4';

const C = window.Cesium, D2R = Math.PI / 180, R2D = 180 / Math.PI, FT = 0.3048, KT = 0.514444, RE = 6371000;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), angDiff = (a, b) => ((b - a + 540) % 360) - 180;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services', FAA_TILES = 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services';
const SAT_TILES = USGS + '/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
const EMBED = window.parent !== window;
// Phones and tablets get a low-memory graphics budget (iOS Safari gives a page far less GPU memory than a
// desktop and silently drops the 3D canvas when it runs out). Level 2 is used after that has happened once.
const LITE = window.SKYHAWK_LITE || 0;      // set in index.html before any module loads
document.body.classList.toggle('touch', IS_TOUCH);

// ---------------------------------------------------------------- state
const sim = { flying: false, paused: false, crashedShown: false, cam: 'chase', look: { yaw: 0, pitch: 0, drag: false }, trail: [], trailT: 0, hdgS: null, fly: null, gnd: null, toastT: 0, lastMsg: '', miniT: 0 };
const opts = Object.assign({ engine: 'running', icao: 'KLYH', rwy: null, start: 'runway', time: 'day', sky: 'few', wind: 'calm', map: 'sat', input: 'stick', autotrim: 'on' }, (() => { try { return JSON.parse(localStorage.getItem('skyhawk-setup') || '{}'); } catch { return {}; } })());
if (!opts.wb || typeof opts.wb !== 'object') opts.wb = wbDefaults();
let ac = C172, at = {}, elec = { bat: true, alt: true, avn: true, lights: { nav: true, bcn: true, strobe: true, land: false, taxi: false } }, wbFuel = 0, telT = 0;
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
    msaaSamples: LITE ? 1 : 4, scene3DOnly: true, showRenderLoopErrors: false, contextOptions: { webgl: { powerPreference: LITE ? 'default' : 'high-performance', antialias: !LITE } },
  });
  scene = viewer.scene; const globe = scene.globe;
  viewer.clock.shouldAnimate = false; scene.screenSpaceCameraController.enableInputs = false;
  globe.depthTestAgainstTerrain = true; globe.enableLighting = true; globe.dynamicAtmosphereLighting = true; globe.dynamicAtmosphereLightingFromSun = true;   // sky follows the real sun even under moonlight
   globe.showGroundAtmosphere = true; globe.baseColor = C.Color.fromCssColorString('#0b1a24');
  globe.maximumScreenSpaceError = [1.6, 3, 5][LITE]; globe.tileCacheSize = [300, 60, 30][LITE]; globe.preloadSiblings = !LITE; globe.preloadAncestors = LITE < 2;
  scene.fog.enabled = true; scene.fog.density = 2.2e-4; scene.fog.minimumBrightness = 0.06; scene.highDynamicRange = false;
  scene.postProcessStages.fxaa.enabled = IS_TOUCH; // render at CSS pixels x a capped scale (not devicePixelRatio x scale, which is ~4.5x on an iPhone and can run Safari out of memory)
  viewer.useBrowserRecommendedResolution = true; viewer.resolutionScale = Math.min(devicePixelRatio || 1, [2, 1.25, 1][LITE]);
  scene.maximumRenderTimeChange = Infinity; idle(true);
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
  for (let i = 0; i < 6; i++) lights.add({ pixelSize: 5, color: C.Color.WHITE, show: false, scaleByDistance: new C.NearFarScalar(30, 1.6, 2e4, 0.6) });
  rwyLights = scene.primitives.add(new C.PointPrimitiveCollection());
  let last = performance.now();
  // an exception inside a Cesium frame stops its render loop (black screen), so the sim's own work is
  // guarded, and if the renderer itself fails it is simplified and restarted instead of staying dead
  scene.preUpdate.addEventListener(() => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; try { frame(dt); } catch (e) { report('Sim', e); } });
  let renderErrs = 0;
  scene.renderError.addEventListener((sc, err) => {
    renderErrs++; report('Graphics', err);
    if (renderErrs === 1 && sim.clouds && sim.clouds.enabled) sim.clouds.set('clear');                 // clouds are the heaviest effect
    if (renderErrs === 2) { viewer.resolutionScale = 1; scene.fog.enabled = false; globe.maximumScreenSpaceError = 4; }
    if (renderErrs <= 6) setTimeout(() => { viewer.useDefaultRenderLoop = true; }, 300);
  });
  scene.canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); report('Graphics', new Error('the 3D view ran out of graphics memory'));
    // it can't come back on its own: reload in the lowest-detail mode and keep the setup
    try { localStorage.setItem('skyhawk-lite', '2'); localStorage.setItem('skyhawk-setup', JSON.stringify(opts)); sessionStorage.setItem('skyhawk-lowmsg', '1'); } catch { /* private */ }
    if (LITE < 2) setTimeout(() => location.reload(), 1800);
  }, false);
  // safety net: if the globe stops drawing while flying, keep the instruments and physics alive
  setInterval(() => { if (sim.flying && performance.now() - last > 1500) { try { viewer.useDefaultRenderLoop = true; scene.requestRender(); } catch { /* still down */ } } }, 1000);
  const own = () => { requestAnimationFrame(own); const now = performance.now(); if (sim.flying && now - last > 300) { const dt = Math.min(0.1, (now - (own.t || now)) / 1000); try { frame(dt); } catch (e) { report('Sim', e); } } own.t = now; };
  requestAnimationFrame(own);
}
// while a menu is up and nothing is flying, only redraw the globe when something actually changes
function idle(on) { if (scene) { scene.requestRenderMode = on; if (!on) scene.requestRender(); } }
const reported = new Set();
function report(where, e) {
  const msg = `${where} error: ${(e && (e.message || e)) || 'unknown'}`.slice(0, 160); console.error(msg, e);
  if (reported.has(msg)) return; reported.add(msg);
  const el = $('#errbox'); el.textContent = msg + ' · tap to close'; el.classList.add('on');
}
window.addEventListener('error', e => report('Page', e.error || e.message));
window.addEventListener('unhandledrejection', e => report('Page', e.reason));
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
  viewer.clock.currentTime = C.JulianDate.fromDate(date); sim.sunEl = sunElevation(date, lat, lon); sim.lighting(); if (sim.clouds) sim.clouds.light(sim.sunEl);
  rwyLights.show = kind !== 'day'; if (layers.city) layers.city.show = kind !== 'day';   // city lights only cost bandwidth after sunset
  scene.skyAtmosphere.show = true; scene.sun.show = true; scene.moon.show = true;
}
function setSky(kind, groundM) {
  // volumetric cloud layer around wherever the airplane is (bases/tops in metres MSL)
  if (!sim.clouds) sim.clouds = createClouds(viewer, { lite: LITE });
  scene.fog.density = (kind === 'ovc' ? 4.5e-4 : 2.2e-4) * (LITE ? 1.6 : 1);     // fog also culls distant terrain tiles
  const ref = origin || (apt ? { lat: apt.lat, lon: apt.lon } : { lat: 37, lon: -80 }), gndM = groundM ?? (apt ? apt.elevFt : 0) * FT;
  if (kind === 'clear' || LITE > 1) return sim.clouds.set('clear');
  const base = gndM + (kind === 'ovc' ? 2400 : 4500) * FT, top = base + (kind === 'ovc' ? 700 : 1700);
  sim.clouds.set(kind, base, top, ref); sim.clouds.light(sim.sunEl ?? 40);
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
  setBusyHandler(sec => { if (my === findSeq) aptInfo.textContent = `FAA server is busy, retrying in ${sec}s…`; });
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
  } catch (e) {
    if (my !== findSeq) return; console.warn(e);
    aptInfo.textContent = /busy/.test(e.message) ? 'FAA server is busy right now. Wait a few seconds and press search.' : 'Could not reach the FAA airport service. Check your connection and press search.'; aptInfo.className = 'err';
  }
}
const titleCase = t => String(t).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\bIntl\b/, 'Intl');
icao.addEventListener('input', () => { icao.value = icao.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); clearTimeout(findTimer); const v = icao.value; if (v !== opts.icao || !apt) { startBtn.disabled = true; aptInfo.className = ''; aptInfo.textContent = v.length < 3 ? 'US airports, live FAA data' : 'Press Enter to search'; } if (v.length === 4 || (v.length === 3 && /\d/.test(v))) findTimer = setTimeout(lookup, 700); });
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
  idle(false); show('#setup', false); show('#crash', false); show('#pause', false); show('#loading', true);
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
  const w = wbCompute(opts.wb); ac = configure(w.lb, w.cg); wbFuel = +opts.wb.fuel || 0; at = {};
  const gh = air ? apt.elevFt * FT + 1000 * FT : g0 + ac.gear[1].z - 0.045;
  const [n, e] = toNE(lat, lon);
  s = createState({ n, e, h: gh, hdg, kt: air ? 90 : 0, onGround: !air, fuelGal: wbFuel });
  // trim for 90 kt at this weight and CG (elevator angle that balances the pitching moment)
  const { a: a90, trim: trim90 } = trimFor(90);
  if (air) { s.pw = 0.55; s.w = s.u * a90; }
  controls.reset(air ? { thr: 0.55, trim: trim90 } : { thr: 0 });
  controls.st.flaps = 0; updateFlapInd();
  sim.engOn = air || opts.engine !== 'cold'; sim.crankT = 0; if (!sim.engOn) { s.running = false; s.rpm = 0; }
  sim.cam = 'chase'; model.show = true; placeModel(); updateCamera(0.016);
  // let the terrain and imagery under the aircraft stream in before the clock starts
  const t0 = performance.now();
  await new Promise(res => { const chk = () => { if ((scene.globe.tilesLoaded && performance.now() - t0 > 700) || performance.now() - t0 > 9000) res(); else setTimeout(chk, 120); }; chk(); });
  if (!air) { sim.gnd = g0; const gr = groundAt(lat, lon); s.h = gr + ac.gear[1].z - 0.045; sim.gnd = gr; }
  show('#loading', false); document.body.classList.add('flying'); sim.flying = true; idle(false); if (IS_TOUCH) orient.activate(true);
  toast(`${apt.icao || apt.ident} · RWY ${end.name}${sim.env.wind.kt ? ` · Wind ${String(Math.round(sim.env.wind.dir / 10) * 10 || 360).padStart(3, '0')}@${sim.env.wind.kt}${sim.env.gust ? 'G' + (sim.env.wind.kt + 8) : ''}` : ''}`);
  audio.resume();
  if (!w.ok) setTimeout(() => toast('Outside POH limits: ' + w.issues[0]), 2800);
  else if (!sim.engOn && !link.active) setTimeout(() => toast(IS_TOUCH ? 'Hold the key button to start the engine' : 'Hold I to crank the engine'), 2800);
}
function show(sel, on) { $(sel).classList.toggle('on', on); }

// ---------------------------------------------------------------- per frame
function groundAt(lat, lon) {
  // source elevation (exact tile data) is the truth; the rendered mesh height is used when it agrees,
  // so the wheels sit on the terrain that is actually drawn. Unloaded "fill" tiles can report nonsense.
  const src = elevSync(lat, lon, 13) ?? elevSync(lat, lon, 11), h = scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
  if (src != null) return h !== undefined && Math.abs(h - src) < 1.5 ? h : src;      // a coarser mesh (camera far away) must not move the ground under the wheels
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
  if (ac.dx) C.Matrix4.multiplyByTranslation(M, new C.Cartesian3(-ac.dx, 0, 0), M);    // physics runs about the loaded CG; the model's origin is the reference CG
  model.modelMatrix = C.Matrix4.clone(M, model.modelMatrix);
  model.show = sim.cam !== 'cockpit';
  if (s.surf) applySurfaces(s.surf);
  spinProp();
  const T = meta.tips, t = performance.now() / 1000, night = opts.time !== 'day';
  const P = (v, i, col, on) => { const p = lights.get(i); p.position = C.Matrix4.multiplyByPoint(M, new C.Cartesian3(v[0], v[1], v[2]), new C.Cartesian3()); p.color = col; p.show = on && sim.cam !== 'cockpit'; p.pixelSize = night ? 6 : 4; };
  const L = elec.lights, pwr = elec.bat || (elec.alt && s.running);
  P(T.left, 0, C.Color.RED, pwr && L.nav); P(T.right, 1, C.Color.LIME, pwr && L.nav); P(T.tail, 2, C.Color.WHITE, pwr && L.nav);
  P(T.top, 3, C.Color.RED, pwr && L.bcn && t % 1.2 < 0.12); P(T.belly, 4, C.Color.WHITE, pwr && L.strobe && (t % 1.5 < 0.06 || (t + 0.2) % 1.5 < 0.06));
  P([2.1, 0, -0.35], 5, C.Color.fromCssColorString('#fff6d8'), pwr && (L.land || L.taxi)); lights.get(5).pixelSize = L.land ? 13 : 9;
  return { lat, lon, r };
}
// propeller: real blades while turning slowly (you can watch it crank and catch), a blur disc at speed
let propAng = 0, propT = performance.now();
function spinProp() {
  if (!model.ready) return; const now = performance.now(), dt = Math.min(0.1, (now - propT) / 1000); propT = now;
  const rpm = s.rpm || 0; propAng = (propAng + rpm / 60 * 2 * Math.PI * dt) % (2 * Math.PI);
  try {
    const bl = model.getNode('blades'), dc = model.getNode('disc'), sb = meta.surfs.find(x => x.name === 'blades');
    if (bl) { bl.show = rpm < 1150; bl.matrix = C.Matrix4.fromRotationTranslation(C.Matrix3.fromQuaternion(C.Quaternion.fromAxisAngle(new C.Cartesian3(...sb.axis), propAng)), new C.Cartesian3(...sb.hinge)); }
    if (dc) dc.show = rpm > 650;
  } catch { /* node api */ }
}
const surfCache = {};
function applySurfaces(d) {
  if (!model.ready) return;
  for (const sf of meta.surfs) {
    if (sf.name === 'disc' || sf.name === 'blades') continue;
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
    let c = controls.update(dt); const [lat, lon] = toLL(s.n, s.e);
    if (link.active) c = padControls(link.ctl, c);
    else {
      // keyboard / touch: hold I (or the key button) to crank; the engine catches after about 1.3 s
      if (c.crank && !sim.engOn) { if ((sim.crankT += dt) > 1.3) { sim.engOn = true; toast('Engine started'); } } else sim.crankT = 0;
      c = { ...c, eng: sim.engOn, crank: c.crank && !sim.engOn, ign: 3, mx: 1, sel: 'B', shutoff: false }; elec = ELEC_ON;
    }
    document.body.classList.toggle('engoff', !s.running && !link.active && !s.crashed);
    if (opts.autotrim === 'on') { autoTrim(s, c, at, dt); c = trimmed(c, at); }
    let g = groundAt(lat, lon); if (sim.gnd != null) { const lim = (s.onGround ? 4 : 30) + Math.hypot(s.vn, s.ve) * 0.5; g = sim.gnd + clamp(g - sim.gnd, -lim * dt, lim * dt); } sim.gnd = g;
    for (let k = 0; k < (sim.timeScale || 1); k++) step(s, c, dt, { ground: g, wind: sim.env.wind, gust: sim.env.gust }, ac);   // timeScale: test hook
    // fuel burned changes the weight and CG
    const fuel = s.fuelL + s.fuelR; if (Math.abs(fuel - wbFuel) > 0.25) { wbFuel = fuel; const w = wbCompute(opts.wb, fuel); ac = configure(w.lb, w.cg); }
  }
  const { lat, lon, r } = placeModel();
  if (sim.flying) updateCamera(dt);
  if (!sim.flying) return;
  const pfd = elec.bat || (elec.alt && s.running);
  document.body.classList.toggle('pfdoff', !pfd); document.body.classList.toggle('mfdoff', !pfd || !elec.avn);
  const mm = $('#minimap'); hud.draw(r, { miniBottom: mm.classList.contains('off') || document.body.classList.contains('mfdoff') ? 0 : mm.offsetTop + mm.offsetHeight, touch: IS_TOUCH, thr: controls.st.thr, trim: clamp(controls.st.trim + (opts.autotrim === 'on' ? (at.pt || 0) : 0), -1, 1), cam: sim.cam, fuel: s.fuelL + s.fuelR });
  audio.update(r, sim.paused);
  // status chips
  const chips = [];
  if (r.spin) chips.push(['SPIN', 'red']); else if (r.warn) chips.push(['STALL', 'red']);
  if (r.overspeed) chips.push(['VNE', 'red']); if (r.overG) chips.push(['G', 'red']);
  if (controls.st.brk || (link.active && (link.ctl.brkL || link.ctl.brkR))) chips.push(['BRK', 'amber']);
  if (!s.running && !s.crashed) chips.push(['ENG', 'red']); else if (s.fuelL + s.fuelR < 8) chips.push(['FUEL', 'amber']);
  if (sim.env.wind.kt && sim.cam) chips.push([`${String(Math.round(sim.env.wind.dir / 10) * 10 || 360).padStart(3, '0')}/${sim.env.wind.kt}`, '']);
  const key = chips.map(c => c.join()).join('|'); if (key !== chipsKey) { chipsKey = key; chipsEl.innerHTML = chips.map(([t, c]) => `<b class="${c}">${t}</b>`).join(''); }
  if (s.msg && s.msg !== sim.lastMsg) { sim.lastMsg = s.msg; toast(s.msg); setTimeout(() => { if (sim.lastMsg === s.msg) { s.msg = ''; sim.lastMsg = ''; } }, 2500); }
  const now = performance.now();
  if (now - sim.trailT > 1500) { sim.trailT = now; sim.trail.push([lat, lon]); if (sim.trail.length > 500) sim.trail.shift(); }
  if (now - sim.miniT > 150 && !$('#minimap').classList.contains('off')) { sim.miniT = now; minimap.draw(lat, lon, r.hdg, r.trk, sim.trail.concat([[lat, lon]]), apt.runways); }
  if (now - telT > 180) { telT = now; link.send({ rpm: Math.round(s.rpm), fuelL: s.fuelL, fuelR: s.fuelR, flap: s.flap, onGround: s.onGround, warn: r.warn, crashed: s.crashed, paused: sim.paused, msg: s.msg, starved: s.starved, noFuel: s.starveT > 0.5 }); }
  if (s.crashed && !sim.crashedShown) { sim.crashedShown = true; setTimeout(() => { $('#crashWhy').textContent = s.crashed; show('#crash', true); }, 1300); }
}

// elevator trim and angle of attack for level flight at a speed (this weight and CG)
function trimFor(kt, h = 1000) { const q = 0.5 * 1.225 * Math.pow(Math.max(0.2, 1 - 2.25577e-5 * h), 4.2559) * (kt * KT) ** 2, a = (ac.m * 9.81 / (q * ac.S) - ac.CL0 - (ac.dCLcg || 0)) / ac.CLa; return { a, trim: clamp(-((ac.Cm0 + ac.Cma * a) / -ac.Cmde) / (9 * D2R), -1, 1) }; }

// ---------------------------------------------------------------- drop the airplane anywhere
let slip = null, dropGround = null;
function openDrop() {
  show('#dropSheet', true);
  if (!slip) {
    slip = createSlippy($('#dropMap'), { tileUrl: SAT_TILES, P: e => orient.P(e), R: el => orient.R(el), onPick: async m => {
      $('#dropHint').textContent = 'Drag the map, or tap again to move the spot'; $('#dropGo').disabled = false; dropGround = null;
      $('#dropGnd').textContent = `${Math.abs(m.lat).toFixed(4)}°${m.lat >= 0 ? 'N' : 'S'} ${Math.abs(m.lon).toFixed(4)}°${m.lon >= 0 ? 'E' : 'W'} · ground elevation…`;
      const g = await Promise.race([elevAsync(m.lat, m.lon, 11).catch(() => null), new Promise(r => setTimeout(() => r(null), 4000))]);
      if (slip.v.mark !== m) return; dropGround = g;
      if (g != null) { $('#dropGnd').textContent = `${Math.abs(m.lat).toFixed(4)}°${m.lat >= 0 ? 'N' : 'S'} ${Math.abs(m.lon).toFixed(4)}°${m.lon >= 0 ? 'E' : 'W'} · ground ${Math.round(g / FT).toLocaleString()} ft`; const alt = $('#dropAlt'); if (+alt.value < g / FT + 500) alt.value = Math.ceil((g / FT + 1500) / 500) * 500; }
    } });
    $('#dropHdg').addEventListener('input', () => { slip.v.hdg = +$('#dropHdg').value || 0; slip.draw(); });
    $$('.dropzoom button').forEach(b => b.onclick = () => { if (b.dataset.zoom === 'me') { const [la, lo] = toLL(s.n, s.e); slip.center(la, lo, 11); } else slip.zoom(+b.dataset.zoom); });
    const go = $('#dropApt'); go.addEventListener('keydown', async e => { if (e.key !== 'Enter') return; e.preventDefault(); go.blur(); try { const a = await findAirport(go.value); if (a) slip.center(a.lat, a.lon, 13); else toast('Airport not found'); } catch { toast('FAA lookup failed'); } });
    go.addEventListener('input', () => { go.value = go.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('#dropGo').onclick = () => { const m = slip.v.mark; if (m) dropAt(m.lat, m.lon, +$('#dropHdg').value || 0, +$('#dropAlt').value || 3000, clamp(+$('#dropKt').value || 100, 60, 160)); };
  }
  const r = readout(s, sim.gnd ?? 0), [la, lo] = toLL(s.n, s.e);
  slip.v.url = sources()[minimap.o.src] ? sources()[minimap.o.src].url : SAT_TILES; slip.v.maxZ = minimap.o.src === 'sectional' ? 12 : 16;
  slip.v.plane = { lat: la, lon: lo, hdg: r.hdg }; slip.v.hdg = +$('#dropHdg').value || Math.round(r.hdg / 10) * 10 || 360; $('#dropHdg').value = slip.v.hdg;
  if (!slip.v.mark) slip.center(la, lo, 10); else { slip.size(); slip.draw(); }
}
function sources() { return { sat: { url: SAT_TILES, max: 16 }, topo: { url: USGS + '/USGSTopo/MapServer/tile/{z}/{y}/{x}', max: 16 }, sectional: { url: FAA_TILES + '/VFR_Sectional/MapServer/tile/{z}/{y}/{x}', max: 12 } }; }
async function dropAt(lat, lon, hdg, altFt, kt) {
  show('#dropSheet', false); show('#loading', true);
  const g = dropGround ?? await Promise.race([elevAsync(lat, lon, 13).catch(() => null), new Promise(r => setTimeout(() => r(null), 4000))]) ?? 0;
  let h = altFt * FT; if (h < g + 150) { h = g + 1000 * FT; toast('Raised to 1,000 ft above the ground'); }
  origin = { lat, lon }; const fuel = s.fuelL + s.fuelR, { a, trim } = trimFor(kt, h);
  s = createState({ n: 0, e: 0, h, hdg, kt, onGround: false, fuelGal: fuel }); s.pw = 0.6; s.w = s.u * a;
  controls.reset({ thr: 0.6, trim }); controls.st.flaps = 0; updateFlapInd(); at = {}; sim.engOn = true; sim.gnd = g; sim.trail = []; sim.hdgS = null; sim.fly = null; s.msg = '';
  setSky(opts.sky, g);
  const t0 = performance.now(); placeModel(); updateCamera(0.016); scene.requestRender();
  await new Promise(res => { const chk = () => { if ((scene.globe.tilesLoaded && performance.now() - t0 > 600) || performance.now() - t0 > 7000) res(); else setTimeout(chk, 120); }; chk(); });
  show('#loading', false); sim.mapPaused = false; sim.paused = false; sim.crashedShown = false; show('#crash', false); audio.resume();
  toast(`Dropped · ${String(Math.round(hdg) % 360 || 360).padStart(3, '0')}° · ${Math.round(h / FT).toLocaleString()} ft`);
}

// ---------------------------------------------------------------- phone cockpit
const ELEC_ON = { bat: true, alt: true, avn: true, lights: { nav: true, bcn: true, strobe: true, land: false, taxi: false } };
function padControls(p, kb) {
  elec = { bat: !!p.bat, alt: !!p.alt, avn: !!p.avn, lights: p.lights || ELEC_ON.lights };
  const park = p.park ? 1 : 0, brk = Math.max(park, p.brkL || 0, p.brkR || 0, kb.brk);
  if (controls.st.flaps !== p.fl) { controls.st.flaps = p.fl; updateFlapInd(); }
  controls.st.thr = p.th; controls.st.trim = p.pt; controls.st.brk = brk;
  return { de: clamp(p.e + kb.de, -1, 1), da: clamp(p.a + kb.da, -1, 1), dr: clamp(p.r + kb.dr, -1, 1), thr: p.th, mx: p.mx, flaps: p.fl, brk, brkDiff: park ? 0 : (p.brkR || 0) - (p.brkL || 0), trim: p.pt, ign: p.ign, crank: !!p.crank, eng: p.eng, sel: p.sel, shutoff: p.shutoff };
}
const link = createLink({
  onState(st, detail) {
    const msg = { starting: 'Starting…', waiting: 'Waiting for your phone', connected: 'Phone connected', error: detail || 'Pairing error' }[st] || st;
    $('#phoneMsg').textContent = msg; $('#phoneDot').className = st === 'connected' ? 'on' : st === 'error' ? 'err' : '';
    $('#phoneSum').textContent = st === 'connected' ? 'Phone connected' : 'Pair a phone'; $('#phoneBtn').classList.toggle('ok', st === 'connected');
    if (st === 'waiting' || st === 'connected') { $('#qr').innerHTML = link.qrSvg(); const a = $('#padLink'); a.href = a.textContent = link.url(); }
    if (st === 'connected') { toast('Phone cockpit connected'); if ($('#phone').classList.contains('on') && sim.flying) setTimeout(() => act('closePhone'), 900); }
  },
  onCmd(t) {
    if (t === 'cam') act('cam'); else if (t === 'pause') act(sim.paused ? 'resume' : 'pause');
    else if (t.startsWith('restart')) { opts.start = t === 'restart-air' ? 'pattern' : 'runway'; syncSeg('start'); show('#setup', false); act('restart'); }
  },
});
$('#phoneBtn').onclick = () => { show('#phone', true); link.start(); };

// ---------------------------------------------------------------- weight & balance sheet
function wbUi() {
  const w = wbCompute(opts.wb), sum = $('#wbBtn');
  $('#wbSum').textContent = `${Math.round(w.lb).toLocaleString()} lb`; $('#wbCg').textContent = `CG ${w.cg.toFixed(1)} · ${w.ok ? (w.utility ? 'Utility' : 'Normal') : 'Out of limits'}`;
  sum.classList.toggle('ok', w.ok); sum.classList.toggle('bad', !w.ok);
  if (!$('#wb').classList.contains('on')) return;
  for (const st of STATIONS) {
    const v = +opts.wb[st.k] || 0, lb = st.lbPer ? v * st.lbPer : v, arm = st.k === 'empty' ? +opts.wb.emptyArm || st.arm : st.arm;
    $(`#wbm-${st.k}`).textContent = (lb * arm / 1000).toFixed(1); if (st.lbPer) $(`#wbl-${st.k}`).textContent = `${Math.round(lb)} lb`;
  }
  $('#wbW').textContent = `${Math.round(w.lb)} lb`; $('#wbA').textContent = w.cg.toFixed(1); $('#wbM').textContent = (w.mom / 1000).toFixed(1);
  const stat = $('#wbStat'); stat.className = 'wbstat ' + (w.ok ? 'ok' : 'bad');
  stat.textContent = w.ok ? `Within limits · ${w.utility ? 'Utility category: spins approved' : 'Normal category (spins not approved)'}` : w.issues.join(' · ');
  drawEnvelope($('#wbChart'), opts.wb);
}
function buildWb() {
  $('#wbRows').innerHTML = STATIONS.map(st => `<tr><td>${st.label}</td><td><input type="number" inputmode="decimal" min="0" ${st.k === 'empty' ? '' : `max="${st.max}"`} step="${st.lbPer ? 1 : 5}" id="wbi-${st.k}" value="${opts.wb[st.k] ?? st.def}" aria-label="${st.label} (${st.unit})"> ${st.unit === 'gal' ? 'gal' : ''}${st.lbPer ? `<br><small id="wbl-${st.k}"></small>` : ''}</td><td>${st.editArm ? `<input class="arm" type="number" inputmode="decimal" step="0.1" id="wbi-emptyArm" value="${opts.wb.emptyArm ?? st.arm}" aria-label="Empty weight arm (in)">` : st.arm.toFixed(1)}</td><td id="wbm-${st.k}"></td></tr>`).join('');
  $$('#wbRows input').forEach(inp => inp.addEventListener('input', () => { const k = inp.id.slice(4), st = STATIONS.find(x => x.k === k); let v = +inp.value || 0; if (st && st.k !== 'empty') v = clamp(v, 0, st.max); opts.wb[k] = v; wbUi(); }));
}
$('#wbBtn').onclick = () => { buildWb(); show('#wb', true); wbUi(); };

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
    case 'escape': if ($('#dropSheet').classList.contains('on')) act('closeDrop'); else if ($('#mapSheet').classList.contains('on')) act('closeMap'); else if ($('#wb').classList.contains('on')) act('closeWb'); else if ($('#phone').classList.contains('on')) act('closePhone'); else if (helpOpen) act('closeHelp'); else if ($('#setup').classList.contains('on')) { if (sim.flying) { show('#setup', false); pause(true); } else act('exit'); } else if (sim.flying) pause(!sim.paused); break;
    case 'cam': sim.cam = CAMS[(CAMS.indexOf(sim.cam) + 1) % CAMS.length]; sim.fly = null; sim.hdgS = null; toast({ chase: 'Chase view', cockpit: 'Cockpit view', flyby: 'Fly-by view' }[sim.cam]); break;
    case 'flapsDown': controls.st.flaps = Math.min(3, controls.st.flaps + 1); updateFlapInd(); break;
    case 'flapsUp': controls.st.flaps = Math.max(0, controls.st.flaps - 1); updateFlapInd(); break;
    case 'map': opts.map = { sat: 'sectional', sectional: 'topo', topo: 'sat' }[opts.map]; applyMap(); toast({ sat: 'Satellite', sectional: 'VFR sectional', topo: 'Topo map' }[opts.map]); syncSeg('map'); break;
    case 'time': opts.time = { day: 'dusk', dusk: 'night', night: 'day' }[opts.time]; setTime(opts.time); toast({ day: 'Day', dusk: 'Dusk', night: 'Night' }[opts.time]); syncSeg('time'); break;
    case 'mini': $('#minimap').classList.toggle('off'); break;
    case 'mapMenu': if (!sim.flying) return; if (!sim.paused) { sim.mapPaused = true; sim.paused = true; audio.suspend(); } syncMapSheet(); show('#mapSheet', true); break;
    case 'dropMenu': show('#mapSheet', false); openDrop(); break;
    case 'closeDrop': show('#dropSheet', false); if (sim.mapPaused) { sim.mapPaused = false; sim.paused = false; audio.resume(); } break;
    case 'closeMap': show('#mapSheet', false); try { localStorage.setItem('skyhawk-setup', JSON.stringify(opts)); } catch { /* private */ } if (sim.mapPaused) { sim.mapPaused = false; sim.paused = false; audio.resume(); } break;
    case 'sound': audio.on = !audio.on; $('#bar').dataset.sound = audio.on ? 'on' : 'off'; if (!audio.on) audio.suspend(); break;
    case 'help': if (!sim.flying) return; show('#help', !helpOpen); if (!helpOpen && !sim.paused) { sim.helpPaused = true; sim.paused = true; } break;
    case 'closeHelp': show('#help', false); if (sim.helpPaused) { sim.helpPaused = false; sim.paused = false; } break;
    case 'closeWb': show('#wb', false); try { localStorage.setItem('skyhawk-setup', JSON.stringify(opts)); } catch { /* private */ } wbUi(); break;
    case 'closePhone': show('#phone', false); break;
    case 'recenter': controls.recenter(); toast('Tilt centered'); break;
    case 'restart': if (apt && opts.rwy) begin(); break;
    case 'setup': sim.paused = true; show('#pause', false); show('#crash', false); show('#setup', true); document.body.classList.remove('flying'); sim.flying = false; audio.suspend(); idle(true); break;
    case 'exit':
      audio.suspend(); sim.paused = true; idle(true);
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
function sizeClasses() { const a = $('#app'), w = a.clientWidth, h = a.clientHeight, b = document.body.classList; b.toggle('w760', w <= 760); b.toggle('h430', h <= 430); b.toggle('h500', h <= 500); }
const orient = createOrient($('#app'), { onChange: () => requestAnimationFrame(sizeClasses) });
addEventListener('resize', () => setTimeout(sizeClasses, 80)); sizeClasses();
const controls = createControls({ onAction: act, orient }), hud = createHud($('#hud')), minimap = createMinimap($('#minimap'), sources()), audio = createAudio();

await initWorld();
icao.value = opts.icao || ''; if (icao.value) lookup();
setTimeout(() => { if (!IS_TOUCH) icao.focus({ preventScroll: true }); }, 300);
// moving-map popup: tap the map circle
if (!opts.mini) opts.mini = { src: 'sat', up: 'north', zoom: 13 };
Object.assign(minimap.o, opts.mini);
const MINI_PX = { s: [150, 112], m: [210, 150], l: [300, 210] };
function styleMini() { const el = $('#minimap'), px = (MINI_PX[minimap.o.size] || MINI_PX.m)[IS_TOUCH ? 1 : 0]; el.classList.toggle('square', minimap.o.shape === 'square'); el.style.width = el.style.height = px + 'px'; el.width = el.height = Math.round(px * Math.min(2, devicePixelRatio || 1)); sim.miniT = 0; }
styleMini();
function syncMapSheet() { $$('#mapSheet .seg button').forEach(b => b.classList.toggle('on', String(minimap.o[b.parentElement.dataset.mini]) === b.dataset.v)); }
$$('#mapSheet .seg button').forEach(b => b.addEventListener('click', () => { const k = b.parentElement.dataset.mini; minimap.o[k] = k === 'zoom' ? +b.dataset.v : b.dataset.v; opts.mini = { ...minimap.o }; styleMini(); syncMapSheet(); }));
$('#minimap').addEventListener('click', () => act('mapMenu'));
$('#errbox').addEventListener('click', () => $('#errbox').classList.remove('on'));
try { if (sessionStorage.getItem('skyhawk-lowmsg')) { sessionStorage.removeItem('skyhawk-lowmsg'); setTimeout(() => { aptInfo.textContent = 'Switched to low-detail graphics for this device. Press Start.'; aptInfo.className = 'ok'; }, 2500); } } catch { /* private */ }
wbUi();
window.__sim = { dropAt, link, get ac() { return ac; }, get elec() { return elec; }, sim, opts, get s() { return s; }, get apt() { return apt; }, act, readout: () => s && readout(s), viewer: () => viewer, controls };
