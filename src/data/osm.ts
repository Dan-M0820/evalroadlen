import { ROAD_TYPES } from '../config';
import type { Road, RoadTypeKey } from '../types';

export interface AreaDef {
  n: string;
  bbox: [number, number, number, number];
}

export const AREAS: Record<string, AreaDef> = {
  both:      { n: 'Bayombong + Solano', bbox: [16.46, 121.12, 16.54, 121.21] },
  bayombong: { n: 'Bayombong centro',   bbox: [16.465, 121.13, 16.5, 121.17] },
  solano:    { n: 'Solano centro',      bbox: [16.5, 121.165, 16.535, 121.205] },
};

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const KINDS = Object.values(ROAD_TYPES).flatMap(t => t.osm);

export function overpassQuery([s, w, n, e]: [number, number, number, number]): string {
  const bb = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:120];
way["highway"~"^(${KINDS.join('|')})$"]["access"!~"^(no|private)$"]["service"!~"^(parking_aisle|driveway|drive-through)$"]${bb};
out geom;
way["building"]${bb};
out center;`;
}

export interface ParsedDataset {
  roads: Road[];
  buildings: [number, number][];
  name?: string;
}

export async function fetchBundledBayombongSolano(): Promise<ParsedDataset> {
  const res = await fetch('/assets/aistudio/bayombongSolano_57d00d2e.json');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  const ds = parseOverpass(json);
  if (!ds.roads.length) throw new Error('Bundled Bayombong & Solano file had no roads');
  return { ...ds, name: 'Bayombong + Solano (OpenStreetMap)' };
}

export async function fetchArea(bbox: [number, number, number, number], status: (msg: string) => void = () => {}): Promise<ParsedDataset> {
  let err: unknown;
  for (const url of ENDPOINTS) {
    try {
      status('Asking OpenStreetMap (Overpass) for roads and buildings…');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(overpassQuery(bbox)),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      status('Reading the data…');
      return parseOverpass(await res.json());
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

const typeOf = (hw: string): RoadTypeKey | undefined =>
  (Object.keys(ROAD_TYPES) as RoadTypeKey[]).find(k => ROAD_TYPES[k].osm.includes(hw));

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export interface OverpassJson {
  elements?: Array<{
    type?: string;
    id: number;
    tags?: Record<string, string>;
    geometry?: Array<{ lat: number; lon: number } | null>;
    center?: { lat: number; lon: number };
  }>;
}

export function parseOverpass(json: OverpassJson): ParsedDataset {
  const roads: Road[] = [];
  const buildings: [number, number][] = [];
  let id = 1;
  for (const el of json.elements || []) {
    const t = el.tags || {};
    if (t.highway && el.geometry) {
      const type = typeOf(t.highway);
      if (!type) continue;
      const pts: [number, number][] = el.geometry.filter((g): g is { lat: number; lon: number } => Boolean(g)).map(g => [round(g.lat), round(g.lon)]);
      if (pts.length < 2) continue;
      const def = ROAD_TYPES[type];
      const dir =
        t.oneway === '-1' || t.oneway === 'reverse'
          ? 'rev'
          : ['yes', 'true', '1'].includes(t.oneway) || t.junction === 'roundabout'
            ? 'fwd'
            : 'both';
      const n = parseInt(t.lanes, 10);
      const lanes = n > 0 ? Math.max(1, Math.min(4, dir === 'both' ? Math.round(n / 2) : n)) : def.lanes;
      const sp = parseInt(t.maxspeed, 10);
      roads.push({
        id: id++,
        osm: el.id,
        name: t.name || t.ref || `${def.label} ${el.id}`,
        type,
        lanes,
        speed: sp > 0 ? Math.min(100, sp) : def.speed,
        dir,
        pts,
      });
    } else if (t.building && el.center) {
      buildings.push([round(el.center.lat), round(el.center.lon)]);
    }
  }
  return { roads, buildings };
}
