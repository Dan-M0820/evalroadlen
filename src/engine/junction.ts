import { Geo } from './geo';
import { LANE_W, ROAD_TYPES } from '../config';
import type { JunctionConfig, Road, SignalPhase, TurnMove } from '../types';

export const MOVES: TurnMove[] = ['L', 'S', 'R'];
export const TURN_NAME: Record<TurnMove, string> = { L: 'Left', S: 'Straight', R: 'Right' };

export interface Arm {
  id: string;
  road: Road;
  to: 's' | 'e';
  idx: number;
  pts: [number, number][];
  cum: number[];
  len: number;
  u: [number, number];
  n: [number, number];
  ang: number;
  inN: number;
  outN: number;
  two: boolean;
  med: number;
  wIn: number;
  wOut: number;
}

export interface Movement {
  a: string;
  b: string;
  type: TurnMove;
  key: string;
}

export interface CycleSpan {
  t0: number;
  t1: number;
  set: Set<string>;
}

export interface CompiledCycle {
  tot: number;
  spans: CycleSpan[];
}

export const angDiff = (a: number, b: number): number => {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

// Turn type from the heading a vehicle arrives with and the heading it leaves with (world coordinates, y up).
export function classify(hin: [number, number], hout: [number, number]): TurnMove {
  const a = (Math.atan2(hin[0] * hout[1] - hin[1] * hout[0], hin[0] * hout[0] + hin[1] * hout[1]) * 180) / Math.PI;
  return a > 30 ? 'L' : a < -30 ? 'R' : 'S';
}

// Sensible starting lane use.
export function defaultPerms(n: number): TurnMove[][] {
  if (n <= 1) return [['L', 'S', 'R']];
  if (n === 2) return [['L', 'S'], ['S', 'R']];
  return Array.from({ length: n }, (_, k) => (k === 0 ? ['L'] : k === n - 1 ? ['S', 'R'] : ['S']));
}

export function lanePerms(J: JunctionConfig | null | undefined, armId: string, n: number): TurnMove[][] {
  const P = J && J.lanes && J.lanes[armId];
  return Array.isArray(P) && P.length === n ? P.map(arr => [...arr]) : defaultPerms(n);
}

export const medianOf = (r: Road): number => (r.dir === 'both' ? ROAD_TYPES[r.type].median : 0);

export const laneCounts = (r: Road): { f: number; b: number } => ({
  f: r.dir === 'rev' ? 0 : r.lanes,
  b: r.dir === 'both' ? (r.lanesR ?? r.lanes) : r.dir === 'rev' ? r.lanes : 0,
});

function makeArm(r: Road, i: number, to: 's' | 'e'): Arm {
  const xy = r._xy!;
  const raw = to === 's' ? xy.slice(0, i + 1).reverse() : xy.slice(i);
  const pts: [number, number][] = [raw[0]];
  for (let k = 1; k < raw.length; k++) {
    if (Math.hypot(raw[k][0] - pts[pts.length - 1][0], raw[k][1] - pts[pts.length - 1][1]) > 0.05) {
      pts.push(raw[k]);
    }
  }
  const cum = [0];
  for (let k = 1; k < pts.length; k++) {
    cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  }
  const dx = (pts[1] || pts[0])[0] - pts[0][0];
  const dy = (pts[1] || pts[0])[1] - pts[0][1];
  const l = Math.hypot(dx, dy) || 1;
  const u: [number, number] = [dx / l, dy / l];
  const c = laneCounts(r);
  const inN = to === 's' ? c.f : c.b;
  const outN = to === 's' ? c.b : c.f;
  const med = medianOf(r);
  const two = r.dir === 'both';
  const N = inN || outN;
  return {
    id: r.id + to,
    road: r,
    to,
    idx: i,
    pts,
    cum,
    len: cum[cum.length - 1],
    u,
    n: [-u[1], u[0]],
    ang: (Math.atan2(u[1], u[0]) * 180) / Math.PI,
    inN,
    outN,
    two,
    med,
    wIn: two ? med / 2 + inN * LANE_W : (N * LANE_W) / 2,
    wOut: two ? med / 2 + outN * LANE_W : (N * LANE_W) / 2,
  };
}

export function armsAt(roads: Road[], key: string): Arm[] {
  const arms: Arm[] = [];
  for (const r of roads) {
    if (r.closed || !r._xy) continue;
    for (let i = 0; i < r.pts.length; i++) {
      if (Geo.key(r.pts[i]) !== key) continue;
      if (i > 0) arms.push(makeArm(r, i, 's'));
      if (i < r.pts.length - 1) arms.push(makeArm(r, i, 'e'));
    }
  }
  return arms.sort((a, b) => a.ang - b.ang);
}

export function laneLat(arm: Arm, inbound: boolean, k: number): number {
  const N = inbound ? arm.inN : arm.outN;
  if (arm.two) return inbound ? arm.med / 2 + (k + 0.5) * LANE_W : -(arm.med / 2 + (k + 0.5) * LANE_W);
  return inbound ? (-N * LANE_W) / 2 + (k + 0.5) * LANE_W : (N * LANE_W) / 2 - (k + 0.5) * LANE_W;
}

export const laneBlockLat = (arm: Arm, inbound: boolean): number => {
  const N = inbound ? arm.inN : arm.outN;
  return N ? (laneLat(arm, inbound, 0) + laneLat(arm, inbound, N - 1)) / 2 : 0;
};

export function armPoint(arm: Arm, s: number): [number, number, number, number] {
  const p = arm.pts;
  const c = arm.cum;
  s = Math.max(0, s);
  let i = 0;
  while (i < p.length - 2 && c[i + 1] < s) i++;
  if (p.length < 2) return [p[0][0], p[0][1], arm.u[0], arm.u[1]];
  const A = p[i];
  const B = p[i + 1];
  const sl = c[i + 1] - c[i] || 1;
  const t = (s - c[i]) / sl;
  const ux = (B[0] - A[0]) / sl;
  const uy = (B[1] - A[1]) / sl;
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, ux, uy];
}

export function armLanePoint(arm: Arm, s: number, lat: number): [number, number, number, number] {
  const q = armPoint(arm, s);
  return [q[0] - q[3] * lat, q[1] + q[2] * lat, q[2], q[3]];
}

export function boxDistance(arms: Arm[]): number {
  const w = Math.max(3, ...arms.map(a => Math.max(a.wIn, a.wOut)));
  return Math.max(6, Math.min(26, w * 1.15 + 2));
}

export function movements(arms: Arm[]): Movement[] {
  const mv: Movement[] = [];
  for (const A of arms) {
    if (A.inN <= 0) continue;
    for (const B of arms) {
      if (B === A || B.outN <= 0) continue;
      mv.push({ a: A.id, b: B.id, type: classify([-A.u[0], -A.u[1]], B.u), key: A.id + '>' + B.id });
    }
  }
  return mv;
}

export function autoPhases(arms: Arm[], mvs: Movement[], dur = 20, clear = 3): SignalPhase[] {
  const ins = arms.filter(a => a.inN > 0);
  const used = new Set<string>();
  const groups: { ids: string[]; ang: number }[] = [];
  for (const A of ins) {
    if (used.has(A.id)) continue;
    used.add(A.id);
    let opp: Arm | null = null;
    let best = 35;
    for (const B of ins) {
      if (used.has(B.id)) continue;
      const off = 180 - Math.abs(angDiff(A.ang, B.ang));
      if (off < best) {
        best = off;
        opp = B;
      }
    }
    if (opp) used.add(opp.id);
    groups.push({ ids: opp ? [A.id, opp.id] : [A.id], ang: Math.min(A.ang, opp ? opp.ang : 999) });
  }
  groups.sort((a, b) => a.ang - b.ang);
  return groups.map(g => ({ dur, clear, allow: mvs.filter(m => g.ids.includes(m.a)).map(m => m.key) }));
}

export function repairPhases(J: JunctionConfig, arms: Arm[], mvs: Movement[]): boolean {
  if (!J.phases || !J.phases.length) {
    J.phases = autoPhases(arms, mvs);
    return true;
  }
  const keys = new Set(mvs.map(m => m.key));
  let ch = false;
  for (const p of J.phases) {
    const a = p.allow.filter(k => keys.has(k));
    if (a.length !== p.allow.length) {
      p.allow = a;
      ch = true;
    }
  }
  const green = new Set(J.phases.flatMap(p => p.allow));
  if (mvs.some(m => !green.has(m.key))) {
    J.phases = autoPhases(arms, mvs, J.phases[0].dur, J.phases[0].clear);
    ch = true;
  }
  return ch;
}

export function cycleOf(J: JunctionConfig): CompiledCycle {
  const spans: CycleSpan[] = [];
  let t = 0;
  for (const p of J.phases || []) {
    const dur = Math.max(3, +p.dur || 15);
    const clr = Math.max(0, p.clear == null ? 3 : +p.clear);
    spans.push({ t0: t, t1: t + dur, set: new Set(p.allow) });
    t += dur + clr;
  }
  return { tot: Math.max(1, t), spans };
}

export function phaseAt(cyc: CompiledCycle, T: number, offset = 0): number {
  const t = (((T + (+offset || 0)) % cyc.tot) + cyc.tot) % cyc.tot;
  for (let i = 0; i < cyc.spans.length; i++) {
    if (t >= cyc.spans[i].t0 && t < cyc.spans[i].t1) return i;
  }
  return -1;
}

export function movePath(A: Arm, B: Arm, d: number): [[number, number], [number, number]] {
  const p = armLanePoint(A, d, laneBlockLat(A, true));
  const q = armLanePoint(B, d, laneBlockLat(B, false));
  return [
    [p[0], p[1]],
    [q[0], q[1]],
  ];
}

const cross2 = (o: [number, number], a: [number, number], b: [number, number]) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

export function segCross(p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number]): boolean {
  const d1 = cross2(p3, p4, p1);
  const d2 = cross2(p3, p4, p2);
  const d3 = cross2(p1, p2, p3);
  const d4 = cross2(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function phaseConflicts(allow: string[], mvs: Movement[], arms: Arm[], d: number): [string, string][] {
  const by = new Map(arms.map(a => [a.id, a]));
  const list = allow.map(k => mvs.find(m => m.key === k)).filter((m): m is Movement => Boolean(m));
  const out: [string, string][] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.a === b.a || a.b === b.b) continue;
      const A1 = by.get(a.a);
      const B1 = by.get(a.b);
      const A2 = by.get(b.a);
      const B2 = by.get(b.b);
      if (!A1 || !B1 || !A2 || !B2) continue;
      const P = movePath(A1, B1, d);
      const Q = movePath(A2, B2, d);
      if (segCross(P[0], P[1], Q[0], Q[1])) out.push([a.key, b.key]);
    }
  }
  return out;
}
