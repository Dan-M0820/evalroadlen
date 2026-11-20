import { Geo } from './geo.js';
import { LANE_W, ROAD_TYPES } from '../config.js';

// Junction geometry shared by the simulation and the visual editor. No DOM here.
//
// ARM      a road leaving a junction point. id = road.id + 's' (the arm runs toward the road's START) or 'e' (toward its END).
//          u = unit vector pointing away from the junction. n = (-uy, ux): the right-hand side of a driver ARRIVING (inbound lanes sit on +n).
// MOVEMENT going from an inbound arm to an outbound arm, typed by turn angle: L (left), S (straight), R (right). Key = 'inArm>outArm'.
// LANE     inbound lane 0 is the driver's leftmost lane. Each lane lists the movement types it may take (J.lanes[armId][lane]).
// PHASE    J.phases = [{ dur, clear, allow: [movement keys] }]: which movements get green together, then an all-red gap.

export const MOVES = ['L', 'S', 'R'];
export const TURN_NAME = { L: 'Left', S: 'Straight', R: 'Right' };

export const angDiff = (a, b) => { let d = (a - b) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };

// Turn type from the heading a vehicle arrives with and the heading it leaves with (world coordinates, y up).
export function classify(hin, hout) {
  const a = Math.atan2(hin[0] * hout[1] - hin[1] * hout[0], hin[0] * hout[0] + hin[1] * hout[1]) * 180 / Math.PI;
  return a > 30 ? 'L' : a < -30 ? 'R' : 'S';
}

// Sensible starting lane use. 1 lane: everything. 2: left lane left+straight, right lane straight+right. 3+: left / straight... / straight+right.
export function defaultPerms(n) {
  if (n <= 1) return [['L', 'S', 'R']];
  if (n === 2) return [['L', 'S'], ['S', 'R']];
  return Array.from({ length: n }, (_, k) => k === 0 ? ['L'] : k === n - 1 ? ['S', 'R'] : ['S']);
}
// The lane use of an inbound arm: what is stored, or the default if nothing (or the wrong lane count) is stored.
export function lanePerms(J, armId, n) {
  const P = J && J.lanes && J.lanes[armId];
  return Array.isArray(P) && P.length === n ? P : defaultPerms(n);
}

// ---- arms ---------------------------------------------------------------------------------------
export const medianOf = r => r.dir === 'both' ? ROAD_TYPES[r.type].median : 0;
// lanes in each travel direction of a road: f = start->end, b = end->start
export const laneCounts = r => ({ f: r.dir === 'rev' ? 0 : r.lanes, b: r.dir === 'both' ? (r.lanesR ?? r.lanes) : r.dir === 'rev' ? r.lanes : 0 });

function makeArm(r, i, to) {
  const xy = r._xy, raw = to === 's' ? xy.slice(0, i + 1).reverse() : xy.slice(i), pts = [raw[0]];
  for (let k = 1; k < raw.length; k++) if (Math.hypot(raw[k][0] - pts[pts.length - 1][0], raw[k][1] - pts[pts.length - 1][1]) > .05) pts.push(raw[k]);
  const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const dx = (pts[1] || pts[0])[0] - pts[0][0], dy = (pts[1] || pts[0])[1] - pts[0][1], l = Math.hypot(dx, dy) || 1, u = [dx / l, dy / l];
  const c = laneCounts(r), inN = to === 's' ? c.f : c.b, outN = to === 's' ? c.b : c.f, med = medianOf(r);
  const two = r.dir === 'both', N = inN || outN;
  return { id: r.id + to, road: r, to, idx: i, pts, cum, len: cum[cum.length - 1], u, n: [-u[1], u[0]], ang: Math.atan2(u[1], u[0]) * 180 / Math.PI,
    inN, outN, two, med, wIn: two ? med / 2 + inN * LANE_W : N * LANE_W / 2, wOut: two ? med / 2 + outN * LANE_W : N * LANE_W / 2 };
}
// All arms at a junction point (identified by its coordinate key), sorted counter-clockwise from east.
export function armsAt(roads, key) {
  const arms = [];
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

// Lateral position (metres, positive toward the arm's +n side) of the centre of inbound or outbound lane k.
export function laneLat(arm, inbound, k) {
  const N = inbound ? arm.inN : arm.outN;
  if (arm.two) return inbound ? arm.med / 2 + (k + .5) * LANE_W : -(arm.med / 2 + (k + .5) * LANE_W);
  return inbound ? -N * LANE_W / 2 + (k + .5) * LANE_W : N * LANE_W / 2 - (k + .5) * LANE_W;
}
export const laneBlockLat = (arm, inbound) => { const N = inbound ? arm.inN : arm.outN; return N ? (laneLat(arm, inbound, 0) + laneLat(arm, inbound, N - 1)) / 2 : 0; };

// point along an arm's centre line at distance s from the junction, plus the unit direction there (pointing away from the junction)
export function armPoint(arm, s) {
  const p = arm.pts, c = arm.cum; s = Math.max(0, s); let i = 0; while (i < p.length - 2 && c[i + 1] < s) i++;
  if (p.length < 2) return [p[0][0], p[0][1], arm.u[0], arm.u[1]];
  const A = p[i], B = p[i + 1], sl = c[i + 1] - c[i] || 1, t = (s - c[i]) / sl, ux = (B[0] - A[0]) / sl, uy = (B[1] - A[1]) / sl;
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, ux, uy];
}
// world point on lane `lat` metres to the arm's +n side, at distance s along the arm
export function armLanePoint(arm, s, lat) { const q = armPoint(arm, s); return [q[0] - q[3] * lat, q[1] + q[2] * lat, q[2], q[3]]; }

// How far from the junction point the junction "box" extends (where stop lines go).
export function boxDistance(arms) {
  const w = Math.max(3, ...arms.map(a => Math.max(a.wIn, a.wOut)));
  return Math.max(6, Math.min(26, w * 1.15 + 2));
}

export function movements(arms) {
  const mv = [];
  for (const A of arms) if (A.inN > 0) for (const B of arms) {
    if (B === A || B.outN <= 0) continue;
    mv.push({ a: A.id, b: B.id, type: classify([-A.u[0], -A.u[1]], B.u), key: A.id + '>' + B.id });
  }
  return mv;
}

// ---- signal plan --------------------------------------------------------------------------------
// Group opposite arms into phases (a T gives two phases, a cross two, five arms three...). Everything is editable afterwards.
export function autoPhases(arms, mvs, dur = 20, clear = 3) {
  const ins = arms.filter(a => a.inN > 0), used = new Set(), groups = [];
  for (const A of ins) {
    if (used.has(A.id)) continue; used.add(A.id);
    let opp = null, best = 35;
    for (const B of ins) { if (used.has(B.id)) continue; const off = 180 - Math.abs(angDiff(A.ang, B.ang)); if (off < best) { best = off; opp = B; } }
    if (opp) used.add(opp.id);
    groups.push({ ids: opp ? [A.id, opp.id] : [A.id], ang: Math.min(A.ang, opp ? opp.ang : 999) });
  }
  groups.sort((a, b) => a.ang - b.ang);
  return groups.map(g => ({ dur, clear, allow: mvs.filter(m => g.ids.includes(m.a)).map(m => m.key) }));
}
// Drop movements that no longer exist; if an arm now never gets green, start over with an automatic plan.
export function repairPhases(J, arms, mvs) {
  if (!J.phases || !J.phases.length) { J.phases = autoPhases(arms, mvs); return true; }
  const keys = new Set(mvs.map(m => m.key)); let ch = false;
  for (const p of J.phases) { const a = p.allow.filter(k => keys.has(k)); if (a.length !== p.allow.length) { p.allow = a; ch = true; } }
  const green = new Set(J.phases.flatMap(p => p.allow));
  if (mvs.some(m => !green.has(m.key))) { J.phases = autoPhases(arms, mvs, J.phases[0].dur, J.phases[0].clear); ch = true; }
  return ch;
}
export function cycleOf(J) {
  const spans = []; let t = 0;
  for (const p of J.phases || []) { const dur = Math.max(3, +p.dur || 15), clr = Math.max(0, p.clear == null ? 3 : +p.clear); spans.push({ t0: t, t1: t + dur, set: new Set(p.allow) }); t += dur + clr; }
  return { tot: Math.max(1, t), spans };
}
export function phaseAt(cyc, T, offset = 0) {
  const t = (((T + (+offset || 0)) % cyc.tot) + cyc.tot) % cyc.tot;
  for (let i = 0; i < cyc.spans.length; i++) if (t >= cyc.spans[i].t0 && t < cyc.spans[i].t1) return i;
  return -1; // all-red gap
}

// ---- conflicts ----------------------------------------------------------------------------------
// Rough path of a movement through the box: inbound lane block at the stop line -> outbound lane block.
export function movePath(A, B, d) {
  const p = armLanePoint(A, d, laneBlockLat(A, true)), q = armLanePoint(B, d, laneBlockLat(B, false));
  return [[p[0], p[1]], [q[0], q[1]]];
}
const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
export function segCross(p1, p2, p3, p4) {
  const d1 = cross2(p3, p4, p1), d2 = cross2(p3, p4, p2), d3 = cross2(p1, p2, p3), d4 = cross2(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
// Movements that share a green but whose paths cross (the driver has to give way). Merges and diverges are not conflicts.
export function phaseConflicts(allow, mvs, arms, d) {
  const by = new Map(arms.map(a => [a.id, a])), list = allow.map(k => mvs.find(m => m.key === k)).filter(Boolean), out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j]; if (a.a === b.a || a.b === b.b) continue;
    const P = movePath(by.get(a.a), by.get(a.b), d), Q = movePath(by.get(b.a), by.get(b.b), d);
    if (segCross(P[0], P[1], Q[0], Q[1])) out.push([a.key, b.key]);
  }
  return out;
}
