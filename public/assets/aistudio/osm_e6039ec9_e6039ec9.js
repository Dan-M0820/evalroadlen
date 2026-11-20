// OpenStreetMap via the Overpass API: the only outside service the app uses (roads and building positions).
import { ROAD_TYPES } from '../config.js';

// [south, west, north, east]. Approximate boxes around the two poblaciones; edit in the app if the edges are off.
export const AREAS = {
  both:      { n: 'Bayombong + Solano', bbox: [16.46, 121.12, 16.54, 121.21] },
  bayombong: { n: 'Bayombong centro',   bbox: [16.465, 121.13, 16.50, 121.17] },
  solano:    { n: 'Solano centro',      bbox: [16.50, 121.165, 16.535, 121.205] }
};
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const KINDS = Object.values(ROAD_TYPES).flatMap(t => t.osm);

export function overpassQuery([s, w, n, e]) {
  const bb = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:120];
way["highway"~"^(${KINDS.join('|')})$"]["access"!~"^(no|private)$"]["service"!~"^(parking_aisle|driveway|drive-through)$"]${bb};
out geom;
way["building"]${bb};
out center;`;
}

export async function fetchArea(bbox, status = () => {}) {
  let err;
  for (const url of ENDPOINTS) {
    try {
      status('Asking OpenStreetMap (Overpass) for roads and buildings…');
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(overpassQuery(bbox)) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      status('Reading the data…');
      return parseOverpass(await res.json());
    } catch (e) { err = e; }
  }
  throw err;
}

const typeOf = hw => Object.keys(ROAD_TYPES).find(k => ROAD_TYPES[k].osm.includes(hw));
const round = n => Math.round(n * 1e6) / 1e6;

// Overpass JSON -> { roads, buildings }. Roads sharing a point share coordinates, which is how the network knows they connect.
export function parseOverpass(json) {
  const roads = [], buildings = []; let id = 1;
  for (const el of json.elements || []) {
    const t = el.tags || {};
    if (t.highway && el.geometry) {
      const type = typeOf(t.highway); if (!type) continue;
      const pts = el.geometry.filter(Boolean).map(g => [round(g.lat), round(g.lon)]); if (pts.length < 2) continue;
      const def = ROAD_TYPES[type];
      const dir = t.oneway === '-1' || t.oneway === 'reverse' ? 'rev' : (['yes', 'true', '1'].includes(t.oneway) || t.junction === 'roundabout') ? 'fwd' : 'both';
      const n = parseInt(t.lanes), lanes = n > 0 ? Math.max(1, Math.min(4, dir === 'both' ? Math.round(n / 2) : n)) : def.lanes;
      const sp = parseInt(t.maxspeed);
      roads.push({ id: id++, osm: el.id, name: t.name || t.ref || `${def.label} ${el.id}`, type, lanes, speed: sp > 0 ? Math.min(100, sp) : def.speed, dir, pts });
    } else if (t.building && el.center) buildings.push([round(el.center.lat), round(el.center.lon)]);
  }
  return { roads, buildings };
}
