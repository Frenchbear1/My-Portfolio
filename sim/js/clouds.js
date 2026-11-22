// Clouds: static 3D cumulus fixed in place in the world. Each cloud is a cluster of soft ellipsoid
// "puffs" (flat grey base, rounded sunlit towers). Instead of marching noise, every pixel works out
// exactly how much cloud its view ray passes through in each puff, with density highest at the core
// and fading to nothing at the rim: the edges are see-through, and flying in gets whiter the deeper
// you go. No noise or random jitter, so the clouds are smooth and steady. Positions come from a
// hash of the world grid, so the same cloud is always in the same place.
const FS_CLOUD = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform vec3 uCamRel;      // camera relative to the cloud field origin (m, ECEF axes)
uniform vec3 uOrigin;      // field origin (ECEF)
uniform vec4 uP[NP];       // puff: centre (relative to origin), horizontal radius
uniform vec4 uQ[NP];       // puff: centre height above cloud base, vertical squash, cloud thickness, shade
uniform int uN;
uniform float uSig, uMaxDist, uLog;
uniform vec3 uSunCol, uAmbTop, uAmbBot, uHaze;
in vec2 v_textureCoordinates;
void main() {
  // distance to whatever is behind this pixel (terrain, airplane); the depth buffer is logarithmic
  vec2 fc = v_textureCoordinates * czm_viewport.zw + czm_viewport.xy;
  float raw = texture(depthTexture, v_textureCoordinates).r;
  vec3 dirE = normalize(czm_windowToEyeCoordinates(fc, 0.5).xyz);
  vec3 dir = normalize((czm_inverseView * vec4(dirE, 0.0)).xyz);
  float zl = uLog > 0.5 ? exp2(raw * czm_log2FarDepthFromNearPlusOne) - 1.0 + czm_currentFrustum.x : -czm_windowToEyeCoordinates(fc, raw).z;
  float scene = raw >= 1.0 ? 1e9 : zl / max(-dirE.z, 1e-4);
  vec3 sun = czm_sunDirectionWC;
  float fwd = pow(max(dot(dir, sun), 0.0), 7.0);
  float T = 1.0; vec3 col = vec3(0.0);
  for (int i = 0; i < NP; i++) {
    if (i >= uN || T < 0.01) break;
    vec4 P = uP[i], Q = uQ[i];
    float R = P.w, k = 1.0 / Q.y - 1.0;
    vec3 n = normalize(uOrigin + P.xyz), o = uCamRel - P.xyz;
    float on = dot(o, n), dn = dot(dir, n);
    vec3 o2 = o + k * on * n, d2 = dir + k * dn * n;           // stretch vertically: ellipsoid -> sphere
    float A = dot(d2, d2), B = dot(o2, d2), O2 = dot(o2, o2), R2 = R * R;
    float disc = B * B - A * (O2 - R2);
    if (disc <= 0.0) continue;
    float sq = sqrt(disc), ta = max((-B - sq) / A, 0.0), tb = min((-B + sq) / A, scene);
    float cb = Q.x;                                            // flat bottom at the cloud base
    if (abs(dn) > 1e-5) { float tc = (-cb - on) / dn; if (dn > 0.0) ta = max(ta, tc); else tb = min(tb, tc); }
    else if (on < -cb) continue;
    if (tb <= ta) continue;
    // integral of density (1 - r^2/R^2) along the ray inside the puff
    float Fb = tb - (A * tb * tb * tb / 3.0 + B * tb * tb + O2 * tb) / R2;
    float Fa = ta - (A * ta * ta * ta / 3.0 + B * ta * ta + O2 * ta) / R2;
    float a = 1.0 - exp(-uSig * max(Fb - Fa, 0.0));
    a *= 1.0 - smoothstep(uMaxDist * 0.65, uMaxDist, ta);       // fade out at range instead of popping
    if (a < 0.002) continue;
    vec3 pe = o2 + d2 * ta, N = pe + k * dot(pe, n) * n;
    N = normalize(N + n * 0.001);
    float hf = clamp((dot(o + dir * ta, n) + cb) / Q.z, 0.0, 1.0);
    float lit = clamp(dot(N, sun) * 0.3 + 0.7, 0.0, 1.0);
    vec3 L = uSunCol * lit * (0.45 + 0.55 * hf) + mix(uAmbBot, uAmbTop, hf);
    L += uSunCol * fwd * 2.2 * (1.0 - a);                       // silver lining on thin edges toward the sun
    L = mix(L * Q.w, uHaze, (1.0 - exp(-ta / 24000.0)) * 0.8);
    col += T * a * L; T *= 1.0 - a;
  }
  out_FragColor = vec4(min(col, vec3(1.2)), T);
}`;
const FS_COMPOSE = `
uniform sampler2D colorTexture;
uniform sampler2D cloudTex;
in vec2 v_textureCoordinates;
void main() { vec4 s = texture(colorTexture, v_textureCoordinates), c = texture(cloudTex, v_textureCoordinates); float T = c.a + c.r + c.g + c.b < 0.002 ? 1.0 : c.a; out_FragColor = vec4(s.rgb * T + c.rgb, s.a); }`;

function rng(ix, iy, seed) {                       // deterministic per grid cell
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519)) | 0;
  return () => { h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

export function createClouds(viewer, { lite = 0 } = {}) {
  const C = window.Cesium, scene = viewer.scene;
  const q = lite ? { np: 110, scale: 0.6, rad: 15000 } : { np: 260, scale: 1, rad: 26000 };
  try {                                                         // stay inside the GPU's uniform budget
    const gl = scene.context._gl, max = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
    q.np = Math.max(24, Math.min(q.np, Math.floor((max - 40) / 2)));
  } catch (e) { q.np = Math.min(q.np, 90); }
  const u = { kind: 'clear', base: 1500, top: 2700, sig: 0.009, seed: 1, origin: new C.Cartesian3(), sunCol: new C.Cartesian3(1, 1, 1), ambTop: new C.Cartesian3(0.7, 0.78, 0.92), ambBot: new C.Cartesian3(0.4, 0.44, 0.52), haze: new C.Cartesian3(0.7, 0.78, 0.88), n: 0 };
  const P = Array.from({ length: q.np }, () => new C.Cartesian4()), Q = Array.from({ length: q.np }, () => new C.Cartesian4(0, 1, 1, 1));
  const camRel = new C.Cartesian3(), tmp = new C.Cartesian3(), tmp2 = new C.Cartesian3();
  let comp = null, enu = null, inv = null, cell = 2800, cells = new Map(), lastKey = '';

  // build one cloud (a list of puffs) for grid cell ix,iy, or null if the cell is clear
  function makeCloud(ix, iy) {
    const r = rng(ix, iy, u.seed), ovc = u.kind === 'ovc';
    if (!ovc && r() > 0.36) return null;
    const cx = (ix + 0.15 + 0.7 * r()) * cell, cy = (iy + 0.15 + 0.7 * r()) * cell, thickAll = u.top - u.base;
    // place on the curved earth: surface point under the cloud, its up vector, and east/north there
    const flat = C.Matrix4.multiplyByPoint(enu, new C.Cartesian3(cx, cy, 0), new C.Cartesian3());
    const surf = C.Ellipsoid.WGS84.scaleToGeodeticSurface(flat, new C.Cartesian3()) || flat;
    const frame = C.Transforms.eastNorthUpToFixedFrame(surf);
    const E = C.Matrix4.getColumn(frame, 0, new C.Cartesian4()), Nn = C.Matrix4.getColumn(frame, 1, new C.Cartesian4()), U = C.Matrix4.getColumn(frame, 2, new C.Cartesian4());
    const puffs = [], add = (x, y, alt, R, squash, thick, shade) => {
      const p = new C.Cartesian3(surf.x + E.x * x + Nn.x * y + U.x * alt - u.origin.x, surf.y + E.y * x + Nn.y * y + U.y * alt - u.origin.y, surf.z + E.z * x + Nn.z * y + U.z * alt - u.origin.z);
      puffs.push({ p, R, cb: alt - u.base, squash, thick, shade });
    };
    let size;
    if (ovc) {                                                  // overcast: wide flat slabs that merge into a deck
      size = 2900;
      for (let k = 0; k < 2; k++) {
        const R = 2300 + 900 * r();
        add((r() - 0.5) * 1400, (r() - 0.5) * 1400, u.base + thickAll * (0.35 + 0.2 * r()), R, (thickAll * (0.75 + 0.3 * r())) / R, thickAll * 1.2, 0.84 + 0.1 * r());
      }
    } else {                                                    // cumulus: a row of base puffs with towers on top
      const s = 0.6 + 0.75 * r(), thick = thickAll * (0.4 + 0.6 * r()) * Math.min(1, s), rb = 560 * s, shade = 0.94 + 0.08 * r();
      size = 1700 * s;
      const nb = 3 + Math.floor(r() * 2), nu = 3 + Math.floor(r() * 3), nl = 3 + Math.floor(r() * 4);
      const rise = Math.max(0, Math.min(thick - rb * 0.9, nu * rb * 0.42));
      for (let k = 0; k < nb; k++) add((r() - 0.5) * 1500 * s, (r() - 0.5) * 1300 * s, u.base + rb * 0.22, rb * (0.85 + 0.35 * r()), 0.62, thick, shade);
      for (let k = 0; k < nu; k++) {                             // towers: smaller puffs stacked higher toward the middle, overlapping
        const f = (k + 1) / nu, ru = rb * (0.75 - 0.3 * f) * (0.85 + 0.3 * r()), spread = (1 - 0.6 * f) * 900 * s;
        add((r() - 0.5) * spread, (r() - 0.5) * spread, u.base + rb * 0.35 + rise * f, ru, 0.9, thick, shade);
      }
      for (let k = 0; k < nl; k++) {                             // small lumps around the sides break up the round outline
        const ang = r() * 6.283, d = (0.45 + 0.35 * r()) * 900 * s, rl = rb * (0.35 + 0.2 * r());
        add(Math.cos(ang) * d, Math.sin(ang) * d, u.base + rb * 0.3 + rise * r() * 0.7, rl, 0.9, thick, shade);
      }
    }
    const c = new C.Cartesian3(surf.x + U.x * (u.base + thickAll / 2), surf.y + U.y * (u.base + thickAll / 2), surf.z + U.z * (u.base + thickAll / 2));
    return { puffs, sphere: new C.BoundingSphere(c, size + thickAll) };
  }
  function refreshCells(cam) {                                  // keep the clouds within range of the camera
    const lp = C.Matrix4.multiplyByPoint(inv, cam, tmp2), ix0 = Math.floor(lp.x / cell), iy0 = Math.floor(lp.y / cell);
    const key = ix0 + ',' + iy0; if (key === lastKey) return; lastKey = key;
    const span = Math.ceil(q.rad / cell) + 1, next = new Map();
    for (let ix = ix0 - span; ix <= ix0 + span; ix++) for (let iy = iy0 - span; iy <= iy0 + span; iy++) {
      const k = ix + ',' + iy;
      next.set(k, cells.has(k) ? cells.get(k) : makeCloud(ix, iy));
    }
    cells = next;
  }
  const list = [];
  function update() {                                           // per frame: visible puffs, nearest first
    if (!comp || !comp.enabled || !enu) return;
    const cam = scene.camera.positionWC;
    refreshCells(cam);
    const cull = scene.camera.frustum.computeCullingVolume(cam, scene.camera.directionWC, scene.camera.upWC);
    list.length = 0;
    for (const cl of cells.values()) {
      if (!cl) continue;
      const d = C.Cartesian3.distance(cl.sphere.center, cam) - cl.sphere.radius;
      if (d > q.rad || cull.computeVisibility(cl.sphere) === C.Intersect.OUTSIDE) continue;
      for (const pf of cl.puffs) { C.Cartesian3.add(pf.p, u.origin, tmp); pf.d = C.Cartesian3.distance(tmp, cam) - pf.R; list.push(pf); }
    }
    list.sort((a, b) => a.d - b.d);
    u.n = Math.min(list.length, q.np);
    for (let i = 0; i < u.n; i++) { const pf = list[i]; P[i].x = pf.p.x; P[i].y = pf.p.y; P[i].z = pf.p.z; P[i].w = pf.R; Q[i].x = pf.cb; Q[i].y = pf.squash; Q[i].z = pf.thick; Q[i].w = pf.shade; }
  }
  function build() {
    const stage = new C.PostProcessStage({
      name: 'skyhawkCloudMarch', textureScale: q.scale,
      fragmentShader: FS_CLOUD.replace(/NP/g, String(q.np)),
      uniforms: {
        uCamRel: () => C.Cartesian3.subtract(scene.camera.positionWC, u.origin, camRel),
        uOrigin: () => u.origin, uP: () => P, uQ: () => Q, uN: () => u.n,
        uSig: () => u.sig, uMaxDist: () => q.rad, uLog: () => (scene.logarithmicDepthBuffer ? 1 : 0),
        uSunCol: () => u.sunCol, uAmbTop: () => u.ambTop, uAmbBot: () => u.ambBot, uHaze: () => u.haze,
      },
    });
    const compose = new C.PostProcessStage({ name: 'skyhawkCloudCompose', fragmentShader: FS_COMPOSE, uniforms: { cloudTex: 'skyhawkCloudMarch' } });
    comp = scene.postProcessStages.add(new C.PostProcessStageComposite({ stages: [stage, compose], inputPreviousStageTexture: false }));
    scene.preRender.addEventListener(update);
  }
  return {
    /** kind: 'clear' | 'few' | 'ovc'; baseM/topM: meters MSL; origin: {lat, lon} of the cloud field */
    set(kind, baseM, topM, origin) {
      if (kind === 'clear') { u.kind = kind; if (comp) comp.enabled = false; return; }
      if (!comp) build();
      comp.enabled = true;
      Object.assign(u, { kind, base: baseM, top: topM, sig: kind === 'ovc' ? 0.0065 : 0.009, seed: Math.round((origin.lat * 7 + origin.lon * 13) * 1000) });
      cell = kind === 'ovc' ? 3600 : 2800;
      C.Cartesian3.fromDegrees(origin.lon, origin.lat, 0, C.Ellipsoid.WGS84, u.origin);
      enu = C.Transforms.eastNorthUpToFixedFrame(u.origin); inv = C.Matrix4.inverseTransformation(enu, new C.Matrix4());
      cells = new Map(); lastKey = '';
    },
    /** light colours from the sun's elevation (degrees) at the airplane */
    light(el) {
      const day = Math.min(1, Math.max(0, (el + 4) / 14)), warm = Math.min(1, Math.max(0, 1 - el / 12)) * day;
      u.sunCol.x = day * 0.88; u.sunCol.y = (0.97 - 0.42 * warm) * day * 0.88; u.sunCol.z = (0.92 - 0.65 * warm) * day * 0.88;
      const amb = 0.04 + 0.96 * day;
      u.ambTop.x = 0.36 * amb + 0.12 * warm; u.ambTop.y = 0.4 * amb + 0.04 * warm; u.ambTop.z = 0.47 * amb;
      u.ambBot.x = 0.24 * amb; u.ambBot.y = 0.26 * amb; u.ambBot.z = 0.31 * amb;
      u.haze.x = 0.66 * amb + 0.2 * warm; u.haze.y = 0.74 * amb + 0.06 * warm; u.haze.z = 0.86 * amb;
    },
    get enabled() { return !!(comp && comp.enabled); },
    get debug() { return { ...u, np: q.np, cells: cells.size }; },
    /** transmittance along a world-space direction from the camera (same maths as the shader; for tests) */
    probe(dir) {
      const V = C.Cartesian3, o0 = V.subtract(scene.camera.positionWC, u.origin, new V()); let T = 1; const hits = [];
      for (let i = 0; i < u.n; i++) {
        const c = new V(P[i].x, P[i].y, P[i].z), R = P[i].w, k = 1 / Q[i].y - 1, n = V.normalize(V.add(u.origin, c, new V()), new V());
        const o = V.subtract(o0, c, new V()), on = V.dot(o, n), dn = V.dot(dir, n);
        const o2 = V.add(o, V.multiplyByScalar(n, k * on, new V()), new V()), d2 = V.add(dir, V.multiplyByScalar(n, k * dn, new V()), new V());
        const A = V.dot(d2, d2), B = V.dot(o2, d2), O2 = V.dot(o2, o2), R2 = R * R, disc = B * B - A * (O2 - R2);
        if (disc <= 0) continue;
        const sq = Math.sqrt(disc); let ta = Math.max((-B - sq) / A, 0), tb = (-B + sq) / A; const cb = Q[i].x;
        if (Math.abs(dn) > 1e-5) { const tc = (-cb - on) / dn; if (dn > 0) ta = Math.max(ta, tc); else tb = Math.min(tb, tc); } else if (on < -cb) continue;
        if (tb <= ta) continue;
        const F = t => t - (A * t * t * t / 3 + B * t * t + O2 * t) / R2, a = 1 - Math.exp(-u.sig * Math.max(F(tb) - F(ta), 0));
        hits.push([i, ta | 0, tb | 0, +a.toFixed(3)]); T *= 1 - a;
      }
      return { T, hits: hits.slice(0, 8) };
    },
  };
}
