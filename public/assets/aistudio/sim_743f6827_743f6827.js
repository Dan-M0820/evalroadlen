import { Network } from './network.js';
import { Router } from './router.js';
import { Clock } from './clock.js';
import { RuleSet } from './rules.js';
import { cycleOf, phaseAt } from './junction.js';

const SPAWN_RATE = 4;       // trips per second at traffic slider 100 and demand 1
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Vehicle simulation: lanes, car-following, junction control, hotspots, stops, rules and measurements.
// No DOM here, so it also runs headless in the tests.
export class Sim {
  constructor(store) {
    this.store = store; this.clock = new Clock(store); this.rules = new RuleSet();
    this.cyc = new WeakMap(); this.params = { load: 30 }; this.scale = 1; // scale < 1 in a workbench: a small area sees only a share of the town's trips
    this.maxVeh = 1500; this.T = 0; this.run = true; this.busy = false; this.fc = 0;
    this.seed(1); this.rebuild();
  }

  seed(n) { let a = n; this.rnd = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  gauss() { return (this.rnd() + this.rnd() + this.rnd() - 1.5) / .5; } // roughly N(0,1)

  rebuild() {
    this.net = Network.build(this.store.roads, this.store.junctions);
    this.net.applyWeights(this.store.bxy);
    if (this.store.wb) this.net.boostGates(this.store.wb.c[0], this.store.wb.c[1], this.store.wb.R);
    this.t0 = this.T;
    this.router = new Router(this.net, this.rules, this.store.junctions);
    Object.assign(this, { nv: 0, acc: 0, nextId: 1, pass: {}, jamR: {}, jamN: {}, loss: {}, mt: {}, hstat: {}, done: 0, dsum: 0, avgD: null, avgR: null });
    this.refreshHotspots(); this.refreshRules();
  }
  refreshRules() { this.rules.refresh(this.store.rules, this.store.roads, this.store.vehicles, this.clock.now(this.T)); this.updateActive(); }
  decay() { for (const o of [this.jamR, this.jamN, this.loss]) for (const k in o) o[k] *= .97; }

  // ---- hotspots: places that pull trips in (school, market, terminal...) or push them out -----------
  refreshHotspots() {
    const core = this.net.core;
    this.hot = this.store.hotspots.map(h => {
      const [x, y] = h.xy; let c = core.map(n => ({ n, d: Math.hypot(n.x - x, n.y - y) }));
      let near = c.filter(o => o.d <= h.radius); if (!near.length) near = c.sort((a, b) => a.d - b.d).slice(0, 3);
      let t = 0; const cum = near.map(o => (t += 1 / (1 + o.d / 80)));
      return { h, nodes: near.map(o => o.n), cum, tot: t };
    }).filter(H => H.nodes.length);
    this.updateActive();
  }
  updateActive() {
    const sec = this.clock.now(this.T); this.hotAct = (this.hot || []).filter(H => RuleSet.inWindow(H.h, sec));
    this.hotTot = this.hotAct.reduce((a, H) => a + H.h.weight, 0);
  }
  pickIn(H) { let r = this.rnd() * H.tot, i = 0; while (i < H.cum.length - 1 && H.cum[i] < r) i++; return H.nodes[i]; }

  // ---- drivers -------------------------------------------------------------------------------
  pickType() {
    const V = this.store.vehicles; let r = this.rnd() * (V.reduce((a, y) => a + y.w, 0) || 1);
    for (const y of V) if ((r -= y.w) < 0) return y;
    return V[V.length - 1];
  }
  // One driver = the type's average plus personal variation. aggr moves following gap, speed and acceleration.
  makeDriver(ty) {
    const sp = ty.spread, aggr = clamp(ty.aggr + this.gauss() * sp * .3, 0, 1), j = () => 1 + this.gauss() * sp * .15;
    return { aggr, tau: Math.max(.4, ty.tau * (1.3 - .6 * aggr) * j()), f: clamp(ty.f * (.9 + .2 * aggr) * j(), .2, 1.4),
      acc: Math.max(.5, ty.acc * (.85 + .3 * aggr)), avoid: this.rnd() < ty.avoid };
  }

  // ---- junction control ----------------------------------------------------------------------
  // J = { ctrl: free | yield | stop | signal | crossing, lanes: {armId: [[turns per lane]]}, appr: {armId: prio|yield|stop},
  //       phases: [{dur, clear, allow:[movement keys]}], gA, gB, allRed, offset, every, dur, dh, from, to, bans, major (older saves) }
  ctl(n) { const J = this.store.junctions[n.key]; if (!J || J.ctrl === 'free') return null; if (J.from && J.to && !RuleSet.inWindow(J, this.clock.now(this.T))) return null; return J; }
  invalidate() { this.cyc = new WeakMap(); } // call after the phase plan of any junction was edited
  cycle(J) { let c = this.cyc.get(J); if (!c) { c = cycleOf(J); this.cyc.set(J, c); } return c; }
  // index of the phase that is green now (-1 during the all-red gap)
  phaseNow(J) { return phaseAt(this.cycle(J), this.T, J.offset); }
  green(J, g) { const a = +J.gA || 20, b = +J.gB || 20, r = J.allRed != null && J.allRed !== '' ? +J.allRed : 3, t = (this.T + (+J.offset || 0)) % (a + b + 2 * r); return g === 0 ? t < a : (t >= a + r && t < a + r + b); }
  // may a vehicle go from edge e into edge nx at this signal?
  sigOpen(J, e, nx) {
    if (J.phases && J.phases.length) { const c = this.cycle(J), i = phaseAt(c, this.T, J.offset); return i >= 0 && c.spans[i].set.has(e.armIn + '>' + nx.armOut); }
    return this.green(J, e.grp);
  }
  // how an approach is treated at a stop / yield junction: prio (keeps going), yield, or stop
  appr(J, e) {
    const a = J.appr && J.appr[e.armIn]; if (a) return a;
    if (J.major != null && J.major !== '' && J.major !== 'none') return J.major == e.road.id ? 'prio' : J.ctrl;
    return J.ctrl === 'stop' ? 'stop' : 'yield';
  }
  // is a vehicle close to the junction on a priority approach? (then the others wait)
  prioBusy(n, J, e) {
    for (const o of n.in) { if (o === e || this.appr(J, o) !== 'prio') continue; for (const q of o.ln) { const t = q[0]; if (t && t.s > o.len - 30) return true; } }
    return false;
  }
  // seconds the junction stays "occupied" after one vehicle crosses: bigger = slower discharge
  hw(n, e) {
    const J = this.ctl(n); if (!J) return 1.2; if (+J.dh > 0) return +J.dh;
    if (J.ctrl === 'signal') return .9; if (J.ctrl === 'crossing') return 1.2;
    const a = this.appr(J, e); return a === 'prio' ? 1.2 : a === 'stop' ? 2.5 : 1.8;
  }
  // lane of e a vehicle should take: the emptiest lane that is allowed to make its next turn (nxt = the edge it takes after e)
  best(e, nxt) {
    const perm = nxt && e.perm ? e.perm.get(nxt.id) : null, use = perm && perm.length ? perm : null; let b = -1, m = 1e9;
    e.ln.forEach((q, i) => { if (use && !use.includes(i)) return; const t = q[q.length - 1]; if ((!t || t.s - t.L > 2) && q.length < m) { m = q.length; b = i; } });
    return b;
  }
  laneFor(e, nxt) { const perm = nxt && e.perm ? e.perm.get(nxt.id) : null; return perm && perm.length ? perm[Math.floor(this.rnd() * perm.length)] : Math.floor(this.rnd() * e.lanes); }
  can(e, nx, v) {
    const n = e.b, J = this.ctl(n);
    if (J) {
      if (J.ctrl === 'signal' && !this.sigOpen(J, e, nx)) return -1;
      if (J.ctrl === 'crossing' && this.T % (+J.every || 40) < (+J.dur || 8)) return -1; // pedestrians crossing
      if ((J.ctrl === 'stop' || J.ctrl === 'yield') && this.appr(J, e) !== 'prio' && this.prioBusy(n, J, e)) return -1;
    }
    if (n.free > this.T) return -1; return this.best(nx, v ? v.p[v.i + 2] : null);
  }

  enter(v, e) {
    if (v.rd !== e.road.id) { v.rd = e.road.id; this.pass[v.rd] = (this.pass[v.rd] || 0) + 1; }
    const y = v.ty;
    if (y.dwellP && e.len > 40 && this.rnd() < y.dwellP * e.len / 1000) { v.sp = e.len * (.2 + .6 * this.rnd()); v.w = null; }
    // jam-avoiding drivers look at the next road and re-route if it is clogged
    const n = v.p[v.i + 1];
    if (v.avoid && n && n.r < .45 && e.b !== v.dest && this.T - v.rr > 20) {
      v.rr = this.T; const np = this.router.route(e.b, v.dest, y.k, true, e);
      if (np) v.p = v.p.slice(0, v.i + 1).concat(np);
    }
  }

  // ---- trips ---------------------------------------------------------------------------------
  // partner = the other end of a trip; likes nearby places (gravity: exp(-distance / 2.5 km)).
  partner(a) {
    const net = this.net, C = []; let tot = 0;
    for (let i = 0; i < 6; i++) { const d = net.pickNode(this.rnd); if (!d || d === a) continue; const w = Math.exp(-Math.hypot(d.x - a.x, d.y - a.y) / 2500) + .02; C.push([d, w]); tot += w; }
    let r = this.rnd() * tot; for (const [d, w] of C) if ((r -= w) < 0) return d;
    return C.length ? C[0][0] : null;
  }
  // Trip ends are weighted by nearby buildings. Active hotspots take a share of trips (weight 5 ~ 30%).
  pickTrip() {
    const net = this.net;
    if (this.hotAct.length && this.rnd() < Math.min(.7, this.hotTot * .06)) {
      let r = this.rnd() * this.hotTot, H = this.hotAct[this.hotAct.length - 1]; for (const a of this.hotAct) if ((r -= a.h.weight) < 0) { H = a; break; }
      const hn = this.pickIn(H), role = H.h.role === 'both' ? (this.rnd() < .5 ? 'dest' : 'origin') : H.h.role, other = this.partner(hn);
      if (other) return role === 'dest' ? { o: other, d: hn, hot: H.h.id } : { o: hn, d: other, hot: H.h.id };
    }
    const o = net.pickNode(this.rnd); if (!o) return null; const d = this.partner(o);
    return d ? { o, d, hot: null } : null;
  }
  spawn() {
    if (this.net.core.length < 2) return;
    for (let t = 0; t < 3; t++) {
      const trip = this.pickTrip(); if (!trip) continue;
      const ty = this.pickType(), dr = this.makeDriver(ty), p = this.router.route(trip.o, trip.d, ty.k, dr.avoid, null); if (!p) continue;
      const li = this.best(p[0], p[1]); if (li < 0) return;
      this.place(this.makeVehicle(ty, dr, p, trip.d, trip.hot), p[0], li, 0);
      if (trip.hot) (this.hstat[trip.hot] = this.hstat[trip.hot] || { n: 0, started: 0, dsum: 0 }).started++;
      return;
    }
  }
  makeVehicle(ty, dr, p, dest, hot = null) {
    return { id: this.nextId++, s: 0, v: 0, p, i: 0, dest, hot, L: ty.L, ty, c: ty.c, aggr: dr.aggr, tau: dr.tau, f: dr.f, acc: dr.acc, avoid: dr.avoid, rr: -99,
      rd: 0, t0: this.T, free: p.reduce((a, e) => a + e.len / (e.vm * dr.f), 0), sp: null, w: null };
  }
  place(v, e, li, s) { v.s = s; v.i = Math.max(0, v.p.indexOf(e)); this.enter(v, e); const q = e.ln[li]; let i = 0; while (i < q.length && q[i].s > s) i++; q.splice(i, 0, v); e.cnt++; this.nv++; }

  // Fill the map with traffic already "in the middle of their trips" so nothing starts empty.
  prefill() {
    const target = Math.min(this.maxVeh, Math.round(this.params.load / 100 * SPAWN_RATE * this.scale * (1 + this.hotTot * .04) * Math.max(.3, this.clock.mult(this.T)) * 260));
    for (let tries = 0; tries < target * 3 && this.nv < target; tries++) {
      const trip = this.pickTrip(); if (!trip) break;
      const ty = this.pickType(), dr = this.makeDriver(ty), p = this.router.route(trip.o, trip.d, ty.k, false, null); if (!p) continue;
      const pi = Math.floor(this.rnd() * p.length), e = p[pi], li = this.laneFor(e, p[pi + 1]), s = this.rnd() * e.len * .9, q = e.ln[li];
      if (q.some(u => Math.abs(u.s - s) < u.L + ty.L + 3)) continue;
      this.place(this.makeVehicle(ty, dr, p, trip.d, trip.hot), e, li, s);
    }
  }

  // ---- physics -------------------------------------------------------------------------------
  step(dt) {
    this.T += dt; if (!(this.fc++ % 50)) this.refreshRules(); if (!(this.fc % 100)) this.decay();
    this.acc += this.params.load / 100 * SPAWN_RATE * this.scale * this.clock.mult(this.T) * (1 + this.hotTot * .04) * dt; // hotspots also add some extra trips
    while (this.acc >= 1) { this.acc--; if (this.nv < this.maxVeh) this.spawn(); }
    for (const e of this.net.edges) {
      if (!e.cnt) { if (e.r < 1) e.r += (1 - e.r) * Math.min(1, dt / 5); continue; }
      const cap = this.rules.cap.get(e.road.id), rid = e.road.id, mt = this.mt[rid] || (this.mt[rid] = [0, 0, 0, 0]); let n = 0, sl = 0, sumL = 0;
      for (const q of e.ln) for (let k = 0; k < q.length; k++) {
        const v = q[k], ld = k ? q[k - 1] : null, cp = cap ? cap / 3.6 : 1e9, vf = Math.min(e.vm * v.f, cp), vref = Math.min(e.vm0 * v.f, cp), nx = v.p[v.i + 1]; let gap = 1e9;
        if (ld) gap = ld.s - ld.L - v.s - 1.5; else if (nx && this.can(e, nx, v) < 0) gap = e.len - v.s - .5;
        if (v.sp != null) { // stopped to load/unload passengers: blocks the lane
          if (v.w != null) { if (this.T >= v.w) { v.sp = null; v.w = null; } else gap = 0; }
          else { const g = v.sp - v.s; if (g < 1 && v.v < .5) { v.w = this.T + v.ty.dwell; gap = 0; } else gap = Math.min(gap, g); }
        }
        v.v += Math.max(-9 * dt, Math.min(v.acc * dt, Math.min(vf, Math.max(0, gap) / v.tau) - v.v)); v.s += v.v * dt;
        if (ld && v.s > ld.s - ld.L - .5) { v.s = Math.max(0, ld.s - ld.L - .5); v.v = Math.min(v.v, ld.v); }
        const ratio = Math.min(1, v.v / vref); n++; sl += ratio; sumL += v.L + 2;
        this.loss[rid] = (this.loss[rid] || 0) + (1 - ratio) * dt; mt[0] += dt; mt[1] += v.v * dt; mt[3] += (1 - ratio) * dt;
        if (v.v < 1) { mt[2] += dt; this.jamR[rid] = (this.jamR[rid] || 0) + dt; this.jamN[e.b.id] = (this.jamN[e.b.id] || 0) + dt; }
        if (!ld && v.s >= e.len) {
          if (!nx) { // trip finished
            q.shift(); e.cnt--; k--; this.nv--;
            const tr = this.T - v.t0, d = Math.max(0, tr - v.free), rr = tr / Math.max(1, v.free); this.done++; this.dsum += d;
            if (v.hot) { const h = this.hstat[v.hot] || (this.hstat[v.hot] = { n: 0, started: 0, dsum: 0 }); h.n++; h.dsum += d; }
            this.avgD = this.avgD == null ? d : this.avgD * .95 + d * .05; this.avgR = this.avgR == null ? rr : this.avgR * .95 + rr * .05; continue;
          }
          const li = this.can(e, nx, v);
          if (li >= 0) { q.shift(); e.cnt--; k--; v.i++; v.s = 0; this.enter(v, nx); nx.ln[li].push(v); nx.cnt++; e.b.free = this.T + this.hw(e.b, e); }
          else { v.s = e.len - .5; v.v = 0; }
        }
      }
      // Congestion score 1 (free) .. 0 (jammed). A lone slow car on a long road does not count as a jam: weight by how full the road is.
      const avg = n ? sl / n : 1, fill = Math.min(1, (sumL / (e.len * e.lanes)) / .12), target = 1 - (1 - avg) * fill;
      e.r += (target - e.r) * Math.min(1, dt / 5);
    }
  }
  warm(n) { for (let i = 0; i < n; i++) this.step(.1); }

  // Worst roads by vehicle-seconds lost to slow driving, for the "where is the problem" list.
  worstRoads(n = 6) {
    return Object.entries(this.loss).filter(([, v]) => v > 5).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([id, v]) => ({ road: this.store.roads.find(r => r.id == id), loss: v, jam: this.jamR[id] || 0 })).filter(x => x.road);
  }

  // What is on these roads right now (for the live panel): count, speed vs free speed, stopped, by type.
  snapshot(ids) {
    const o = { n: 0, ratio: 0, stopped: 0, speed: 0, byType: {}, pass: 0, limit: 0 }; let lim = 0, le = 0;
    for (const id of ids) {
      o.pass += this.pass[id] || 0;
      for (const e of this.net.byRoad.get(id) || []) { lim += e.vm0 * 3.6; le++;
        for (const q of e.ln) for (const v of q) { o.n++; o.ratio += Math.min(1, v.v / (e.vm0 * v.f)); o.speed += v.v; if (v.v < 1) o.stopped++; o.byType[v.ty.n] = (o.byType[v.ty.n] || 0) + 1; } }
    }
    o.ratio = o.n ? o.ratio / o.n : 1; o.speed = o.n ? o.speed / o.n * 3.6 : 0; o.limit = le ? lim / le : 0; return o;
  }
}
