import { Geo } from './geo.js';
import { LANE_W, ROAD_TYPES } from '../config.js';
import { classify, lanePerms } from './junction.js';

// two-way roads may have a different number of lanes each way (r.lanes forward, r.lanesR backward)
export const roadWidth = r => r.dir === 'both' ? (r.lanes + (r.lanesR ?? r.lanes)) * LANE_W + ROAD_TYPES[r.type].median : r.lanes * LANE_W;
export const roadLength = r => { let s = 0; for (let i = 0; i < r.pts.length - 1; i++) s += Geo.dist(r.pts[i], r.pts[i + 1]); return s; };

// Directed road graph built from the editable roads.
//  node: a junction or dead end          edge: one direction of travel between two nodes (keeps the road's curve)
//  Roads are cut into edges wherever another road touches them (same coordinates = same node).
//  road.dir: 'both' | 'fwd' (first point -> last point) | 'rev' (last point -> first point)
export class Network {
  constructor() { this.nodes = []; this.edges = []; this.byRoad = new Map(); this.byKey = new Map(); this.vmax = 1; this.core = []; this.coreCum = []; }

  static build(roads, junctions = {}) {
    const net = new Network(), cnt = new Map();
    for (const r of roads) { const n = r.pts.length; r.pts.forEach((p, i) => { const k = Geo.key(p); cnt.set(k, (cnt.get(k) || 0) + (i === 0 || i === n - 1 ? 2 : 1)); }); }
    // a point with a stop light / stop sign on it must be a node, even in the middle of a road
    for (const k in junctions) if (cnt.has(k)) cnt.set(k, cnt.get(k) + 2);
    const node = p => {
      const k = Geo.key(p); let n = net.byKey.get(k);
      if (!n) { const [x, y] = Geo.xy(p); n = { id: net.nodes.length, key: k, x, y, deg: 0, out: [], in: [], w: 1, free: 0 }; net.nodes.push(n); net.byKey.set(k, n); }
      return n;
    };
    for (const r of roads) {
      const pts = r.pts.filter((p, i, a) => !i || Geo.key(p) !== Geo.key(a[i - 1]));
      let start = 0;
      for (let i = 1; i < pts.length; i++) if (i === pts.length - 1 || cnt.get(Geo.key(pts[i])) >= 2) { net.addSegment(r, pts.slice(start, i + 1), node); start = i; }
    }
    net.vmax = Math.max(1, ...net.edges.map(e => e.vm));
    net.computeCore();
    net.applyJunctions(junctions);
    return net;
  }

  // Which lanes of an approach may take which exit. Only junctions the user has set up lane by lane (J.lanes) are restricted;
  // everywhere else a vehicle takes whichever lane is emptiest. e.perm: Map(outgoing edge id -> allowed lane indexes).
  applyJunctions(junctions = {}) {
    for (const n of this.nodes) {
      const J = junctions[n.key], on = !!(J && J.lanes);
      for (const e of n.in) {
        if (!on) { e.perm = null; continue; }
        const P = lanePerms(J, e.armIn, e.lanes); e.perm = new Map();
        for (const o of n.out) {
          if (o.road === e.road && o.b === e.a) continue; // U-turn: never offered
          const t = classify(e.hin, o.hout); e.perm.set(o.id, P.map((s, k) => s.includes(t) ? k : -1).filter(k => k >= 0));
        }
      }
    }
  }

  addSegment(r, pts, node) {
    if (r.closed) return; // closed roads stay on the map but carry no traffic
    const xy = pts.map(p => Geo.xy(p)), a = node(pts[0]), b = node(pts[pts.length - 1]);
    let len = 0; for (let i = 1; i < xy.length; i++) len += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    if (len < .5) return;
    a.deg++; b.deg++;
    if (r.dir !== 'rev') this.mk(r, xy, a, b, false);
    if (r.dir !== 'fwd') this.mk(r, xy.slice().reverse(), b, a, true);
  }

  mk(r, xy, a, b, rev) {
    const cum = [0]; for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
    const nrm = xy.map((p, i) => { const A = xy[Math.max(0, i - 1)], B = xy[Math.min(xy.length - 1, i + 1)]; let dx = B[0] - A[0], dy = B[1] - A[1]; const l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; }); // unit normal to the right of travel
    const L = xy[xy.length - 1], P = xy[xy.length - 2], lanes = Math.max(1, (rev && r.dir === 'both' ? (r.lanesR ?? r.lanes) : r.lanes) | 0);
    const vm0 = r.speed / 3.6, fr = Math.max(0, Math.min(1, +r.friction || 0)); // friction = parking, stalls, pedestrians: slows everyone down
    const e = { id: this.edges.length, a, b, xy, cum, len: cum[cum.length - 1], nrm, road: r, vm0, vm: vm0 * (1 - .5 * fr), lanes,
      grp: Math.abs(L[0] - P[0]) > Math.abs(L[1] - P[1]) ? 0 : 1, // 0 = east-west approach, 1 = north-south (for traffic-light phases)
      fwd: !rev, armIn: r.id + (rev ? 'e' : 's'), armOut: r.id + (rev ? 's' : 'e'), // arm ids at the node this edge ends / starts at (see junction.js)
      hin: [(L[0] - P[0]) / (Math.hypot(L[0] - P[0], L[1] - P[1]) || 1), (L[1] - P[1]) / (Math.hypot(L[0] - P[0], L[1] - P[1]) || 1)],
      hout: [(xy[1][0] - xy[0][0]) / (Math.hypot(xy[1][0] - xy[0][0], xy[1][1] - xy[0][1]) || 1), (xy[1][1] - xy[0][1]) / (Math.hypot(xy[1][0] - xy[0][0], xy[1][1] - xy[0][1]) || 1)],
      perm: null, ln: Array.from({ length: lanes }, () => []), cnt: 0, r: 1 };
    this.edges.push(e); a.out.push(e); b.in.push(e);
    (this.byRoad.get(r.id) || this.byRoad.set(r.id, []).get(r.id)).push(e);
  }

  // Largest strongly connected part of the network: the only places trips can start and end,
  // so one-way mistakes or disconnected scraps never strand vehicles.
  computeCore() {
    const N = this.nodes.length, order = [], seen = new Uint8Array(N);
    for (let s = 0; s < N; s++) {
      if (seen[s]) continue; seen[s] = 1; const st = [[s, 0]];
      while (st.length) { const t = st[st.length - 1], n = this.nodes[t[0]];
        if (t[1] < n.out.length) { const m = n.out[t[1]++].b.id; if (!seen[m]) { seen[m] = 1; st.push([m, 0]); } } else { order.push(t[0]); st.pop(); } }
    }
    const comp = new Int32Array(N).fill(-1), sizes = []; let c = 0;
    for (let i = N - 1; i >= 0; i--) {
      const s = order[i]; if (comp[s] >= 0) continue; comp[s] = c; let size = 0; const st = [s];
      while (st.length) { const u = st.pop(); size++; for (const e of this.nodes[u].in) { const m = e.a.id; if (comp[m] < 0) { comp[m] = c; st.push(m); } } }
      sizes.push(size); c++;
    }
    let best = 0; sizes.forEach((z, i) => { if (z > sizes[best]) best = i; });
    this.core = this.nodes.filter(n => comp[n.id] === best);
    this.applyWeights(null);
  }

  // Trip generation weight of a node = number of buildings nearby (more houses, more trips).
  applyWeights(bxy) {
    for (const n of this.nodes) n.w = 1;
    if (bxy && bxy.length) {
      const C = 150, grid = new Map();
      for (let i = 0; i < bxy.length; i += 2) { const k = Math.floor(bxy[i] / C) + ',' + Math.floor(bxy[i + 1] / C); grid.set(k, (grid.get(k) || 0) + 1); }
      for (const n of this.nodes) { const cx = Math.floor(n.x / C), cy = Math.floor(n.y / C); let s = 0;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) s += grid.get((cx + dx) + ',' + (cy + dy)) || 0;
        n.w = 1 + s; }
    }
    let t = 0; this.coreCum = this.core.map(n => (t += n.w)); this.coreTotal = t;
  }

  // Workbench: roads leave the cut-out area, so the far ends act as "gates" that send and receive through traffic.
  boostGates(cx, cy, R, share = .5) {
    const d = n => Math.hypot(n.x - cx, n.y - cy), gates = this.core.filter(n => d(n) > R); if (!gates.length) return;
    const inside = this.core.reduce((a, n) => d(n) <= R ? a + n.w : a, 0), each = Math.max(3, share * inside / gates.length);
    for (const n of gates) n.w = each;
    let t = 0; this.coreCum = this.core.map(n => (t += n.w)); this.coreTotal = t;
  }

  pickNode(rnd) {
    if (!this.core.length) return null;
    const r = rnd() * this.coreTotal; let lo = 0, hi = this.coreCum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.coreCum[m] < r) lo = m + 1; else hi = m; }
    return this.core[lo];
  }
}
