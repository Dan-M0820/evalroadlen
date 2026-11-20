import { Network, type NetEdge, type NetNode, type Vehicle } from './network';
import { Router } from './router';
import { Clock } from './clock';
import { RuleSet } from './rules';
import { cycleOf, phaseAt, type CompiledCycle } from './junction';
import type { Hotspot, JunctionConfig, Road, TrafficRule, VehicleType, DayTypeKey } from '../types';

const SPAWN_RATE = 4;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export interface SimStoreLike {
  roads: Road[];
  junctions: Record<string, JunctionConfig>;
  bxy: Float32Array | null;
  wb?: { c: [number, number]; R: number } | null;
  hotspots: Hotspot[];
  rules: TrafficRule[];
  vehicles: VehicleType[];
  demand: number[];
  day: DayTypeKey;
}

export interface CompiledHotspot {
  h: Hotspot;
  nodes: NetNode[];
  cum: number[];
  tot: number;
}

export interface HotspotStat {
  n: number;
  started: number;
  dsum: number;
}

export interface DriverSample {
  aggr: number;
  tau: number;
  f: number;
  acc: number;
  avoid: boolean;
}

export class Sim {
  store: SimStoreLike;
  clock: Clock;
  rules = new RuleSet();
  cyc = new WeakMap<JunctionConfig, CompiledCycle>();
  params = { load: 30 };
  scale = 1;
  maxVeh = 1500;
  T = 0;
  t0 = 0;
  run = true;
  busy = false;
  fc = 0;
  rnd: () => number = Math.random;
  net!: Network;
  router!: Router;
  nv = 0;
  acc = 0;
  nextId = 1;
  pass: Record<number, number> = {};
  jamR: Record<number, number> = {};
  jamN: Record<number, number> = {};
  loss: Record<number, number> = {};
  mt: Record<number, [number, number, number, number]> = {};
  hstat: Record<number, HotspotStat> = {};
  done = 0;
  dsum = 0;
  avgD: number | null = null;
  avgR: number | null = null;
  hot: CompiledHotspot[] = [];
  hotAct: CompiledHotspot[] = [];
  hotTot = 0;

  constructor(store: SimStoreLike) {
    this.store = store;
    this.clock = new Clock(store);
    this.seed(1);
    this.rebuild();
  }

  static hotspotEffective(h: Hotspot): number {
    const prio = clamp(h.priority ?? 50, 0, 100);
    return Math.max(0, h.weight || 1) * (prio / 50);
  }

  static computeHotspotShares(hotspots: Hotspot[], sec: number): Record<number, number> {
    const out: Record<number, number> = {};
    const active = hotspots.filter(h => RuleSet.inWindow(h, sec));
    const total = active.reduce((acc, h) => acc + Sim.hotspotEffective(h), 0);
    for (const h of hotspots) {
      if (!RuleSet.inWindow(h, sec) || total <= 0) {
        out[h.id] = 0;
      } else {
        out[h.id] = (Sim.hotspotEffective(h) / total) * 100;
      }
    }
    return out;
  }

  hotspotShares(): Record<number, number> {
    return Sim.computeHotspotShares(this.store.hotspots, this.clock.now(this.T));
  }

  seed(n: number) {
    let a = n;
    this.rnd = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  gauss(): number {
    return (this.rnd() + this.rnd() + this.rnd() - 1.5) / 0.5;
  }

  rebuild() {
    this.net = Network.build(this.store.roads, this.store.junctions);
    this.net.applyWeights(this.store.bxy);
    if (this.store.wb) this.net.boostGates(this.store.wb.c[0], this.store.wb.c[1], this.store.wb.R);
    this.t0 = this.T;
    this.router = new Router(this.net, this.rules, this.store.junctions);
    this.nv = 0;
    this.acc = 0;
    this.nextId = 1;
    this.pass = {};
    this.jamR = {};
    this.jamN = {};
    this.loss = {};
    this.mt = {};
    this.hstat = {};
    this.done = 0;
    this.dsum = 0;
    this.avgD = null;
    this.avgR = null;
    this.refreshHotspots();
    this.refreshRules();
  }

  refreshRules() {
    this.rules.refresh(this.store.rules, this.store.roads, this.store.vehicles, this.clock.now(this.T));
    this.updateActive();
  }

  decay() {
    for (const o of [this.jamR, this.jamN, this.loss]) {
      for (const k in o) o[k] *= 0.97;
    }
  }

  refreshHotspots() {
    const core = this.net.core;
    this.hot = this.store.hotspots
      .map(h => {
        const [x, y] = h.xy;
        const c = core.map(n => ({ n, d: Math.hypot(n.x - x, n.y - y) }));
        let near = c.filter(o => o.d <= h.radius);
        if (!near.length) near = c.sort((a, b) => a.d - b.d).slice(0, 3);
        let t = 0;
        const cum = near.map(o => (t += 1 / (1 + o.d / 80)));
        return { h, nodes: near.map(o => o.n), cum, tot: t };
      })
      .filter(H => H.nodes.length);
    this.updateActive();
  }

  updateActive() {
    const sec = this.clock.now(this.T);
    this.hotAct = (this.hot || []).filter(H => RuleSet.inWindow(H.h, sec));
    this.hotTot = this.hotAct.reduce((a, H) => a + Sim.hotspotEffective(H.h), 0);
  }

  pickIn(H: CompiledHotspot): NetNode {
    const r = this.rnd() * H.tot;
    let i = 0;
    while (i < H.cum.length - 1 && H.cum[i] < r) i++;
    return H.nodes[i];
  }

  pickType(): VehicleType {
    const V = this.store.vehicles;
    let r = this.rnd() * (V.reduce((a, y) => a + y.w, 0) || 1);
    for (const y of V) if ((r -= y.w) < 0) return y;
    return V[V.length - 1];
  }

  makeDriver(ty: VehicleType): DriverSample {
    const sp = ty.spread;
    const aggr = clamp(ty.aggr + this.gauss() * sp * 0.3, 0, 1);
    const j = () => 1 + this.gauss() * sp * 0.15;
    return {
      aggr,
      tau: Math.max(0.4, ty.tau * (1.3 - 0.6 * aggr) * j()),
      f: clamp(ty.f * (0.9 + 0.2 * aggr) * j(), 0.2, 1.4),
      acc: Math.max(0.5, ty.acc * (0.85 + 0.3 * aggr)),
      avoid: this.rnd() < ty.avoid,
    };
  }

  ctl(n: NetNode): JunctionConfig | null {
    const J = this.store.junctions[n.key];
    if (!J || J.ctrl === 'free') return null;
    if (J.from && J.to && !RuleSet.inWindow(J, this.clock.now(this.T))) return null;
    return J;
  }

  invalidate() {
    this.cyc = new WeakMap();
  }

  cycle(J: JunctionConfig): CompiledCycle {
    let c = this.cyc.get(J);
    if (!c) {
      c = cycleOf(J);
      this.cyc.set(J, c);
    }
    return c;
  }

  phaseNow(J: JunctionConfig): number {
    return phaseAt(this.cycle(J), this.T, J.offset);
  }

  green(J: JunctionConfig, g: 0 | 1): boolean {
    const a = +(J.gA ?? 20) || 20;
    const b = +(J.gB ?? 20) || 20;
    const r = J.allRed != null ? +J.allRed : 3;
    const t = (this.T + (+(J.offset ?? 0) || 0)) % (a + b + 2 * r);
    return g === 0 ? t < a : t >= a + r && t < a + r + b;
  }

  sigOpen(J: JunctionConfig, e: NetEdge, nx: NetEdge): boolean {
    if (J.phases && J.phases.length) {
      const c = this.cycle(J);
      const i = phaseAt(c, this.T, J.offset);
      return i >= 0 && c.spans[i].set.has(e.armIn + '>' + nx.armOut);
    }
    return this.green(J, e.grp);
  }

  appr(J: JunctionConfig, e: NetEdge): 'prio' | 'yield' | 'stop' {
    const a = J.appr && J.appr[e.armIn];
    if (a) return a;
    if (J.major != null && J.major !== '' && J.major !== 'none') {
      return String(J.major) === String(e.road.id) ? 'prio' : J.ctrl === 'stop' ? 'stop' : 'yield';
    }
    return J.ctrl === 'stop' ? 'stop' : 'yield';
  }

  prioBusy(n: NetNode, J: JunctionConfig, e: NetEdge): boolean {
    for (const o of n.in) {
      if (o === e || this.appr(J, o) !== 'prio') continue;
      for (const q of o.ln) {
        const t = q[0];
        if (t && t.s > o.len - 30) return true;
      }
    }
    return false;
  }

  hw(n: NetNode, e: NetEdge): number {
    const J = this.ctl(n);
    if (!J) return 1.2;
    if (+(J.dh ?? 0) > 0) return +(J.dh ?? 0);
    if (J.ctrl === 'signal') return 0.9;
    if (J.ctrl === 'crossing') return 1.2;
    const a = this.appr(J, e);
    return a === 'prio' ? 1.2 : a === 'stop' ? 2.5 : 1.8;
  }

  best(e: NetEdge, nxt: NetEdge | null | undefined): number {
    const perm = nxt && e.perm ? e.perm.get(nxt.id) : null;
    const use = perm && perm.length ? perm : null;
    let b = -1;
    let m = 1e9;
    e.ln.forEach((q, i) => {
      if (use && !use.includes(i)) return;
      const t = q[q.length - 1];
      if ((!t || t.s - t.L > 2) && q.length < m) {
        m = q.length;
        b = i;
      }
    });
    return b;
  }

  laneFor(e: NetEdge, nxt: NetEdge | null | undefined): number {
    const perm = nxt && e.perm ? e.perm.get(nxt.id) : null;
    return perm && perm.length ? perm[Math.floor(this.rnd() * perm.length)] : Math.floor(this.rnd() * e.lanes);
  }

  can(e: NetEdge, nx: NetEdge, v?: Vehicle | null): number {
    const n = e.b;
    const J = this.ctl(n);
    if (J) {
      if (J.ctrl === 'signal' && !this.sigOpen(J, e, nx)) return -1;
      if (J.ctrl === 'crossing' && this.T % (+(J.every ?? 40) || 40) < (+(J.dur ?? 8) || 8)) return -1;
      if ((J.ctrl === 'stop' || J.ctrl === 'yield') && this.appr(J, e) !== 'prio' && this.prioBusy(n, J, e)) return -1;
    }
    if (n.free > this.T) return -1;
    return this.best(nx, v ? v.p[v.i + 2] : null);
  }

  enter(v: Vehicle, e: NetEdge) {
    if (v.rd !== e.road.id) {
      v.rd = e.road.id;
      this.pass[v.rd] = (this.pass[v.rd] || 0) + 1;
    }
    const y = v.ty;
    if (y.dwellP && e.len > 40 && this.rnd() < (y.dwellP * e.len) / 1000) {
      v.sp = e.len * (0.2 + 0.6 * this.rnd());
      v.w = null;
    }
    const n = v.p[v.i + 1];
    if (v.avoid && n && n.r < 0.45 && e.b !== v.dest && this.T - v.rr > 20) {
      v.rr = this.T;
      const np = this.router.route(e.b, v.dest, y.k, true, e);
      if (np) v.p = v.p.slice(0, v.i + 1).concat(np);
    }
  }

  partner(a: NetNode): NetNode | null {
    const net = this.net;
    const C: [NetNode, number][] = [];
    let tot = 0;
    for (let i = 0; i < 6; i++) {
      const d = net.pickNode(this.rnd);
      if (!d || d === a) continue;
      const w = Math.exp(-Math.hypot(d.x - a.x, d.y - a.y) / 2500) + 0.02;
      C.push([d, w]);
      tot += w;
    }
    let r = this.rnd() * tot;
    for (const [d, w] of C) if ((r -= w) < 0) return d;
    return C.length ? C[0][0] : null;
  }

  pickTrip(): { o: NetNode; d: NetNode; hot: number | null } | null {
    const net = this.net;
    if (this.hotAct.length && this.hotTot > 0 && this.rnd() < Math.min(0.7, this.hotTot * 0.06)) {
      let r = this.rnd() * this.hotTot;
      let H = this.hotAct[this.hotAct.length - 1];
      for (const a of this.hotAct) {
        if ((r -= Sim.hotspotEffective(a.h)) < 0) {
          H = a;
          break;
        }
      }
      const hn = this.pickIn(H);
      const role = H.h.role === 'both' ? (this.rnd() < 0.5 ? 'dest' : 'origin') : H.h.role;
      const other = this.partner(hn);
      if (other) return role === 'dest' ? { o: other, d: hn, hot: H.h.id } : { o: hn, d: other, hot: H.h.id };
    }
    const o = net.pickNode(this.rnd);
    if (!o) return null;
    const d = this.partner(o);
    return d ? { o, d, hot: null } : null;
  }

  spawn() {
    if (this.net.core.length < 2) return;
    for (let t = 0; t < 3; t++) {
      const trip = this.pickTrip();
      if (!trip) continue;
      const ty = this.pickType();
      const dr = this.makeDriver(ty);
      const p = this.router.route(trip.o, trip.d, ty.k, dr.avoid, null);
      if (!p) continue;
      const li = this.best(p[0], p[1]);
      if (li < 0) return;
      this.place(this.makeVehicle(ty, dr, p, trip.d, trip.hot), p[0], li, 0);
      if (trip.hot) {
        (this.hstat[trip.hot] = this.hstat[trip.hot] || { n: 0, started: 0, dsum: 0 }).started++;
      }
      return;
    }
  }

  makeVehicle(ty: VehicleType, dr: DriverSample, p: NetEdge[], dest: NetNode, hot: number | null = null): Vehicle {
    return {
      id: this.nextId++,
      s: 0,
      v: 0,
      p,
      i: 0,
      dest,
      hot,
      L: ty.L,
      ty,
      c: ty.c,
      aggr: dr.aggr,
      tau: dr.tau,
      f: dr.f,
      acc: dr.acc,
      avoid: dr.avoid,
      rr: -99,
      rd: 0,
      t0: this.T,
      free: p.reduce((a, e) => a + e.len / (e.vm * dr.f), 0),
      sp: null,
      w: null,
    };
  }

  place(v: Vehicle, e: NetEdge, li: number, s: number) {
    v.s = s;
    v.i = Math.max(0, v.p.indexOf(e));
    this.enter(v, e);
    const q = e.ln[li];
    let i = 0;
    while (i < q.length && q[i].s > s) i++;
    q.splice(i, 0, v);
    e.cnt++;
    this.nv++;
  }

  prefill() {
    const target = Math.min(
      this.maxVeh,
      Math.round(
        (this.params.load / 100) *
          SPAWN_RATE *
          this.scale *
          (1 + this.hotTot * 0.04) *
          Math.max(0.3, this.clock.mult(this.T)) *
          260
      )
    );
    for (let tries = 0; tries < target * 3 && this.nv < target; tries++) {
      const trip = this.pickTrip();
      if (!trip) break;
      const ty = this.pickType();
      const dr = this.makeDriver(ty);
      const p = this.router.route(trip.o, trip.d, ty.k, false, null);
      if (!p) continue;
      const pi = Math.floor(this.rnd() * p.length);
      const e = p[pi];
      const li = this.laneFor(e, p[pi + 1]);
      const s = this.rnd() * e.len * 0.9;
      const q = e.ln[li];
      if (q.some(u => Math.abs(u.s - s) < u.L + ty.L + 3)) continue;
      this.place(this.makeVehicle(ty, dr, p, trip.d, trip.hot), e, li, s);
    }
  }

  step(dt: number) {
    this.T += dt;
    if (!(this.fc++ % 50)) this.refreshRules();
    if (!(this.fc % 100)) this.decay();
    this.acc += (this.params.load / 100) * SPAWN_RATE * this.scale * this.clock.mult(this.T) * (1 + this.hotTot * 0.04) * dt;
    while (this.acc >= 1) {
      this.acc--;
      if (this.nv < this.maxVeh) this.spawn();
    }
    for (const e of this.net.edges) {
      if (!e.cnt) {
        if (e.r < 1) e.r += (1 - e.r) * Math.min(1, dt / 5);
        continue;
      }
      const cap = this.rules.cap.get(e.road.id);
      const rid = e.road.id;
      const mt = this.mt[rid] || (this.mt[rid] = [0, 0, 0, 0]);
      let n = 0;
      let sl = 0;
      let sumL = 0;
      for (const q of e.ln) {
        for (let k = 0; k < q.length; k++) {
          const v = q[k];
          const ld = k ? q[k - 1] : null;
          const cp = cap ? cap / 3.6 : 1e9;
          const vf = Math.min(e.vm * v.f, cp);
          const vref = Math.min(e.vm0 * v.f, cp);
          const nx = v.p[v.i + 1];
          let gap = 1e9;
          if (ld) gap = ld.s - ld.L - v.s - 1.5;
          else if (nx && this.can(e, nx, v) < 0) gap = e.len - v.s - 0.5;
          if (v.sp != null) {
            if (v.w != null) {
              if (this.T >= v.w) {
                v.sp = null;
                v.w = null;
              } else {
                gap = 0;
              }
            } else {
              const g = v.sp - v.s;
              if (g < 1 && v.v < 0.5) {
                v.w = this.T + v.ty.dwell;
                gap = 0;
              } else {
                gap = Math.min(gap, g);
              }
            }
          }
          v.v += Math.max(-9 * dt, Math.min(v.acc * dt, Math.min(vf, Math.max(0, gap) / v.tau) - v.v));
          v.s += v.v * dt;
          if (ld && v.s > ld.s - ld.L - 0.5) {
            v.s = Math.max(0, ld.s - ld.L - 0.5);
            v.v = Math.min(v.v, ld.v);
          }
          const ratio = Math.min(1, v.v / vref);
          n++;
          sl += ratio;
          sumL += v.L + 2;
          this.loss[rid] = (this.loss[rid] || 0) + (1 - ratio) * dt;
          mt[0] += dt;
          mt[1] += v.v * dt;
          mt[3] += (1 - ratio) * dt;
          if (v.v < 1) {
            mt[2] += dt;
            this.jamR[rid] = (this.jamR[rid] || 0) + dt;
            this.jamN[e.b.id] = (this.jamN[e.b.id] || 0) + dt;
          }
          if (!ld && v.s >= e.len) {
            if (!nx) {
              q.shift();
              e.cnt--;
              k--;
              this.nv--;
              const tr = this.T - v.t0;
              const d = Math.max(0, tr - v.free);
              const rr = tr / Math.max(1, v.free);
              this.done++;
              this.dsum += d;
              if (v.hot) {
                const h = this.hstat[v.hot] || (this.hstat[v.hot] = { n: 0, started: 0, dsum: 0 });
                h.n++;
                h.dsum += d;
              }
              this.avgD = this.avgD == null ? d : this.avgD * 0.95 + d * 0.05;
              this.avgR = this.avgR == null ? rr : this.avgR * 0.95 + rr * 0.05;
              continue;
            }
            const li = this.can(e, nx, v);
            if (li >= 0) {
              q.shift();
              e.cnt--;
              k--;
              v.i++;
              v.s = 0;
              this.enter(v, nx);
              nx.ln[li].push(v);
              nx.cnt++;
              e.b.free = this.T + this.hw(e.b, e);
            } else {
              v.s = e.len - 0.5;
              v.v = 0;
            }
          }
        }
      }
      const avg = n ? sl / n : 1;
      const fill = Math.min(1, sumL / (e.len * e.lanes) / 0.12);
      const target = 1 - (1 - avg) * fill;
      e.r += (target - e.r) * Math.min(1, dt / 5);
    }
  }

  warm(n: number) {
    for (let i = 0; i < n; i++) this.step(0.1);
  }

  worstRoads(n = 6): { road: Road; loss: number; jam: number }[] {
    return Object.entries(this.loss)
      .filter(([, v]) => v > 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([id, v]) => ({ road: this.store.roads.find(r => String(r.id) === id), loss: v, jam: this.jamR[+id] || 0 }))
      .filter((x): x is { road: Road; loss: number; jam: number } => Boolean(x.road));
  }

  snapshot(ids: number[]) {
    const o = { n: 0, ratio: 0, stopped: 0, speed: 0, byType: {} as Record<string, number>, pass: 0, limit: 0 };
    let lim = 0;
    let le = 0;
    for (const id of ids) {
      o.pass += this.pass[id] || 0;
      for (const e of this.net.byRoad.get(id) || []) {
        lim += e.vm0 * 3.6;
        le++;
        for (const q of e.ln) {
          for (const v of q) {
            o.n++;
            o.ratio += Math.min(1, v.v / (e.vm0 * v.f));
            o.speed += v.v;
            if (v.v < 1) o.stopped++;
            o.byType[v.ty.n] = (o.byType[v.ty.n] || 0) + 1;
          }
        }
      }
    }
    o.ratio = o.n ? o.ratio / o.n : 1;
    o.speed = o.n ? (o.speed / o.n) * 3.6 : 0;
    o.limit = le ? lim / le : 0;
    return o;
  }
}
