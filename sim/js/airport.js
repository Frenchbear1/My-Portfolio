// Airport + runway lookup from the FAA AIS open-data ArcGIS services (public, key-less, CORS-enabled).
// Runway end geometry logic adapted from David's 3D Flight Sim (Frenchbear1/3D-Flight-Sim).
const FAA = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services';
const D2R = Math.PI / 180, R2D = 180 / Math.PI, RE_NM = 3440.065, NM = 1852, FT = 0.3048;
const norm360 = d => ((d % 360) + 360) % 360, angDiff = (a, b) => ((b - a + 540) % 360) - 180;
export function distNM(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * RE_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  return norm360(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D);
}
const roughMagVar = (lat, lon) => Math.max(-22, Math.min(22, -(lon + 92.5) * 0.58 + (lat - 38) * -0.08));

async function query(service, where, fields = '*') {
  const p = new URLSearchParams({ where, outFields: fields, outSR: '4326', f: 'geojson', returnGeometry: 'true', geometryPrecision: '6', resultRecordCount: '40' });
  const url = `${FAA}/${service}/FeatureServer/0/query?${p}`;
  let store = null;
  try { store = await caches.open('skyhawk-faa-v1'); const hit = await store.match(url); if (hit) return (await hit.json()).features || []; } catch { /* no cache */ }
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url);
    if ((r.status === 429 || r.status >= 500) && attempt < 2) { await new Promise(res => setTimeout(res, 1200 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error('FAA HTTP ' + r.status);
    const text = await r.text(), j = JSON.parse(text);
    if (j.error) throw new Error('FAA: ' + (j.error.message || 'query error'));
    if (store) store.put(url, new Response(text, { headers: { 'content-type': 'application/json' } })).catch(() => {});
    return j.features || [];
  }
}
const esc = s => String(s).replace(/[^A-Z0-9]/gi, '').toUpperCase();
function rwyNum(s) { const m = /(\d{1,2})/.exec(s || ''); if (m) return +m[1] * 10; return { N: 360, S: 180, E: 90, W: 270, NE: 45, NW: 315, SE: 135, SW: 225 }[(s || '').replace(/[^NSEW]/g, '')] ?? null; }

function runwayFromFeature(f) {
  const p = f.properties, g = f.geometry; if (!g) return null;
  let ring = (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]).slice();
  if (ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  if (ring.length < 4) return null;
  const edges = ring.map((a, i) => { const b = ring[(i + 1) % ring.length]; return { d: distNM(a[1], a[0], b[1], b[0]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; }).sort((x, y) => x.d - y.d);
  let e1 = edges[0], e2 = edges.slice(1).sort((x, y) => distNM(y.mid[1], y.mid[0], e1.mid[1], e1.mid[0]) - distNM(x.mid[1], x.mid[0], e1.mid[1], e1.mid[0]))[0];
  const [n1, n2] = (p.DESIGNATOR || '').split('/'), want = rwyNum(n1), mv = roughMagVar(e1.mid[1], e1.mid[0]);
  if (want != null && Math.abs(angDiff(bearing(e1.mid[1], e1.mid[0], e2.mid[1], e2.mid[0]) - mv, want)) > 90) [e1, e2] = [e2, e1];
  const hdg = bearing(e1.mid[1], e1.mid[0], e2.mid[1], e2.mid[0]), lenFt = +p.LENGTH || distNM(e1.mid[1], e1.mid[0], e2.mid[1], e2.mid[0]) * NM / FT;
  const widthFt = +p.WIDTH || e1.d * NM / FT, surf = p.COMP_CODE || '';
  if (/WATER/.test(surf) || lenFt < 1200) return null;
  return { des: p.DESIGNATOR || '?', lengthFt: lenFt, widthFt, surf, lit: !!p.LIGHTINTNS, ring,
    ends: [{ name: n1 || '?', lat: e1.mid[1], lon: e1.mid[0], hdg }, { name: n2 || '?', lat: e2.mid[1], lon: e2.mid[0], hdg: norm360(hdg + 180) }] };
}

/** Find an airport by ICAO / FAA ident. Returns {ident, icao, name, city, state, lat, lon, elevFt, runways:[...]} or null. */
export async function findAirport(id) {
  id = esc(id); if (id.length < 3) return null;
  const alt = id.length === 4 && id[0] === 'K' ? id.slice(1) : null;
  const fs = await query('US_Airport', `(IDENT='${id}' OR ICAO_ID='${id}'${alt ? ` OR IDENT='${alt}'` : ''}) AND OPERSTATUS='OPERATIONAL'`,
    'GLOBAL_ID,IDENT,NAME,ELEVATION,ICAO_ID,TYPE_CODE,SERVCITY,STATE');
  const f = fs.find(x => x.properties.TYPE_CODE === 'AD') || fs[0]; if (!f) return null;
  const p = f.properties;
  const a = { id: p.GLOBAL_ID, ident: p.IDENT, icao: p.ICAO_ID || '', name: p.NAME, city: p.SERVCITY, state: p.STATE, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], elevFt: +p.ELEVATION || 0, runways: [] };
  const rs = await query('Runways', `AIRPORT_ID='${a.id}'`, 'GLOBAL_ID,AIRPORT_ID,DESIGNATOR,LENGTH,WIDTH,COMP_CODE,LIGHTINTNS');
  a.runways = rs.map(runwayFromFeature).filter(Boolean).sort((x, y) => y.lengthFt - x.lengthFt);
  return a;
}
