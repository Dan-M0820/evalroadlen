import { Geo } from '../engine/geo';
import { roadWidth, roadLength } from '../engine/network';
import { ROAD_TYPES, DEFAULT_VEHICLES, DEFAULT_DEMAND, DAY_TYPES, HOT_KINDS } from '../config';
import { parseOverpass } from './osm';
import type {
  DayTypeKey,
  Hotspot,
  HotspotKindKey,
  JunctionConfig,
  Road,
  RoadDir,
  RoadTypeKey,
  TrafficRule,
  VehicleType,
} from '../types';

export interface PackedStore {
  v?: number;
  name?: string;
  origin?: [number, number] | null;
  roads?: Array<Omit<Road, '_xy' | '_bb'>>;
  hotspots?: Array<Omit<Hotspot, 'xy'> & { priority?: number }>;
  buildings?: [number, number][];
  junctions?: Record<string, JunctionConfig>;
  rules?: TrafficRule[];
  vehicles?: VehicleType[];
  demand?: number[];
  day?: DayTypeKey;
}

export interface WorkbenchSnapshot {
  roads: Array<Omit<Road, '_xy' | '_bb'>>;
  junctions: Record<string, JunctionConfig>;
  hotspots: Array<Omit<Hotspot, 'xy'>>;
  uid: number;
  hid: number;
}

export interface WorkbenchMeta {
  c: [number, number];
  R: number;
  ids: Set<number>;
  keys: Set<string>;
  hotIds: Set<number>;
  orig: Map<number, string>;
  origJ: string;
  rk: (r: Road) => string;
}

export interface MainBackup {
  roads: Road[];
  buildings: [number, number][];
  bxy: Float32Array | null;
  junctions: Record<string, JunctionConfig>;
  hotspots: Hotspot[];
  uid: number;
  hid: number;
}

const llRound = (ll: [number, number]): [number, number] => [
  Math.round(ll[0] * 1e6) / 1e6,
  Math.round(ll[1] * 1e6) / 1e6,
];

export class Store {
  roads: Road[] = [];
  buildings: [number, number][] = [];
  bxy: Float32Array | null = null;
  junctions: Record<string, JunctionConfig> = {};
  rules: TrafficRule[] = [];
  hotspots: Hotspot[] = [];
  hid = 1;
  vehicles: VehicleType[] = DEFAULT_VEHICLES.map(v => ({ ...v }));
  demand: number[] = [...DEFAULT_DEMAND];
  day: DayTypeKey = 'school';
  name = 'Empty';
  origin: [number, number] | null = null;
  uid = 1;
  main: MainBackup | null = null;
  wb: WorkbenchMeta | null = null;
  undoStack: WorkbenchSnapshot[] = [];
  redoStack: WorkbenchSnapshot[] = [];

  width(r: Road): number {
    return roadWidth(r);
  }

  length(r: Road): number {
    return roadLength(r);
  }

  prepare() {
    if (this.origin) Geo.setOrigin(this.origin[0], this.origin[1]);
    for (const r of this.roads as Array<Road & { oneway?: boolean }>) {
      if (!ROAD_TYPES[r.type]) r.type = 'residential';
      if (!r.dir) r.dir = r.oneway ? 'fwd' : 'both';
      delete r.oneway;
      r.lanes = Math.max(1, Math.min(4, (r.lanes | 0) || ROAD_TYPES[r.type].lanes));
      if (r.lanesR != null) r.lanesR = Math.max(1, Math.min(4, (r.lanesR | 0) || r.lanes));
      r.speed = Math.max(5, Math.min(100, +r.speed || ROAD_TYPES[r.type].speed));
      r.closed = !!r.closed;
      r.friction = Math.max(0, Math.min(1, +(r.friction || 0)));
      r.banned = Array.isArray(r.banned) ? r.banned : [];
    }
    for (const h of this.hotspots) {
      if (!HOT_KINDS[h.kind]) h.kind = 'other';
      const def = HOT_KINDS[h.kind];
      h.priority = Math.max(0, Math.min(100, h.priority == null ? def.priority : Math.round(+h.priority)));
      h.weight = Math.max(1, Math.min(10, Math.round(+h.weight || def.weight)));
      h.radius = Math.max(30, Math.min(800, Math.round(+h.radius || 150)));
      h.xy = Geo.xy(h.ll);
      this.hid = Math.max(this.hid, h.id + 1);
    }
    let m = 0;
    this.roads.forEach(r => {
      if (r.id > m) m = r.id;
    });
    this.uid = Math.max(this.uid, m + 1);
    this.roads.forEach(r => {
      if (!r.id) r.id = this.uid++;
    });
    this.project();
  }

  project() {
    for (const r of this.roads) {
      r._xy = r.pts.map(p => Geo.xy(p));
      const xs = r._xy.map(p => p[0]);
      const ys = r._xy.map(p => p[1]);
      r._bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    this.bxy = new Float32Array(this.buildings.length * 2);
    this.buildings.forEach((b, i) => {
      const [x, y] = Geo.xy(b);
      this.bxy![2 * i] = x;
      this.bxy![2 * i + 1] = y;
    });
  }

  bounds(): [number, number, number, number] {
    if (!this.roads.length) return [-500, -500, 500, 500];
    return this.roads.reduce<[number, number, number, number]>(
      (b, r) => [
        Math.min(b[0], r._bb![0]),
        Math.min(b[1], r._bb![1]),
        Math.max(b[2], r._bb![2]),
        Math.max(b[3], r._bb![3]),
      ],
      [1e9, 1e9, -1e9, -1e9]
    );
  }

  setDataset({ roads, buildings, name }: { roads: Road[]; buildings?: [number, number][]; name?: string }) {
    this.roads = roads;
    this.buildings = buildings || [];
    this.junctions = {};
    this.rules = [];
    this.hotspots = [];
    this.name = name || 'Imported map';
    const pts = roads.flatMap(r => r.pts);
    if (pts.length) {
      this.origin = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    }
    this.prepare();
  }

  // ---- hotspots -------------------------------------------------------------------------------
  addHotspot(xy: [number, number], kind: HotspotKindKey = 'school', priority?: number): Hotspot {
    const k = HOT_KINDS[kind] || HOT_KINDS.other;
    const pr = priority == null ? k.priority : Math.max(0, Math.min(100, Math.round(priority)));
    const h: Hotspot = {
      id: this.hid++,
      name: `${k.n.split(' (')[0]} ${this.hotspots.length + 1}`,
      kind,
      role: k.role,
      weight: k.weight,
      priority: pr,
      radius: 150,
      from: k.from,
      to: k.to,
      ll: Geo.ll(xy[0], xy[1]),
      xy: [xy[0], xy[1]],
    };
    this.hotspots.push(h);
    return h;
  }

  moveHotspot(h: Hotspot, xy: [number, number]) {
    h.xy = [xy[0], xy[1]];
    h.ll = Geo.ll(xy[0], xy[1]);
  }

  // ---- undo / redo (primarily for workbench visual editing) ----------------------------------
  private captureSnapshot(): WorkbenchSnapshot {
    return {
      roads: this.roads.map(r => {
        const o = { ...r, pts: r.pts.map(p => [...p] as [number, number]), banned: [...(r.banned || [])] };
        delete o._xy;
        delete o._bb;
        return o;
      }),
      junctions: JSON.parse(JSON.stringify(this.junctions)),
      hotspots: this.hotspots.map(({ xy: _xy, ...h }) => ({ ...h, ll: [...h.ll] as [number, number] })),
      uid: this.uid,
      hid: this.hid,
    };
  }

  private restoreSnapshot(snap: WorkbenchSnapshot) {
    this.roads = snap.roads.map(r => ({ ...r, pts: r.pts.map(p => [...p] as [number, number]), banned: [...(r.banned || [])] }));
    this.junctions = JSON.parse(JSON.stringify(snap.junctions));
    this.hotspots = snap.hotspots.map(h => ({ ...h, ll: [...h.ll] as [number, number], xy: Geo.xy(h.ll) }));
    this.uid = snap.uid;
    this.hid = snap.hid;
    this.prepare();
  }

  pushUndo() {
    this.undoStack.push(this.captureSnapshot());
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.redoStack.push(this.captureSnapshot());
    this.restoreSnapshot(snap);
    return true;
  }

  redo(): boolean {
    const snap = this.redoStack.pop();
    if (!snap) return false;
    this.undoStack.push(this.captureSnapshot());
    this.restoreSnapshot(snap);
    return true;
  }

  // ---- vertex movement & templates ------------------------------------------------------------
  moveNode(oldKey: string, newXY: [number, number]): string {
    const newLL = llRound(Geo.ll(newXY[0], newXY[1]));
    const newKey = Geo.key(newLL);
    for (const r of this.roads) {
      for (let i = 0; i < r.pts.length; i++) {
        if (Geo.key(r.pts[i]) === oldKey) {
          r.pts[i] = [...newLL] as [number, number];
        }
      }
    }
    if (oldKey !== newKey && this.junctions[oldKey]) {
      this.junctions[newKey] = this.junctions[oldKey];
      delete this.junctions[oldKey];
    }
    this.project();
    return newKey;
  }

  insertTemplate(kind: 'cross' | 't' | 'roundabout', centerXY: [number, number], existingNodeKey?: string) {
    this.pushUndo();
    const [cx, cy] = centerXY;

    if (kind === 'roundabout') {
      const R = 22;
      // Convert or attach existing roads near the center onto the roundabout ring
      if (existingNodeKey) {
        // Detach/trim roads touching existingNodeKey back to radius R
        const updatedRoads: Road[] = [];
        for (const r of this.roads) {
          const hitIndices = r.pts.map((p, i) => (Geo.key(p) === existingNodeKey ? i : -1)).filter(i => i >= 0);
          if (!hitIndices.length) {
            updatedRoads.push(r);
            continue;
          }
          const idx = hitIndices[0];
          const attachSide = (ptsSlice: [number, number][]): [number, number][] | null => {
            if (ptsSlice.length < 2) return null;
            const out = ptsSlice.slice();
            while (out.length > 2) {
              const p1 = Geo.xy(out[1]);
              if (Math.hypot(p1[0] - cx, p1[1] - cy) < R * 0.95) out.splice(1, 1);
              else break;
            }
            const first = Geo.xy(out[0]);
            const second = Geo.xy(out[1]);
            const dx = second[0] - first[0];
            const dy = second[1] - first[1];
            const len = Math.hypot(dx, dy) || 1;
            const ringPt = llRound(Geo.ll(cx + (dx / len) * R, cy + (dy / len) * R));
            out[0] = ringPt;
            return out;
          };

          if (idx === 0) {
            const p = attachSide(r.pts);
            if (p) {
              r.pts = p;
              updatedRoads.push(r);
            }
          } else if (idx === r.pts.length - 1) {
            const p = attachSide(r.pts.slice().reverse());
            if (p) {
              r.pts = p.reverse();
              updatedRoads.push(r);
            }
          } else {
            // Split through-road into two approach legs terminating on opposite sides of the ring
            const legA = attachSide(r.pts.slice(0, idx + 1).reverse());
            const legB = attachSide(r.pts.slice(idx));
            if (legA) {
              r.pts = legA.reverse();
              updatedRoads.push(r);
            }
            if (legB) {
              updatedRoads.push({
                ...r,
                id: this.uid++,
                pts: legB,
                banned: [...(r.banned || [])],
              });
            }
          }
        }
        this.roads = updatedRoads;
        delete this.junctions[existingNodeKey];
      } else {
        // Standalone roundabout with 4 cardinal approach legs
        const armLen = 85;
        const dirs: Array<{ name: string; p0: [number, number]; p1: [number, number] }> = [
          { name: 'East Approach',  p0: [cx + R, cy], p1: [cx + armLen, cy] },
          { name: 'North Approach', p0: [cx, cy + R], p1: [cx, cy + armLen] },
          { name: 'West Approach',  p0: [cx - R, cy], p1: [cx - armLen, cy] },
          { name: 'South Approach', p0: [cx, cy - R], p1: [cx, cy - armLen] },
        ];
        for (const d of dirs) {
          this.roads.push(this.add(this.make('street', [llRound(Geo.ll(...d.p0)), llRound(Geo.ll(...d.p1))], 'both', d.name)));
        }
      }

      // Find all approach anchor points sitting at ~R from [cx, cy], or default to 4 cardinal points
      this.project();
      const anchors: Array<{ angle: number; ll: [number, number]; roadId: number; armId: string }> = [];
      for (const r of this.roads) {
        const ends: Array<[number, 's' | 'e']> = [
          [0, 'e'],
          [r.pts.length - 1, 's'],
        ];
        for (const [idx, armEnd] of ends) {
          const [px, py] = Geo.xy(r.pts[idx]);
          const dist = Math.hypot(px - cx, py - cy);
          if (Math.abs(dist - R) < 6) {
            anchors.push({
              angle: Math.atan2(py - cy, px - cx),
              ll: r.pts[idx],
              roadId: r.id,
              armId: r.id + armEnd,
            });
          }
        }
      }

      // Ensure at least 4 cardinal anchors so the octagon ring always forms cleanly
      for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        if (!anchors.some(a => Math.abs(Math.atan2(Math.sin(a.angle - ang), Math.cos(a.angle - ang))) < 0.35)) {
          anchors.push({
            angle: ang,
            ll: llRound(Geo.ll(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R)),
            roadId: -1,
            armId: '',
          });
        }
      }
      anchors.sort((a, b) => a.angle - b.angle);

      // Build counter-clockwise one-way ring arcs connecting consecutive anchors (with intermediate draggable vertices)
      const ringIds: number[] = [];
      for (let i = 0; i < anchors.length; i++) {
        const A = anchors[i];
        const B = anchors[(i + 1) % anchors.length];
        let span = B.angle - A.angle;
        if (span <= 0) span += Math.PI * 2;
        const pts: [number, number][] = [A.ll];
        const steps = span > 1.1 ? 2 : 1;
        for (let s = 1; s <= steps; s++) {
          const a = A.angle + (span * s) / (steps + 1);
          pts.push(llRound(Geo.ll(cx + Math.cos(a) * R, cy + Math.sin(a) * R)));
        }
        pts.push(B.ll);
        const seg = this.add({
          id: 0,
          name: 'Roundabout Ring',
          type: 'street',
          lanes: 1,
          speed: 35,
          dir: 'fwd',
          pts,
          closed: false,
          friction: 0,
          banned: [],
        });
        ringIds.push(seg.id);
      }

      // Configure Yield priority at every ring junction: ring traffic has priority, entering legs yield
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i];
        if (anchor.roadId < 0) continue;
        const prevRingSegId = ringIds[(i - 1 + ringIds.length) % ringIds.length];
        const key = Geo.key(anchor.ll);
        this.junctions[key] = {
          ctrl: 'yield',
          appr: {
            [prevRingSegId + 's']: 'prio',
            [anchor.armId]: 'yield',
          },
        };
      }
      this.prepare();
      return;
    }

    // Cross or T-Junction template
    const span = 80;
    const ptsH: [number, number][] = [
      llRound(Geo.ll(cx - span, cy)),
      llRound(Geo.ll(cx, cy)),
      llRound(Geo.ll(cx + span, cy)),
    ];
    const ptsV: [number, number][] =
      kind === 'cross'
        ? [llRound(Geo.ll(cx, cy - span)), llRound(Geo.ll(cx, cy)), llRound(Geo.ll(cx, cy + span))]
        : [llRound(Geo.ll(cx, cy - span)), llRound(Geo.ll(cx, cy))];
    this.add(this.make('street', ptsH, 'both', 'Cross Avenue'));
    this.add(this.make('street', ptsV, 'both', kind === 'cross' ? 'Cross Street' : 'T-Stem Road'));
    const k = Geo.key(llRound(Geo.ll(cx, cy)));
    if (kind === 't') {
      this.junctions[k] = { ctrl: 'yield' };
    }
    this.prepare();
  }

  // ---- workbench ------------------------------------------------------------------------------
  enterWorkbench(c: [number, number], R: number): Set<number> {
    const dist = (r: Road) => {
      let m = 1e9;
      for (let i = 0; i < r._xy!.length - 1; i++) {
        const A = r._xy![i];
        const B = r._xy![i + 1];
        const dx = B[0] - A[0];
        const dy = B[1] - A[1];
        const t = Math.max(0, Math.min(1, ((c[0] - A[0]) * dx + (c[1] - A[1]) * dy) / (dx * dx + dy * dy || 1)));
        m = Math.min(m, Math.hypot(c[0] - A[0] - t * dx, c[1] - A[1] - t * dy));
      }
      return m;
    };
    const ids = new Set<number>();
    const sub: Road[] = [];
    const clone = (r: Road): Road => {
      const o: Road = { ...r, pts: r.pts.map(p => [...p] as [number, number]), banned: [...(r.banned || [])] };
      delete o._xy;
      delete o._bb;
      return o;
    };
    for (const r of this.roads) {
      if (dist(r) <= R) {
        ids.add(r.id);
        sub.push(clone(r));
      }
    }
    const keys = new Set(sub.flatMap(r => r.pts.map(p => Geo.key(p))));
    const jn: Record<string, JunctionConfig> = {};
    for (const k in this.junctions) if (keys.has(k)) jn[k] = JSON.parse(JSON.stringify(this.junctions[k]));
    const hotIds = new Set<number>();
    const hs = this.hotspots
      .filter(h => Math.hypot(h.xy[0] - c[0], h.xy[1] - c[1]) <= R + 300)
      .map(h => {
        hotIds.add(h.id);
        return { ...h, ll: [...h.ll] as [number, number], xy: [...h.xy] as [number, number] };
      });
    const bl = this.buildings.filter((_, i) => Math.hypot(this.bxy![2 * i] - c[0], this.bxy![2 * i + 1] - c[1]) <= R + 250);
    const rk = (r: Road) => JSON.stringify([r.name, r.type, r.lanes, r.lanesR, r.speed, r.dir, r.pts, r.closed, r.friction, r.banned]);
    this.main = {
      roads: this.roads,
      buildings: this.buildings,
      bxy: this.bxy,
      junctions: this.junctions,
      hotspots: this.hotspots,
      uid: this.uid,
      hid: this.hid,
    };
    this.wb = {
      c,
      R,
      ids,
      keys,
      hotIds,
      orig: new Map(sub.map(r => [r.id, rk(r)])),
      origJ: JSON.stringify(jn),
      rk,
    };
    this.roads = sub;
    this.junctions = jn;
    this.hotspots = hs;
    this.buildings = bl;
    this.undoStack = [];
    this.redoStack = [];
    this.project();
    return ids;
  }

  applyWorkbench(): string {
    const main = this.main!;
    const wb = this.wb!;
    const subById = new Map(this.roads.map(r => [r.id, r]));
    const merged: Road[] = [];
    const used = new Set<number>();
    let changed = 0;
    let added = 0;
    let removed = 0;
    for (const r of main.roads) {
      if (!wb.ids.has(r.id)) {
        merged.push(r);
        continue;
      }
      const s = subById.get(r.id);
      if (!s) {
        removed++;
        continue;
      }
      merged.push(s);
      used.add(r.id);
      if (wb.rk(s) !== wb.orig.get(r.id)) changed++;
    }
    for (const s of this.roads) {
      if (!used.has(s.id)) {
        merged.push(s);
        added++;
      }
    }
    const jn = { ...main.junctions };
    for (const k of wb.keys) delete jn[k];
    Object.assign(jn, this.junctions);
    const ctl = JSON.stringify(this.junctions) !== wb.origJ;
    const hot = main.hotspots.filter(h => !wb.hotIds.has(h.id)).concat(this.hotspots);
    this.roads = merged;
    this.junctions = jn;
    this.hotspots = hot;
    this.buildings = main.buildings;
    this.uid = Math.max(main.uid, this.uid);
    this.hid = Math.max(main.hid, this.hid);
    this.main = null;
    this.wb = null;
    this.undoStack = [];
    this.redoStack = [];
    this.prepare();
    return `${changed} road(s) changed, ${added} added, ${removed} removed${ctl ? ', junction controls updated' : ''}`;
  }

  discardWorkbench() {
    const main = this.main!;
    this.roads = main.roads;
    this.buildings = main.buildings;
    this.bxy = main.bxy;
    this.junctions = main.junctions;
    this.hotspots = main.hotspots;
    this.main = null;
    this.wb = null;
    this.undoStack = [];
    this.redoStack = [];
  }

  split(r: Road, ll: [number, number]): Road | null {
    this.insertPoint(r, ll);
    const k = Geo.key(ll);
    const i = r.pts.findIndex(p => Geo.key(p) === k);
    if (i <= 0 || i >= r.pts.length - 1) return null;
    const b: Road = { ...r, id: this.uid++, pts: r.pts.slice(i), banned: [...(r.banned || [])] };
    delete b._xy;
    delete b._bb;
    r.pts = r.pts.slice(0, i + 1);
    this.roads.splice(this.roads.indexOf(r) + 1, 0, b);
    return b;
  }

  make(type: RoadTypeKey, pts: [number, number][], dir: RoadDir = 'both', name?: string): Road {
    const t = ROAD_TYPES[type];
    return {
      id: 0,
      name: name || `${t.label} ${this.uid}`,
      type,
      lanes: t.lanes,
      speed: t.speed,
      dir,
      pts,
      closed: false,
      friction: 0,
      banned: [],
    };
  }

  add(r: Road): Road {
    r.id = this.uid++;
    this.roads.push(r);
    return r;
  }

  del(r: Road) {
    this.roads = this.roads.filter(x => x !== r);
    this.rules = this.rules.filter(x => String(x.r) !== String(r.id));
  }

  insertPoint(r: Road, ll: [number, number]) {
    const k = Geo.key(ll);
    if (r.pts.some(p => Geo.key(p) === k)) return;
    const [px, py] = Geo.xy(ll);
    let bi = 0;
    let bd = 1e18;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, ay] = Geo.xy(r.pts[i]);
      const [bx, by] = Geo.xy(r.pts[i + 1]);
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    r.pts.splice(bi + 1, 0, ll);
  }

  pack(): PackedStore {
    return {
      v: 4,
      name: this.name,
      origin: this.origin,
      roads: this.roads.map(({ id, name, type, lanes, lanesR, speed, dir, pts, osm, closed, friction, banned }) => ({
        id,
        name,
        type,
        lanes,
        ...(lanesR != null ? { lanesR } : {}),
        speed,
        dir,
        pts,
        ...(osm != null ? { osm } : {}),
        closed,
        friction,
        banned,
      })),
      hotspots: this.hotspots.map(({ xy: _xy, ...h }) => h),
      buildings: this.buildings,
      junctions: this.junctions,
      rules: this.rules,
      vehicles: this.vehicles,
      demand: this.demand,
      day: this.day,
    };
  }

  unpack(j: PackedStore) {
    this.name = j.name || 'Loaded project';
    this.origin = j.origin || null;
    this.roads = (j.roads || []) as Road[];
    this.buildings = j.buildings || [];
    this.junctions = j.junctions || {};
    this.rules = j.rules || [];
    this.hotspots = (j.hotspots || []).map(h => ({
      ...h,
      priority: h.priority == null ? (HOT_KINDS[h.kind]?.priority ?? 50) : h.priority,
      xy: [0, 0] as [number, number],
    }));
    if (j.vehicles && j.vehicles.length) this.vehicles = j.vehicles;
    if (j.demand && j.demand.length === 24) this.demand = j.demand;
    if (j.day && DAY_TYPES[j.day]) this.day = j.day;
    if (!this.origin && this.roads.length) {
      const pts = this.roads.flatMap(r => r.pts);
      this.origin = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    }
    this.prepare();
  }

  geojson() {
    return {
      type: 'FeatureCollection',
      features: this.roads.map(r => ({
        type: 'Feature',
        properties: { name: r.name, type: r.type, lanes: r.lanes, speed: r.speed, dir: r.dir, closed: r.closed },
        geometry: { type: 'LineString', coordinates: r.pts.map(p => [p[1], p[0]]) },
      })),
    };
  }

  fromText(txt: string): string {
    const j = JSON.parse(txt);
    if (j.elements) {
      const ds = parseOverpass(j);
      if (!ds.roads.length) throw new Error('No roads in that Overpass file');
      this.setDataset({ ...ds, name: 'Imported OpenStreetMap data' });
      return 'OpenStreetMap data';
    }
    if (j.type === 'FeatureCollection') {
      const roads: Road[] = j.features
        .filter((f: { geometry?: { type?: string } }) => f.geometry && /LineString/.test(f.geometry.type || ''))
        .flatMap(
          (f: {
            properties?: Record<string, unknown>;
            geometry: { type: string; coordinates: number[][] | number[][][] };
          }) => {
            const p = f.properties || {};
            const type: RoadTypeKey = typeof p.type === 'string' && ROAD_TYPES[p.type as RoadTypeKey] ? (p.type as RoadTypeKey) : 'residential';
            const t = ROAD_TYPES[type];
            const lines =
              f.geometry.type === 'LineString'
                ? [f.geometry.coordinates as number[][]]
                : (f.geometry.coordinates as number[][][]);
            return lines.map(c => ({
              id: 0,
              name: (typeof p.name === 'string' && p.name) || t.label,
              type,
              lanes: +(p.lanes as number) || t.lanes,
              speed: +(p.speed as number) || t.speed,
              dir: (['fwd', 'rev'].includes(p.dir as string) ? p.dir : p.oneway ? 'fwd' : 'both') as RoadDir,
              pts: c.map(q => [q[1], q[0]] as [number, number]),
            }));
          }
        );
      this.setDataset({ roads, buildings: this.buildings, name: 'Imported roads' });
      return 'GeoJSON roads';
    }
    if (Array.isArray(j)) {
      this.setDataset({ roads: j, buildings: this.buildings, name: 'Imported roads' });
      return 'road list';
    }
    this.unpack(j);
    return 'project';
  }
}
