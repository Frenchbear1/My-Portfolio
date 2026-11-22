// Volumetric clouds: a post-process pass that ray-marches a layer of 3D noise between a cloud base
// and tops, lit by the sun (light marched toward it, Henyey-Greenstein forward scattering for silver
// linings, a "powder" term for dark crevices) plus a sky/ground ambient, occluded by terrain and the
// airplane through the depth buffer. Rendered at reduced resolution, then composited at full size.
// Fly into one and the world goes white. Phones use fewer steps and a smaller buffer.
const FS_MARCH = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform vec3 uCamRel;      // camera position relative to the cloud field's origin (m, ECEF axes)
uniform vec3 uUp;          // local up at the camera
uniform float uCamH;       // camera height (m)
uniform float uBase, uTop, uCover, uDens, uTime, uMaxDist, uStrat;
uniform vec3 uWind, uSunCol, uAmbTop, uAmbBot, uHaze;
#define uSunDir czm_sunDirectionWC
in vec2 v_textureCoordinates;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { if (i >= oct) break; s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
float altAt(float t, float mu) { return uCamH + t * mu + t * t / 12742000.0; }
// density: big billowing shapes, a height profile (flat base, rounded towers), eroded by detail noise
float density(vec3 p, float h, bool detail) {
  float hf = clamp((h - uBase) / (uTop - uBase), 0.0, 1.0);
  float prof = smoothstep(0.0, 0.08, hf) * smoothstep(1.0, mix(0.35, 0.75, uStrat), hf);
  vec3 q = p / 2100.0 + uWind;
  float shape = fbm(q, 3) * 0.95 + 0.25 * noise(q * 0.31);
  float d = (shape - (1.0 - uCover)) * 2.6;
  d = d * prof - (1.0 - prof) * 0.6;
  if (detail && d > -0.05) d -= (fbm(p / 430.0 + uWind * 4.0 + vec3(0.0, uTime * 0.004, 0.0), 2) - 0.42) * 0.48 * (1.0 - 0.5 * hf);
  return clamp(d, 0.0, 1.0) * uDens;
}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

void main() {
  float depth = czm_readDepth(depthTexture, v_textureCoordinates);
  vec4 eye = czm_windowToEyeCoordinates(v_textureCoordinates * czm_viewport.zw + czm_viewport.xy, depth);
  vec3 dir = normalize((czm_inverseView * vec4(normalize(eye.xyz), 0.0)).xyz);
  float scene = depth >= 1.0 ? 1e9 : length(eye.xyz);
  float mu = dot(dir, uUp), t0 = 0.0, t1 = 0.0;
  bool inside = uCamH > uBase && uCamH < uTop;
  if (inside) { t0 = 0.0; t1 = uMaxDist; if (abs(mu) > 0.002) t1 = min(t1, max((uBase - uCamH) / mu, (uTop - uCamH) / mu)); }
  else if (abs(mu) > 0.0005) { float a = (uBase - uCamH) / mu, b = (uTop - uCamH) / mu; t0 = max(0.0, min(a, b)); t1 = max(a, b); }
  t1 = min(min(t1, uMaxDist), scene);
  if (t1 <= t0) { out_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float cosT = dot(dir, uSunDir), phase = min(mix(hg(cosT, 0.6), hg(cosT, -0.2), 0.45) * 12.566, 4.0);
  float T = 1.0; vec3 col = vec3(0.0);
  float t = t0, step = max(MINSTEP, t0 * GROW); t += hash(vec3(gl_FragCoord.xy, fract(uTime))) * step;
  for (int i = 0; i < STEPS; i++) {
    if (t > t1 || T < 0.02) break;
    step = clamp(t * GROW, MINSTEP, MAXSTEP);
    vec3 p = uCamRel + dir * t; float h = altAt(t, mu);
    float d = density(p, h, true);
    if (d > 0.001) {
      // light toward the sun through the cloud above this point
      float od = 0.0;
      for (int j = 1; j <= LSTEPS; j++) { float ls = float(j * j) * 70.0; vec3 lp = p + uSunDir * ls; od += density(lp, h + dot(uSunDir, uUp) * ls, false) * ls * 0.55; }
      float lightT = exp(-od * 0.0022), powder = 1.0 - exp(-d * 8.0);
      float hf = clamp((h - uBase) / (uTop - uBase), 0.0, 1.0);
      vec3 L = uSunCol * (lightT * mix(0.45, 1.0, powder) * phase + 0.18 * lightT) + mix(uAmbBot, uAmbTop, hf) * (0.6 + 0.6 * hf);
      float ext = d * 0.007, a = exp(-ext * step);
      col += T * L * (1.0 - a); T *= a;
    }
    t += step;
  }
  col = 1.0 - exp(-col * 1.45);                                  // tone map (keeps highlights from clipping to flat white)
  float haze = 1.0 - exp(-t0 / 22000.0);
  col = mix(col, uHaze * (1.0 - T), haze * 0.85);
  out_FragColor = vec4(col, T);
}`;
const FS_COMPOSE = `
uniform sampler2D colorTexture;
uniform sampler2D cloudTex;
in vec2 v_textureCoordinates;
void main() { vec4 s = texture(colorTexture, v_textureCoordinates), c = texture(cloudTex, v_textureCoordinates); float T = c.a + c.r + c.g + c.b < 0.002 ? 1.0 : c.a; out_FragColor = vec4(s.rgb * T + c.rgb, s.a); }`;

export function createClouds(viewer, { lite = 0 } = {}) {
  const C = window.Cesium, scene = viewer.scene, q = [{ steps: 100, lsteps: 4, min: 70, grow: 0.045, max: 1100, scale: 0.5, dist: 45000 }, { steps: 56, lsteps: 3, min: 110, grow: 0.07, max: 1500, scale: 0.4, dist: 28000 }][Math.min(lite, 1)];
  const u = { base: 1500, top: 2700, cover: 0.45, dens: 1, strat: 0, origin: new C.Cartesian3(), on: false, t0: performance.now(), sunCol: new C.Cartesian3(1, 1, 1), ambTop: new C.Cartesian3(0.7, 0.78, 0.92), ambBot: new C.Cartesian3(0.4, 0.44, 0.52), haze: new C.Cartesian3(0.7, 0.78, 0.88) };
  const camRel = new C.Cartesian3(), up = new C.Cartesian3(), wind = new C.Cartesian3();
  let comp = null;
  function build() {
    const march = new C.PostProcessStage({
      name: 'skyhawkCloudMarch', textureScale: q.scale,
      fragmentShader: FS_MARCH.replace('STEPS', q.steps).replace(/MAXSTEP/g, q.max.toFixed(1)).replace(/MINSTEP/g, q.min.toFixed(1)).replace(/GROW/g, q.grow.toFixed(3)).replace('LSTEPS', q.lsteps),
      uniforms: {
        uCamRel: () => C.Cartesian3.subtract(scene.camera.positionWC, u.origin, camRel),
        uUp: () => C.Cartesian3.normalize(scene.camera.positionWC, up),
        uCamH: () => scene.camera.positionCartographic.height,
        uBase: () => u.base, uTop: () => u.top, uCover: () => u.cover, uDens: () => u.dens, uStrat: () => u.strat, uMaxDist: () => q.dist,
        uTime: () => (performance.now() - u.t0) / 1000,
        uWind: () => { const t = (performance.now() - u.t0) / 1000; wind.x = t * 0.0016; wind.y = t * 0.0007; wind.z = 0; return wind; },
        uSunCol: () => u.sunCol, uAmbTop: () => u.ambTop, uAmbBot: () => u.ambBot, uHaze: () => u.haze,
      },
    });
    const compose = new C.PostProcessStage({ name: 'skyhawkCloudCompose', fragmentShader: FS_COMPOSE, uniforms: { cloudTex: 'skyhawkCloudMarch' } });
    comp = scene.postProcessStages.add(new C.PostProcessStageComposite({ stages: [march, compose], inputPreviousStageTexture: false }));
  }
  return {
    /** kind: 'clear' | 'few' | 'ovc'; baseM/topM: meters MSL; origin: {lat, lon} of the cloud field */
    set(kind, baseM, topM, origin) {
      u.on = kind !== 'clear';
      if (!u.on) { if (comp) comp.enabled = false; return; }
      if (!comp) build();
      comp.enabled = true;
      Object.assign(u, { base: baseM, top: topM, cover: kind === 'ovc' ? 0.82 : 0.4, dens: kind === 'ovc' ? 1.25 : 1, strat: kind === 'ovc' ? 1 : 0 });
      C.Cartesian3.fromDegrees(origin.lon, origin.lat, 0, C.Ellipsoid.WGS84, u.origin);
    },
    /** light colours from the sun's elevation (degrees) at the airplane */
    light(el) {
      const day = Math.min(1, Math.max(0, (el + 4) / 14)), warm = Math.min(1, Math.max(0, 1 - el / 12)) * day;
      u.sunCol.x = day * 1.15; u.sunCol.y = (0.97 - 0.42 * warm) * day * 1.15; u.sunCol.z = (0.92 - 0.65 * warm) * day * 1.15;
      const amb = 0.04 + 0.96 * day;
      u.ambTop.x = 0.5 * amb + 0.2 * warm; u.ambTop.y = 0.56 * amb + 0.06 * warm; u.ambTop.z = 0.7 * amb;
      u.ambBot.x = 0.22 * amb; u.ambBot.y = 0.25 * amb; u.ambBot.z = 0.32 * amb;
      u.haze.x = 0.66 * amb + 0.2 * warm; u.haze.y = 0.74 * amb + 0.06 * warm; u.haze.z = 0.86 * amb;
    },
    get enabled() { return !!(comp && comp.enabled); },
    get debug() { return u; },
  };
}
