import { Geo } from './geo';
import { LANE_W, ROAD_TYPES } from '../config';
import { classify, lanePerms } from './junction';
import type { JunctionConfig, Road, VehicleType } from '../types';

export const roadWidth = (r: Road): number =>
  r.dir === 'both' ? (r.lanes + (r.lanesR ?? r.lanes)) * LANE_W + ROAD_TYPES[r.type].median : r.lanes * LANE_W;

export const roadLength = (r: Road): number => {
  let s = 0;
  for (let i = 0; i < r.pts.length - 1; i++) s += Geo.dist(r.pts[i], r.pts[i + 1]);
  return s;
};

export interface NetNode {
  id: number;
  key: string;
  x: number;
  y: number;
  deg: number;
  out: NetEdge[];
  in: NetEdge[];
  w: number;
  free: number;
}

export interface Vehicle {
  id: number;
  s: number;
  v: number;
  p: NetEdge[];
  i: number;
  dest: NetNode;
  hot: number | null;
  L: number;
  ty: VehicleType;
  c: string;
  aggr: number;
  tau: number;
  f: number;
  acc: number;
  avoid: boolean;
  rr: number;
  rd: number;
  t0: number;
  free: number;
  sp: number | null;
  w: number | null;
}

export interface NetEdge {
  id: number;
  a: NetNode;
  b: NetNode;
  xy: [number, number][];
  cum: number[];
  len: number;
  nrm: [number, number][];
  road: Road;
  vm0: number;
  vm: number;
  lanes: number;
  grp: 0 | 1;
  fwd: boolean;
  armIn: string;
  armOut: string;
  hin: [number, number];
  hout: [number, number];
  perm: Map<number, number[]> | null;
  ln: Vehicle[][];
  cnt: number;
  r: number;
}

export class Network {
  nodes: NetNode[] = [];
  edges: NetEdge[] = [];
  byRoad = new Map<number, NetEdge[]>();
  byKey = new Map<string, NetNode>();
  vmax = 1;
  core: NetNode[] = [];
  coreCum: number[] = [];
  coreTotal = 0;

  static build(roads: Road[], junctions: Record<string, JunctionConfig> = {}): Network {
    const net = new Network();
    const cnt = new Map<string, number>();
    for (const r of roads) {
      const n = r.pts.length;
      r.pts.forEach((p, i) => {
        const k = Geo.key(p);
        cnt.set(k, (cnt.get(k) || 0) + (i === 0 || i === n - 1 ? 2 : 1));
      });
    }
    for (const k in junctions) {
      if (cnt.has(k)) cnt.set(k, (cnt.get(k) || 0) + 2);
    }
    const node = (p: [number, number]): NetNode => {
      const k = Geo.key(p);
      let n = net.byKey.get(k);
      if (!n) {
        const [x, y] = Geo.xy(p);
        n = { id: net.nodes.length, key: k, x, y, deg: 0, out: [], in: [], w: 1, free: 0 };
        net.nodes.push(n);
        net.byKey.set(k, n);
      }
      return n;
    };
    for (const r of roads) {
      const pts = r.pts.filter((p, i, a) => !i || Geo.key(p) !== Geo.key(a[i - 1]));
      let start = 0;
      for (let i = 1; i < pts.length; i++) {
        if (i === pts.length - 1 || (cnt.get(Geo.key(pts[i])) || 0) >= 2) {
          net.addSegment(r, pts.slice(start, i + 1), node);
          start = i;
        }
      }
    }
    net.vmax = Math.max(1, ...net.edges.map(e => e.vm));
    net.computeCore();
    net.applyJunctions(junctions);
    return net;
  }

  applyJunctions(junctions: Record<string, JunctionConfig> = {}) {
    for (const n of this.nodes) {
      const J = junctions[n.key];
      const on = !!(J && J.lanes);
      for (const e of n.in) {
        if (!on) {
          e.perm = null;
          continue;
        }
        const P = lanePerms(J, e.armIn, e.lanes);
        e.perm = new Map();
        for (const o of n.out) {
          if (o.road === e.road && o.b === e.a) continue;
          const t = classify(e.hin, o.hout);
          e.perm.set(
            o.id,
            P.map((s, k) => (s.includes(t) ? k : -1)).filter(k => k >= 0)
          );
        }
      }
    }
  }

  addSegment(r: Road, pts: [number, number][], node: (p: [number, number]) => NetNode) {
    if (r.closed) return;
    const xy = pts.map(p => Geo.xy(p));
    const a = node(pts[0]);
    const b = node(pts[pts.length - 1]);
    let len = 0;
    for (let i = 1; i < xy.length; i++) {
      len += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    }
    if (len < 0.5) return;
    a.deg++;
    b.deg++;
    if (r.dir !== 'rev') this.mk(r, xy, a, b, false);
    if (r.dir !== 'fwd') this.mk(r, xy.slice().reverse(), b, a, true);
  }

  mk(r: Road, xy: [number, number][], a: NetNode, b: NetNode, rev: boolean) {
    const cum = [0];
    for (let i = 1; i < xy.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
    }
    const nrm: [number, number][] = xy.map((_, i) => {
      const A = xy[Math.max(0, i - 1)];
      const B = xy[Math.min(xy.length - 1, i + 1)];
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const l = Math.hypot(dx, dy) || 1;
      return [dy / l, -dx / l];
    });
    const L = xy[xy.length - 1];
    const P = xy[xy.length - 2];
    const lanes = Math.max(1, (rev && r.dir === 'both' ? (r.lanesR ?? r.lanes) : r.lanes) | 0);
    const vm0 = r.speed / 3.6;
    const fr = Math.max(0, Math.min(1, +(r.friction || 0)));
    const hlIn = Math.hypot(L[0] - P[0], L[1] - P[1]) || 1;
    const hlOut = Math.hypot(xy[1][0] - xy[0][0], xy[1][1] - xy[0][1]) || 1;
    const e: NetEdge = {
      id: this.edges.length,
      a,
      b,
      xy,
      cum,
      len: cum[cum.length - 1],
      nrm,
      road: r,
      vm0,
      vm: vm0 * (1 - 0.5 * fr),
      lanes,
      grp: Math.abs(L[0] - P[0]) > Math.abs(L[1] - P[1]) ? 0 : 1,
      fwd: !rev,
      armIn: r.id + (rev ? 'e' : 's'),
      armOut: r.id + (rev ? 's' : 'e'),
      hin: [(L[0] - P[0]) / hlIn, (L[1] - P[1]) / hlIn],
      hout: [(xy[1][0] - xy[0][0]) / hlOut, (xy[1][1] - xy[0][1]) / hlOut],
      perm: null,
      ln: Array.from({ length: lanes }, () => []),
      cnt: 0,
      r: 1,
    };
    this.edges.push(e);
    a.out.push(e);
    b.in.push(e);
    let arr = this.byRoad.get(r.id);
    if (!arr) {
      arr = [];
      this.byRoad.set(r.id, arr);
    }
    arr.push(e);
  }

  computeCore() {
    const N = this.nodes.length;
    const order: number[] = [];
    const seen = new Uint8Array(N);
    for (let s = 0; s < N; s++) {
      if (seen[s]) continue;
      seen[s] = 1;
      const st: [number, number][] = [[s, 0]];
      while (st.length) {
        const t = st[st.length - 1];
        const n = this.nodes[t[0]];
        if (t[1] < n.out.length) {
          const m = n.out[t[1]++].b.id;
          if (!seen[m]) {
            seen[m] = 1;
            st.push([m, 0]);
          }
        } else {
          order.push(t[0]);
          st.pop();
        }
      }
    }
    const comp = new Int32Array(N).fill(-1);
    const sizes: number[] = [];
    let c = 0;
    for (let i = N - 1; i >= 0; i--) {
      const s = order[i];
      if (comp[s] >= 0) continue;
      comp[s] = c;
      let size = 0;
      const st = [s];
      while (st.length) {
        const u = st.pop()!;
        size++;
        for (const e of this.nodes[u].in) {
          const m = e.a.id;
          if (comp[m] < 0) {
            comp[m] = c;
            st.push(m);
          }
        }
      }
      sizes.push(size);
      c++;
    }
    let best = 0;
    sizes.forEach((z, i) => {
      if (z > sizes[best]) best = i;
    });
    this.core = this.nodes.filter(n => comp[n.id] === best);
    this.applyWeights(null);
  }

  applyWeights(bxy: Float32Array | null) {
    for (const n of this.nodes) n.w = 1;
    if (bxy && bxy.length) {
      const C = 150;
      const grid = new Map<string, number>();
      for (let i = 0; i < bxy.length; i += 2) {
        const k = Math.floor(bxy[i] / C) + ',' + Math.floor(bxy[i + 1] / C);
        grid.set(k, (grid.get(k) || 0) + 1);
      }
      for (const n of this.nodes) {
        const cx = Math.floor(n.x / C);
        const cy = Math.floor(n.y / C);
        let s = 0;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            s += grid.get(cx + dx + ',' + (cy + dy)) || 0;
          }
        }
        n.w = 1 + s;
      }
    }
    let t = 0;
    this.coreCum = this.core.map(n => (t += n.w));
    this.coreTotal = t;
  }

  boostGates(cx: number, cy: number, R: number, share = 0.5) {
    const d = (n: NetNode) => Math.hypot(n.x - cx, n.y - cy);
    const gates = this.core.filter(n => d(n) > R);
    if (!gates.length) return;
    const inside = this.core.reduce((a, n) => (d(n) <= R ? a + n.w : a), 0);
    const each = Math.max(3, (share * inside) / gates.length);
    for (const n of gates) n.w = each;
    let t = 0;
    this.coreCum = this.core.map(n => (t += n.w));
    this.coreTotal = t;
  }

  pickNode(rnd: () => number): NetNode | null {
    if (!this.core.length) return null;
    const r = rnd() * this.coreTotal;
    let lo = 0;
    let hi = this.coreCum.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.coreCum[m] < r) lo = m + 1;
      else hi = m;
    }
    return this.core[lo];
  }
}
