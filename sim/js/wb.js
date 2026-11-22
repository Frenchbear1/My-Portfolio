// Cessna 172S weight and balance: loading stations, CG envelope (normal and utility category) and
// a small envelope chart. Arms in inches aft of the datum (front face of the firewall).
// Station arms and limits per the 172S POH, Section 6; empty weight is a typical example and is editable.
export const STATIONS = [
  { k: 'empty', label: 'Basic empty weight', arm: 40.2, def: 1680, max: 1900, unit: 'lb', editArm: true },
  { k: 'front', label: 'Pilot & front passenger', arm: 37.0, def: 190, max: 500, unit: 'lb' },
  { k: 'rear', label: 'Rear passengers', arm: 73.0, def: 0, max: 500, unit: 'lb' },
  { k: 'bagA', label: 'Baggage area A', arm: 95.0, def: 0, max: 120, unit: 'lb' },
  { k: 'bagB', label: 'Baggage area B', arm: 123.0, def: 0, max: 50, unit: 'lb' },
  { k: 'fuel', label: 'Fuel (usable)', arm: 48.0, def: 53, max: 53, unit: 'gal', lbPer: 6 },
];
export const LIMITS = { maxTO: 2550, maxRamp: 2558, utilMax: 2200, bagMax: 120, aft: 47.3, utilAft: 40.5 };
/** Forward CG limit (in) at a weight. Normal: 35.0 at <=1950 lb, straight line to 41.0 at 2550. */
export const fwdLimit = lb => (lb <= 1950 ? 35.0 : 35.0 + (lb - 1950) * (6.0 / 600));
const NORMAL = [[35.0, 1500], [35.0, 1950], [41.0, 2550], [47.3, 2550], [47.3, 1500]];
const UTILITY = [[35.0, 1500], [35.0, 1950], [37.5, 2200], [40.5, 2200], [40.5, 1500]];
export const defaults = () => Object.fromEntries(STATIONS.map(s => [s.k, s.def]).concat([['emptyArm', 40.2]]));

export function compute(load, fuelGal = load.fuel) {
  let lb = 0, mom = 0;
  for (const s of STATIONS) {
    const v = Math.max(0, +(s.k === 'fuel' ? fuelGal : load[s.k]) || 0), w = s.lbPer ? v * s.lbPer : v, arm = s.k === 'empty' ? +load.emptyArm || s.arm : s.arm;
    lb += w; mom += w * arm;
  }
  const cg = lb ? mom / lb : 0, fwd = fwdLimit(lb), issues = [];
  if (lb > LIMITS.maxTO) issues.push(`${Math.round(lb - LIMITS.maxTO)} lb over max takeoff weight`);
  if (cg < fwd - 0.005) issues.push(`CG ${(fwd - cg).toFixed(1)} in forward of limit`);
  if (cg > LIMITS.aft + 0.005) issues.push(`CG ${(cg - LIMITS.aft).toFixed(1)} in aft of limit`);
  if ((+load.bagA || 0) + (+load.bagB || 0) > LIMITS.bagMax) issues.push('Baggage over 120 lb combined');
  if ((+load.bagB || 0) > 50) issues.push('Baggage B over 50 lb');
  const utilFwd = lb <= 1950 ? 35.0 : 35.0 + (lb - 1950) * (2.5 / 250);
  const utility = !issues.length && lb <= LIMITS.utilMax && cg >= utilFwd && cg <= LIMITS.utilAft && !(+load.rear) && !(+load.bagA) && !(+load.bagB);
  return { lb, mom, cg, ok: !issues.length, issues, utility, fwd };
}

/** Envelope chart: normal (outline) and utility (shaded) with the takeoff point and the fuel-burn line to empty tanks. */
export function drawEnvelope(cv, load) {
  const g = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth || 300, H = cv.clientHeight || 170;
  cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const x0 = 33, x1 = 50, y0 = 1500, y1 = 2700, L = 34, R = 8, T = 8, B = 22;
  const X = v => L + (v - x0) / (x1 - x0) * (W - L - R), Y = v => H - B - (v - y0) / (y1 - y0) * (H - T - B);
  g.font = '600 10px ui-monospace,Menlo,monospace'; g.fillStyle = 'rgba(255,255,255,.55)'; g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1;
  for (let v = 34; v <= 50; v += 2) { g.beginPath(); g.moveTo(X(v), T); g.lineTo(X(v), H - B); g.stroke(); g.textAlign = 'center'; g.fillText(v, X(v), H - 7); }
  for (let v = 1600; v <= 2600; v += 200) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); g.textAlign = 'right'; g.fillText(v, L - 4, Y(v) + 3); }
  const poly = (pts, fill, stroke) => { g.beginPath(); pts.forEach(([c, w], i) => (i ? g.lineTo(X(c), Y(w)) : g.moveTo(X(c), Y(w)))); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); } };
  poly(NORMAL, 'rgba(90,169,255,.12)', '#5aa9ff'); poly(UTILITY, 'rgba(61,220,132,.16)', 'rgba(61,220,132,.8)');
  const full = compute(load), dry = compute(load, 0);
  g.strokeStyle = 'rgba(255,200,87,.8)'; g.setLineDash([4, 3]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(full.cg), Y(full.lb)); g.lineTo(X(dry.cg), Y(dry.lb)); g.stroke(); g.setLineDash([]);
  g.fillStyle = full.ok ? '#ffc857' : '#ff5d5d'; g.beginPath(); g.arc(X(Math.max(x0, Math.min(x1, full.cg))), Y(Math.max(y0, Math.min(y1, full.lb))), 5.5, 0, 7); g.fill(); g.strokeStyle = '#04101f'; g.lineWidth = 2; g.stroke();
  g.textAlign = 'left'; g.fillStyle = 'rgba(61,220,132,.9)'; g.fillText('UTILITY', X(35.3), Y(1580)); g.fillStyle = '#5aa9ff'; g.fillText('NORMAL', X(43.5), Y(2480));
}
