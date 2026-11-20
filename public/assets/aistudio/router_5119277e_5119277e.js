// A* routing over directed edges. Respects one-way roads, banned turns, vehicle bans and junction delays.
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(f, id) { const a = this.a; a.push([f, id]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}

export class Router {
  constructor(net, rules, junctions) {
    this.net = net; this.rules = rules; this.junctions = junctions; this.cache = new Map();
    const E = net.edges.length; this.g = new Float64Array(E); this.pre = new Int32Array(E); this.seen = new Uint32Array(E); this.done = new Uint32Array(E); this.gen = 0;
  }
  pen(n) { const J = this.junctions[n.key]; return !J ? 0 : J.ctrl === 'signal' ? 15 : J.ctrl === 'stop' ? 5 : 0; }
  banned(n, i, o) { const J = this.junctions[n.key]; return !!(J && J.bans && J.bans.includes(i + '>' + o)); }

  // o, d: nodes. ty: vehicle key. avoid: use live congestion in the cost. prev: edge the driver is on (no U-turn back along it).
  route(o, d, ty, avoid = false, prev = null) {
    const ck = avoid ? null : o.id + '>' + d.id + '|' + ty + '|' + (prev ? prev.id : -1) + '|' + this.rules.sig(ty);
    if (ck && this.cache.has(ck)) return this.cache.get(ck);
    const gen = ++this.gen, heap = new Heap(), vmax = this.net.vmax, edges = this.net.edges;
    const cost = e => e.len / (e.vm * (avoid ? Math.max(.25, e.r) : 1));
    const h = n => Math.hypot(n.x - d.x, n.y - d.y) / vmax;
    for (const e of o.out) {
      if (this.rules.blocked(e.road, ty) || (prev && e.b === prev.a && e.road === prev.road)) continue;
      this.g[e.id] = cost(e); this.pre[e.id] = -1; this.seen[e.id] = gen; heap.push(this.g[e.id] + h(e.b), e.id);
    }
    let goal = null;
    while (heap.size) {
      const [, id] = heap.pop(); if (this.done[id] === gen) continue; this.done[id] = gen; const e = edges[id];
      if (e.b === d) { goal = e; break; }
      for (const n of e.b.out) {
        if (n.b === e.a && n.road === e.road) continue; // no U-turn
        if (n.road !== e.road && this.banned(e.b, e.road.id, n.road.id)) continue;
        if (e.perm) { const L = e.perm.get(n.id); if (L && !L.length) continue; } // no lane of this approach may make that turn
        if (this.rules.blocked(n.road, ty)) continue;
        const ng = this.g[id] + this.pen(e.b) + cost(n);
        if (this.seen[n.id] !== gen || ng < this.g[n.id]) { this.g[n.id] = ng; this.pre[n.id] = id; this.seen[n.id] = gen; heap.push(ng + h(n.b), n.id); }
      }
    }
    let p = null;
    if (goal) { p = []; for (let id = goal.id; id >= 0; id = this.pre[id]) p.unshift(edges[id]); }
    if (ck) { if (this.cache.size > 4000) this.cache.clear(); this.cache.set(ck, p); }
    return p;
  }
}
