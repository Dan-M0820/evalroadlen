import type { NetEdge, NetNode, Network } from './network';
import type { RuleSet } from './rules';
import type { JunctionConfig } from '../types';

class Heap {
  a: [number, number][] = [];
  get size(): number {
    return this.a.length;
  }
  push(f: number, id: number) {
    const a = this.a;
    a.push([f, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class Router {
  net: Network;
  rules: RuleSet;
  junctions: Record<string, JunctionConfig>;
  cache = new Map<string, NetEdge[] | null>();
  g: Float64Array;
  pre: Int32Array;
  seen: Uint32Array;
  done: Uint32Array;
  gen = 0;

  constructor(net: Network, rules: RuleSet, junctions: Record<string, JunctionConfig>) {
    this.net = net;
    this.rules = rules;
    this.junctions = junctions;
    const E = net.edges.length;
    this.g = new Float64Array(E);
    this.pre = new Int32Array(E);
    this.seen = new Uint32Array(E);
    this.done = new Uint32Array(E);
  }

  pen(n: NetNode): number {
    const J = this.junctions[n.key];
    return !J ? 0 : J.ctrl === 'signal' ? 15 : J.ctrl === 'stop' ? 5 : 0;
  }

  banned(n: NetNode, i: number, o: number): boolean {
    const J = this.junctions[n.key];
    return !!(J && J.bans && J.bans.includes(i + '>' + o));
  }

  route(o: NetNode, d: NetNode, ty: string, avoid = false, prev: NetEdge | null = null): NetEdge[] | null {
    const ck = avoid ? null : o.id + '>' + d.id + '|' + ty + '|' + (prev ? prev.id : -1) + '|' + this.rules.sig(ty);
    if (ck && this.cache.has(ck)) return this.cache.get(ck) ?? null;
    const gen = ++this.gen;
    const heap = new Heap();
    const vmax = this.net.vmax;
    const edges = this.net.edges;
    const cost = (e: NetEdge) => e.len / (e.vm * (avoid ? Math.max(0.25, e.r) : 1));
    const h = (n: NetNode) => Math.hypot(n.x - d.x, n.y - d.y) / vmax;
    for (const e of o.out) {
      if (this.rules.blocked(e.road, ty) || (prev && e.b === prev.a && e.road === prev.road)) continue;
      this.g[e.id] = cost(e);
      this.pre[e.id] = -1;
      this.seen[e.id] = gen;
      heap.push(this.g[e.id] + h(e.b), e.id);
    }
    let goal: NetEdge | null = null;
    while (heap.size) {
      const top = heap.pop();
      if (!top) break;
      const id = top[1];
      if (this.done[id] === gen) continue;
      this.done[id] = gen;
      const e = edges[id];
      if (e.b === d) {
        goal = e;
        break;
      }
      for (const n of e.b.out) {
        if (n.b === e.a && n.road === e.road) continue;
        if (n.road !== e.road && this.banned(e.b, e.road.id, n.road.id)) continue;
        if (e.perm) {
          const L = e.perm.get(n.id);
          if (L && !L.length) continue;
        }
        if (this.rules.blocked(n.road, ty)) continue;
        const ng = this.g[id] + this.pen(e.b) + cost(n);
        if (this.seen[n.id] !== gen || ng < this.g[n.id]) {
          this.g[n.id] = ng;
          this.pre[n.id] = id;
          this.seen[n.id] = gen;
          heap.push(ng + h(n.b), n.id);
        }
      }
    }
    let p: NetEdge[] | null = null;
    if (goal) {
      p = [];
      for (let id = goal.id; id >= 0; id = this.pre[id]) p.unshift(edges[id]);
    }
    if (ck) {
      if (this.cache.size > 4000) this.cache.clear();
      this.cache.set(ck, p);
    }
    return p;
  }
}
