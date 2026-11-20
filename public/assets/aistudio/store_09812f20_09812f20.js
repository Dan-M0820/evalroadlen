import { Geo } from '../engine/geo.js';
import { roadWidth, roadLength } from '../engine/network.js';
import { ROAD_TYPES, DEFAULT_VEHICLES, DEFAULT_DEMAND, DAY_TYPES, HOT_KINDS } from '../config.js';
import { parseOverpass } from './osm.js';

// Everything the user owns: roads, buildings, junction controls, rules, drivers, demand. No DOM in here.
export class Store {
  constructor() {
    this.roads = []; this.buildings = []; this.bxy = null; this.junctions = {}; this.rules = []; this.hotspots = []; this.hid = 1;
    this.vehicles = DEFAULT_VEHICLES.map(v => ({ ...v })); this.demand = [...DEFAULT_DEMAND]; this.day = 'school';
    this.name = 'Empty'; this.origin = null; this.uid = 1;
  }

  width(r) { return roadWidth(r); }
  length(r) { return roadLength(r); }

  // Make roads consistent and (re)compute the metre coordinates used by the engine and renderer.
  prepare() {
    if (this.origin) Geo.setOrigin(this.origin[0], this.origin[1]);
    for (const r of this.roads) {
      if (!ROAD_TYPES[r.type]) r.type = 'residential';
      if (!r.dir) r.dir = r.oneway ? 'fwd' : 'both'; delete r.oneway;
      r.lanes = Math.max(1, Math.min(4, r.lanes | 0 || ROAD_TYPES[r.type].lanes)); r.speed = Math.max(5, Math.min(100, +r.speed || ROAD_TYPES[r.type].speed));
    }
    for (const r of this.roads) { r.closed = !!r.closed; r.friction = Math.max(0, Math.min(1, +r.friction || 0)); r.banned = Array.isArray(r.banned) ? r.banned : []; }
    for (const h of this.hotspots) { h.xy = Geo.xy(h.ll); this.hid = Math.max(this.hid, h.id + 1); }
    let m = 0; this.roads.forEach(r => { if (r.id > m) m = r.id; }); this.uid = m + 1; this.roads.forEach(r => { if (!r.id) r.id = this.uid++; });
    this.project();
  }
  project() {
    for (const r of this.roads) {
      r._xy = r.pts.map(p => Geo.xy(p)); const xs = r._xy.map(p => p[0]), ys = r._xy.map(p => p[1]);
      r._bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    this.bxy = new Float32Array(this.buildings.length * 2);
    this.buildings.forEach((b, i) => { const [x, y] = Geo.xy(b); this.bxy[2 * i] = x; this.bxy[2 * i + 1] = y; });
  }
  bounds() {
    if (!this.roads.length) return [-500, -500, 500, 500];
    return this.roads.reduce((b, r) => [Math.min(b[0], r._bb[0]), Math.min(b[1], r._bb[1]), Math.max(b[2], r._bb[2]), Math.max(b[3], r._bb[3])], [1e9, 1e9, -1e9, -1e9]);
  }

  setDataset({ roads, buildings, name }) {
    this.roads = roads; this.buildings = buildings || []; this.junctions = {}; this.rules = []; this.hotspots = []; this.name = name || 'Imported map';
    const pts = roads.flatMap(r => r.pts);
    if (pts.length) this.origin = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    this.prepare();
  }

  // ---- hotspots: pinned places that pull trips in or push them out
  addHotspot(xy, kind = 'school') {
    const k = HOT_KINDS[kind], h = { id: this.hid++, name: `${k.n} ${this.hotspots.length + 1}`, kind, role: k.role, weight: k.weight, radius: 150, from: k.from, to: k.to, ll: Geo.ll(xy[0], xy[1]), xy: [xy[0], xy[1]] };
    this.hotspots.push(h); return h;
  }
  moveHotspot(h, xy) { h.xy = [xy[0], xy[1]]; h.ll = Geo.ll(xy[0], xy[1]); }

  // ---- workbench: a separate copy of the area around a point. Edit and test it on its own, then merge it back in one go.
  // Everything outside the area stays untouched in this.main, so editing and simulating only touches the roads nearby.
  enterWorkbench(c, R) {
    const dist = r => { let m = 1e9; for (let i = 0; i < r._xy.length - 1; i++) { const A = r._xy[i], B = r._xy[i + 1], dx = B[0] - A[0], dy = B[1] - A[1], t = Math.max(0, Math.min(1, ((c[0] - A[0]) * dx + (c[1] - A[1]) * dy) / (dx * dx + dy * dy || 1))); m = Math.min(m, Math.hypot(c[0] - A[0] - t * dx, c[1] - A[1] - t * dy)); } return m; };
    const ids = new Set(), sub = [], clone = r => { const o = { ...r, pts: r.pts.map(p => [...p]), banned: [...(r.banned || [])] }; delete o._xy; delete o._bb; return o; };
    for (const r of this.roads) if (dist(r) <= R) { ids.add(r.id); sub.push(clone(r)); }
    const keys = new Set(sub.flatMap(r => r.pts.map(p => Geo.key(p)))), jn = {};
    for (const k in this.junctions) if (keys.has(k)) jn[k] = JSON.parse(JSON.stringify(this.junctions[k]));
    const hotIds = new Set(), hs = this.hotspots.filter(h => Math.hypot(h.xy[0] - c[0], h.xy[1] - c[1]) <= R + 300).map(h => { hotIds.add(h.id); return { ...h, ll: [...h.ll], xy: [...h.xy] }; });
    const bl = this.buildings.filter((b, i) => Math.hypot(this.bxy[2 * i] - c[0], this.bxy[2 * i + 1] - c[1]) <= R + 250);
    const rk = r => JSON.stringify([r.name, r.type, r.lanes, r.speed, r.dir, r.pts, r.closed, r.friction, r.banned]);
    this.main = { roads: this.roads, buildings: this.buildings, bxy: this.bxy, junctions: this.junctions, hotspots: this.hotspots, uid: this.uid, hid: this.hid };
    this.wb = { c, R, ids, keys, hotIds, orig: new Map(sub.map(r => [r.id, rk(r)])), origJ: JSON.stringify(jn), rk };
    this.roads = sub; this.junctions = jn; this.hotspots = hs; this.buildings = bl; this.project();
    return ids;
  }
  // Merge the workbench back into the town. Returns a short summary of what changed.
  applyWorkbench() {
    const { main, wb } = this, subById = new Map(this.roads.map(r => [r.id, r])), merged = [], used = new Set(); let changed = 0, added = 0, removed = 0;
    for (const r of main.roads) { if (!wb.ids.has(r.id)) { merged.push(r); continue; } const s = subById.get(r.id); if (!s) { removed++; continue; } merged.push(s); used.add(r.id); if (wb.rk(s) !== wb.orig.get(r.id)) changed++; }
    for (const s of this.roads) if (!used.has(s.id)) { merged.push(s); added++; }
    const jn = { ...main.junctions }; for (const k of wb.keys) delete jn[k]; Object.assign(jn, this.junctions);
    const ctl = JSON.stringify(this.junctions) !== wb.origJ;
    const hot = main.hotspots.filter(h => !wb.hotIds.has(h.id)).concat(this.hotspots);
    this.roads = merged; this.junctions = jn; this.hotspots = hot; this.buildings = main.buildings; this.uid = Math.max(main.uid, this.uid); this.hid = Math.max(main.hid, this.hid);
    this.main = null; this.wb = null; this.prepare();
    return `${changed} road(s) changed, ${added} added, ${removed} removed${ctl ? ', junction controls updated' : ''}`;
  }
  discardWorkbench() {
    const { main } = this; Object.assign(this, { roads: main.roads, buildings: main.buildings, bxy: main.bxy, junctions: main.junctions, hotspots: main.hotspots });
    this.main = null; this.wb = null;
  }

  // Cut a road in two at a point so each half can be edited separately (different speed, one-way, closed...).
  split(r, ll) {
    this.insertPoint(r, ll); const k = Geo.key(ll), i = r.pts.findIndex(p => Geo.key(p) === k);
    if (i <= 0 || i >= r.pts.length - 1) return null;
    const b = { ...r, id: this.uid++, pts: r.pts.slice(i), banned: [...(r.banned || [])] }; delete b._xy; delete b._bb;
    r.pts = r.pts.slice(0, i + 1); this.roads.splice(this.roads.indexOf(r) + 1, 0, b); return b;
  }

  make(type, pts, dir = 'both', name) { const t = ROAD_TYPES[type]; return { name: name || `${t.label} ${this.uid}`, type, lanes: t.lanes, speed: t.speed, dir, pts }; }
  add(r) { r.id = this.uid++; this.roads.push(r); return r; }
  del(r) { this.roads = this.roads.filter(x => x !== r); this.rules = this.rules.filter(x => x.r != r.id); }
  // add a vertex to a road so another road can connect to it mid-way
  insertPoint(r, ll) {
    const k = Geo.key(ll); if (r.pts.some(p => Geo.key(p) === k)) return;
    const [px, py] = Geo.xy(ll); let bi = 0, bd = 1e18;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, ay] = Geo.xy(r.pts[i]), [bx, by] = Geo.xy(r.pts[i + 1]), dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d < bd) { bd = d; bi = i; }
    }
    r.pts.splice(bi + 1, 0, ll);
  }

  pack() {
    return { v: 3, name: this.name, origin: this.origin, roads: this.roads.map(({ id, name, type, lanes, speed, dir, pts, osm, closed, friction, banned }) => ({ id, name, type, lanes, speed, dir, pts, osm, closed, friction, banned })), hotspots: this.hotspots.map(({ xy, ...h }) => h),
      buildings: this.buildings, junctions: this.junctions, rules: this.rules, vehicles: this.vehicles, demand: this.demand, day: this.day };
  }
  unpack(j) {
    this.name = j.name || 'Loaded project'; this.origin = j.origin || null; this.roads = j.roads || []; this.buildings = j.buildings || [];
    this.junctions = j.junctions || {}; this.rules = j.rules || []; this.hotspots = j.hotspots || [];
    if (j.vehicles && j.vehicles.length) this.vehicles = j.vehicles;
    if (j.demand && j.demand.length === 24) this.demand = j.demand; if (j.day && DAY_TYPES[j.day]) this.day = j.day;
    if (!this.origin && this.roads.length) { const pts = this.roads.flatMap(r => r.pts); this.origin = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]; }
    this.prepare();
  }

  geojson() {
    return { type: 'FeatureCollection', features: this.roads.map(r => ({ type: 'Feature', properties: { name: r.name, type: r.type, lanes: r.lanes, speed: r.speed, dir: r.dir, closed: r.closed },
      geometry: { type: 'LineString', coordinates: r.pts.map(p => [p[1], p[0]]) } })) };
  }

  // Accepts: a saved project, GeoJSON roads, an Overpass JSON export, or a plain road array. Returns a short description.
  fromText(txt) {
    const j = JSON.parse(txt);
    if (j.elements) { const ds = parseOverpass(j); if (!ds.roads.length) throw new Error('No roads in that Overpass file'); this.setDataset({ ...ds, name: 'Imported OpenStreetMap data' }); return 'OpenStreetMap data'; }
    if (j.type === 'FeatureCollection') {
      const roads = j.features.filter(f => f.geometry && /LineString/.test(f.geometry.type)).flatMap(f => {
        const p = f.properties || {}, type = ROAD_TYPES[p.type] ? p.type : 'residential', t = ROAD_TYPES[type];
        const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
        return lines.map(c => ({ name: p.name || t.label, type, lanes: +p.lanes || t.lanes, speed: +p.speed || t.speed, dir: ['fwd', 'rev'].includes(p.dir) ? p.dir : p.oneway ? 'fwd' : 'both', pts: c.map(q => [q[1], q[0]]) }));
      });
      this.setDataset({ roads, buildings: this.buildings, name: 'Imported roads' }); return 'GeoJSON roads';
    }
    if (Array.isArray(j)) { this.setDataset({ roads: j, buildings: this.buildings, name: 'Imported roads' }); return 'road list'; }
    this.unpack(j); return 'project';
  }
}
