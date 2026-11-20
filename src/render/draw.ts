import { ROAD_TYPES, HEAT, HOT_KINDS, CTRL_COLOR, LANE_W, defaultControl } from '../config';
import { RuleSet } from '../engine/rules';
import { roadWidth, type NetEdge, type NetNode, type Vehicle } from '../engine/network';
import {
  armsAt,
  armLanePoint,
  boxDistance,
  laneLat,
  lanePerms,
  movements,
  phaseConflicts,
} from '../engine/junction';
import { Geo } from '../engine/geo';
import type { View } from './view';
import type { Store } from '../data/store';
import type { Sim } from '../engine/sim';
import type { Hotspot, LayerOptions, Road, TurnMove } from '../types';

export interface Palette {
  bg: string;
  grid: string;
  bld: string;
  casing: string;
  road: string;
  label: string;
  halo: string;
  sel: string;
  dot: string;
}

const PAL: Record<'dark' | 'light', Palette> = {
  dark: {
    bg: '#0e1419',
    grid: 'rgba(147,166,182,0.07)',
    bld: '#35444f',
    casing: '#04070a',
    road: '#3b4a56',
    label: '#e9eff4',
    halo: '#0a0f13',
    sel: '#ffffff',
    dot: '#0a0f13',
  },
  light: {
    bg: '#e9ece6',
    grid: 'rgba(22,33,43,0.06)',
    bld: '#cbc4b4',
    casing: '#6f7a82',
    road: '#fbfbfb',
    label: '#16212b',
    halo: '#ffffff',
    sel: '#111111',
    dot: '#222222',
  },
};

export const palette = (theme: 'dark' | 'light' = 'dark'): Palette => PAL[theme];

const HEAT_TABLE = Array.from({ length: 25 }, (_, i) => {
  const t = i / 24;
  const h = t < 0.5 ? HEAT.red + (HEAT.yellow - HEAT.red) * t * 2 : HEAT.yellow + (HEAT.green - HEAT.yellow) * (t - 0.5) * 2;
  return `hsl(${h},85%,48%)`;
});

export const heatColor = (r: number) => HEAT_TABLE[Math.round(Math.max(0, Math.min(1, (r - 0.2) / 0.65)) * 24)];

export function edgeGeom(e: NetEdge, sc: number) {
  const r = e.road;
  const W = Math.max(ROAD_TYPES[r.type].minPx, roadWidth(r) * sc);
  const both = r.dir === 'both';
  return { W, stripe: both ? W / 2 : W, off: both ? W / 4 : 0 };
}

export function posAt(e: NetEdge, s: number): [number, number, number, number] {
  const xy = e.xy;
  const cum = e.cum;
  let i = 0;
  while (i < xy.length - 2 && cum[i + 1] < s) i++;
  const A = xy[i];
  const B = xy[i + 1];
  const sl = cum[i + 1] - cum[i] || 1;
  const t = Math.max(0, Math.min(1, (s - cum[i]) / sl));
  const ux = (B[0] - A[0]) / sl;
  const uy = (B[1] - A[1]) / sl;
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, ux, uy];
}

export function vehicleScreen(view: View, e: NetEdge, v: Vehicle, lane: number, g: { stripe: number; off: number }): [number, number] {
  const p = posAt(e, v.s);
  const [sx, sy] = view.toScreen(p[0], p[1]);
  const lat = g.off + ((lane + 0.5 - e.lanes / 2) * g.stripe) / e.lanes;
  return [sx + lat * p[3], sy + lat * p[2]];
}

export type CanvasInteractiveTarget =
  | { kind: 'turn'; x: number; y: number; r: number; nodeKey: string; armId: string; laneIdx: number; move: TurnMove }
  | { kind: 'appr'; x: number; y: number; w: number; h: number; nodeKey: string; armId: string }
  | { kind: 'phaseMove'; x: number; y: number; r: number; nodeKey: string; moveKey: string }
  | { kind: 'roadLane'; x: number; y: number; r: number; road: Road; side: 'fwd' | 'rev'; delta: 1 | -1 }
  | { kind: 'vertex'; x: number; y: number; r: number; nodeKey: string; wx: number; wy: number };

export interface DrawContext {
  view: View;
  store: Store;
  sim: Sim;
  layers: LayerOptions;
  pal: Palette;
  roadOrder: Road[];
  sel: { road: Road | null; node: NetNode | null; veh: Vehicle | null; hot: Hotspot | null };
  editPhaseIdx: number;
  tool: string;
  draft: Array<{ xy: [number, number] }>;
  hover: { xy: [number, number]; snap?: boolean } | null;
  hoverRoad?: Road | null;
  wb: boolean;
  selPos?: [number, number, number, NetEdge, Vehicle] | null;
  interactiveTargets: CanvasInteractiveTarget[];
  staticVer?: number;
}

let staticCv: HTMLCanvasElement | null = null;
let staticKey = '';

export function drawScene(app: DrawContext, ctx: CanvasRenderingContext2D) {
  const { view, store, sim, layers, pal } = app;
  const net = sim.net;
  const sc = view.scale;
  const W = view.W;
  const H = view.H;
  const vx0 = view.cx - W / 2 / sc - 40;
  const vx1 = view.cx + W / 2 / sc + 40;
  const vy0 = view.cy - H / 2 / sc - 40;
  const vy1 = view.cy + H / 2 / sc + 40;
  const vis = (b: [number, number, number, number]) => !(b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1);
  const S = (x: number, y: number) => view.toScreen(x, y);
  const wpx = (r: Road) => Math.max(ROAD_TYPES[r.type].minPx, roadWidth(r) * sc);

  app.interactiveTargets = [];

  const dpr = ctx.getTransform().a || 1;
  const key = `${app.staticVer ?? 0}|${view.cx.toFixed(3)}|${view.cy.toFixed(3)}|${sc.toFixed(6)}|${W}|${H}|${dpr.toFixed(2)}|${pal.bg}|${layers.buildings ? 1 : 0}|${layers.mode}|${app.sel.road ? app.sel.road.id : ''}`;

  const renderStatic = (tctx: CanvasRenderingContext2D) => {
    tctx.fillStyle = pal.bg;
    tctx.fillRect(0, 0, W, H);

    // Subtle metric grid when zoomed in
    if (sc >= 1.2) {
      const step = sc >= 3 ? 10 : 25;
      tctx.strokeStyle = pal.grid;
      tctx.lineWidth = 1;
      const gx0 = Math.floor(vx0 / step) * step;
      const gy0 = Math.floor(vy0 / step) * step;
      tctx.beginPath();
      for (let x = gx0; x <= vx1; x += step) {
        const [sx] = S(x, 0);
        tctx.moveTo(sx, 0);
        tctx.lineTo(sx, H);
      }
      for (let y = gy0; y <= vy1; y += step) {
        const [, sy] = S(0, y);
        tctx.moveTo(0, sy);
        tctx.lineTo(W, sy);
      }
      tctx.stroke();
    }

    // Buildings (single batched path)
    if (layers.buildings && store.bxy && sc >= 0.05) {
      const s = Math.max(2, 9 * sc);
      const half = s / 2;
      const b = store.bxy;
      tctx.fillStyle = pal.bld;
      tctx.beginPath();
      for (let i = 0; i < b.length; i += 2) {
        const x = b[i];
        const y = b[i + 1];
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
        tctx.rect((x - view.cx) * sc + W / 2 - half, -(y - view.cy) * sc + H / 2 - half, s, s);
      }
      tctx.fill();
    }

    // Roads: batched outline + fill
    tctx.lineCap = 'round';
    tctx.lineJoin = 'round';
    const casingBuckets = new Map<number, Path2D>();
    const fillBuckets = new Map<string, { color: string; lw: number; p: Path2D }>();
    const closedBuckets = new Map<number, Path2D>();

    const addRoadToPath = (p: Path2D, r: Road) => {
      const xy = r._xy!;
      for (let i = 0; i < xy.length; i++) {
        const X = (xy[i][0] - view.cx) * sc + W / 2;
        const Y = -(xy[i][1] - view.cy) * sc + H / 2;
        if (i) p.lineTo(X, Y);
        else p.moveTo(X, Y);
      }
    };

    for (const r of app.roadOrder) {
      if (!r._bb || !r._xy || !vis(r._bb)) continue;
      const lw = Math.round(wpx(r) * 2) / 2;
      let cp = casingBuckets.get(lw);
      if (!cp) {
        cp = new Path2D();
        casingBuckets.set(lw, cp);
      }
      addRoadToPath(cp, r);

      const col = layers.mode === 'type' ? ROAD_TYPES[r.type].color : pal.road;
      const fk = col + '|' + lw;
      let fb = fillBuckets.get(fk);
      if (!fb) {
        fb = { color: col, lw, p: new Path2D() };
        fillBuckets.set(fk, fb);
      }
      addRoadToPath(fb.p, r);

      if (r.closed) {
        let clp = closedBuckets.get(lw);
        if (!clp) {
          clp = new Path2D();
          closedBuckets.set(lw, clp);
        }
        addRoadToPath(clp, r);
      }
    }

    if (app.sel.road && app.sel.road._xy && app.sel.road._bb && vis(app.sel.road._bb)) {
      const sp = new Path2D();
      addRoadToPath(sp, app.sel.road);
      tctx.strokeStyle = pal.sel;
      tctx.lineWidth = wpx(app.sel.road) + 9;
      tctx.globalAlpha = 0.9;
      tctx.stroke(sp);
      tctx.globalAlpha = 1;
    }
    tctx.strokeStyle = pal.casing;
    for (const [lw, cp] of casingBuckets) {
      tctx.lineWidth = lw + 2;
      tctx.stroke(cp);
    }
    for (const fb of fillBuckets.values()) {
      tctx.strokeStyle = fb.color;
      tctx.lineWidth = fb.lw;
      tctx.stroke(fb.p);
    }
    if (closedBuckets.size) {
      tctx.setLineDash([7, 7]);
      tctx.strokeStyle = '#ff4d4d';
      for (const [lw, clp] of closedBuckets) {
        tctx.lineWidth = Math.max(2, lw * 0.5);
        tctx.stroke(clp);
      }
      tctx.setLineDash([]);
    }
  };

  if (typeof document !== 'undefined' && W > 0 && H > 0) {
    if (!staticCv) staticCv = document.createElement('canvas');
    const tw = Math.max(1, Math.floor(W * dpr));
    const th = Math.max(1, Math.floor(H * dpr));
    if (staticCv.width !== tw || staticCv.height !== th) {
      staticCv.width = tw;
      staticCv.height = th;
      staticKey = '';
    }
    if (staticKey !== key) {
      const sctx = staticCv.getContext('2d');
      if (sctx) {
        sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderStatic(sctx);
        staticKey = key;
      }
    }
    ctx.drawImage(staticCv, 0, 0, W, H);
  } else {
    renderStatic(ctx);
  }

  // Only populate paths when needed for zoomed-in lane dividers or street labels
  const paths = new Map<Road, Path2D>();
  if (sc >= 1.5 || (layers.labels && sc >= 0.22)) {
    for (const r of app.roadOrder) {
      if (!r._bb || !r._xy || !vis(r._bb)) continue;
      const p = new Path2D();
      for (let i = 0; i < r._xy.length; i++) {
        const X = (r._xy[i][0] - view.cx) * sc + W / 2;
        const Y = -(r._xy[i][1] - view.cy) * sc + H / 2;
        if (i) p.lineTo(X, Y);
        else p.moveTo(X, Y);
      }
      paths.set(r, p);
    }
  }

  // Congestion strips per edge (batched by color & width)
  const needArrows = (e: NetEdge) => (e.road.dir !== 'both' ? sc >= 0.1 : layers.arrows);
  ctx.lineCap = 'butt';
  const visEdges = net.edges.filter(e => e.road._bb && vis(e.road._bb));
  if (layers.mode === 'heat') {
    const heatBuckets = new Map<string, { color: string; lw: number; p: Path2D }>();
    for (const e of visEdges) {
      const g = edgeGeom(e, sc);
      const lw = Math.round(Math.max(1.6, g.stripe * 0.82) * 2) / 2;
      const col = heatColor(e.r);
      const hk = col + '|' + lw;
      let hb = heatBuckets.get(hk);
      if (!hb) {
        hb = { color: col, lw, p: new Path2D() };
        heatBuckets.set(hk, hb);
      }
      const off = g.off;
      const xy = e.xy;
      for (let i = 0; i < xy.length; i++) {
        const X = (xy[i][0] - view.cx) * sc + W / 2 + off * e.nrm[i][0];
        const Y = -(xy[i][1] - view.cy) * sc + H / 2 - off * e.nrm[i][1];
        if (i) hb.p.lineTo(X, Y);
        else hb.p.moveTo(X, Y);
      }
    }
    ctx.globalAlpha = sc >= 1.6 ? 0.52 : 1;
    for (const hb of heatBuckets.values()) {
      ctx.strokeStyle = hb.color;
      ctx.lineWidth = hb.lw;
      ctx.stroke(hb.p);
    }
    ctx.globalAlpha = 1;
  }

  // Zoomed-in metric road lane dividers & two-way yellow centerlines
  if (sc >= 1.5) {
    for (const [r, p] of paths) {
      if (r.dir === 'both') {
        ctx.strokeStyle = '#ffb703';
        ctx.lineWidth = Math.max(1.5, 0.25 * sc);
        ctx.stroke(p);
      }
      if (r._xy) {
        const lanesFwd = r.dir === 'rev' ? 0 : r.lanes;
        const lanesRev = r.dir === 'both' ? (r.lanesR ?? r.lanes) : r.dir === 'rev' ? r.lanes : 0;
        const med = r.dir === 'both' ? ROAD_TYPES[r.type].median : 0;
        const drawDivider = (latM: number) => {
          ctx.beginPath();
          r._xy!.forEach(([x, y], idx) => {
            const A = r._xy![Math.max(0, idx - 1)];
            const B = r._xy![Math.min(r._xy!.length - 1, idx + 1)];
            const dx = B[0] - A[0];
            const dy = B[1] - A[1];
            const l = Math.hypot(dx, dy) || 1;
            const nx = dy / l;
            const ny = -dx / l;
            const [sx, sy] = S(x + nx * latM, y + ny * latM);
            if (idx) ctx.lineTo(sx, sy);
            else ctx.moveTo(sx, sy);
          });
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.setLineDash([]);
        };
        if (r.dir === 'both') {
          for (let k = 1; k < lanesFwd; k++) drawDivider(med / 2 + k * LANE_W);
          for (let k = 1; k < lanesRev; k++) drawDivider(-(med / 2 + k * LANE_W));
        } else {
          const N = lanesFwd || lanesRev;
          for (let k = 1; k < N; k++) drawDivider(-N * LANE_W * 0.5 + k * LANE_W);
        }
      }
    }
  }

  // Flow arrows
  ctx.lineCap = 'round';
  for (const e of visEdges) {
    if (!needArrows(e) && e.road !== app.sel.road) continue;
    const g = edgeGeom(e, sc);
    const P = e.xy.map(([x, y], i) => {
      const [X, Y] = S(x, y);
      const n = e.nrm[i];
      return [X + g.off * n[0], Y - g.off * n[1]] as [number, number];
    });
    const sz = Math.max(2.6, Math.min(6, g.stripe * 0.42));
    let acc = 22;
    for (let i = 0; i < P.length - 1; i++) {
      const dx = P[i + 1][0] - P[i][0];
      const dy = P[i + 1][1] - P[i][1];
      const l = Math.hypot(dx, dy);
      if (l < 1) continue;
      const ux = dx / l;
      const uy = dy / l;
      let t = acc;
      for (; t < l; t += 64) {
        const cx = P[i][0] + ux * t;
        const cy = P[i][1] + uy * t;
        ctx.beginPath();
        ctx.moveTo(cx + ux * sz, cy + uy * sz);
        ctx.lineTo(cx - ux * sz - uy * sz * 0.8, cy - uy * sz + ux * sz * 0.8);
        ctx.lineTo(cx - ux * sz + uy * sz * 0.8, cy - uy * sz - ux * sz * 0.8);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      acc = t - l;
    }
  }

  // Street names
  if (layers.labels && sc >= 0.22) {
    ctx.font = '600 11px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let n = 0;
    for (const [r] of paths) {
      if (n > 120 || r.name.startsWith(ROAD_TYPES[r.type].label)) continue;
      const m = r._xy;
      if (!m || m.length < 2) continue;
      const i = Math.floor((m.length - 1) / 2);
      const [ax, ay] = S(m[i][0], m[i][1]);
      const [bx, by] = S(m[i + 1][0], m[i + 1][1]);
      const l = Math.hypot(bx - ax, by - ay);
      if (l < ctx.measureText(r.name).width + 12) continue;
      let ang = Math.atan2(by - ay, bx - ax);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      ctx.save();
      ctx.translate((ax + bx) / 2, (ay + by) / 2);
      ctx.rotate(ang);
      ctx.lineWidth = 3;
      ctx.strokeStyle = pal.halo;
      ctx.strokeText(r.name, 0, 0);
      ctx.fillStyle = pal.label;
      ctx.fillText(r.name, 0, 0);
      ctx.restore();
      n++;
    }
  }

  // Junction & control dots
  if (layers.junctions && sc >= 0.1) {
    for (const n of net.nodes) {
      const J = store.junctions[n.key];
      const ctl = J && J.ctrl !== 'free';
      const sel = app.sel.node === n;
      if ((n.deg < 3 && !ctl && !sel) || n.x < vx0 || n.x > vx1 || n.y < vy0 || n.y > vy1) continue;
      const [X, Y] = S(n.x, n.y);
      ctx.beginPath();
      ctx.arc(X, Y, sel ? 9 : Math.max(3.5, Math.min(6.5, 3 + sc * 3)) + (ctl ? 1 : 0), 0, 7);
      ctx.fillStyle = CTRL_COLOR[J ? J.ctrl : 'free'] || '#fff';
      ctx.fill();
      ctx.lineWidth = sel ? 3 : 1.5;
      ctx.strokeStyle = sel ? '#ffb703' : pal.dot;
      ctx.stroke();
      if (J && J.ctrl === 'crossing' && sc >= 0.25) {
        ctx.fillStyle = '#000';
        ctx.fillRect(X - 3, Y - 1, 6, 2);
      }
    }
  }

  // Zoomed-in Visual Road & Junction Editor Overlays
  if (sc >= 1.5) {
    // 1. Selected Junction Overlay: lane turn arrows, approach badges, signal phase curves & live GO/RED tags
    const selNode = app.sel.node;
    const focusNodes = selNode
      ? [selNode]
      : app.wb
        ? net.nodes.filter(n => n.deg >= 3 || (store.junctions[n.key] && store.junctions[n.key].ctrl !== 'free'))
        : [];

    for (const node of focusNodes) {
      const arms = armsAt(store.roads, node.key);
      if (arms.length < 2) continue;
      const dBox = boxDistance(arms);
      const J = store.junctions[node.key] || defaultControl('free');
      const isSelectedNode = selNode === node;
      const [nx, ny] = S(node.x, node.y);

      // Dashed junction box ring
      if (isSelectedNode) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,183,3,0.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(nx, ny, dBox * sc, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Stop lines on every inbound arm
      for (const arm of arms) {
        if (arm.inN <= 0) continue;
        const lat0 = laneLat(arm, true, 0) - LANE_W * 0.45;
        const lat1 = laneLat(arm, true, arm.inN - 1) + LANE_W * 0.45;
        const p0 = armLanePoint(arm, dBox, lat0);
        const p1 = armLanePoint(arm, dBox, lat1);
        const [sx0, sy0] = S(p0[0], p0[1]);
        const [sx1, sy1] = S(p1[0], p1[1]);
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        ctx.lineTo(sx1, sy1);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = J.ctrl === 'signal' ? '#ef4444' : 'rgba(255,255,255,0.85)';
        ctx.stroke();
      }

      // Signal phase movement curves + GO/RED badges
      if (J.ctrl === 'signal' && isSelectedNode) {
        const mvs = movements(arms);
        const phases = J.phases && J.phases.length ? J.phases : [];
        const activePhase = phases[Math.min(app.editPhaseIdx, Math.max(0, phases.length - 1))];
        const livePhaseIdx = sim.phaseNow(J);
        const armById = new Map(arms.map(a => [a.id, a]));
        const conflicts = activePhase ? phaseConflicts(activePhase.allow, mvs, arms, dBox) : [];
        const conflictKeys = new Set(conflicts.flatMap(c => c));

        // Draw curved movement arcs
        for (const mv of mvs) {
          const A = armById.get(mv.a);
          const B = armById.get(mv.b);
          if (!A || !B) continue;
          const p0 = armLanePoint(A, dBox, (laneLat(A, true, 0) + laneLat(A, true, A.inN - 1)) / 2);
          const p1 = armLanePoint(B, dBox, (laneLat(B, false, 0) + laneLat(B, false, B.outN - 1)) / 2);
          const [sx0, sy0] = S(p0[0], p0[1]);
          const [sx1, sy1] = S(p1[0], p1[1]);
          const cxMid = (sx0 + sx1) / 2;
          const cyMid = (sy0 + sy1) / 2;
          const ctrlX = (cxMid + nx) / 2;
          const ctrlY = (cyMid + ny) / 2;
          const allowed = activePhase ? activePhase.allow.includes(mv.key) : false;
          const hasConflict = conflictKeys.has(mv.key);

          ctx.beginPath();
          ctx.moveTo(sx0, sy0);
          ctx.quadraticCurveTo(ctrlX, ctrlY, sx1, sy1);
          ctx.strokeStyle = allowed ? (hasConflict ? '#fb923c' : '#22c55e') : 'rgba(148,163,184,0.3)';
          ctx.lineWidth = allowed ? 3 : 1.5;
          ctx.stroke();

          // Clickable handle at curve midpoint
          const mx = 0.25 * sx0 + 0.5 * ctrlX + 0.25 * sx1;
          const my = 0.25 * sy0 + 0.5 * ctrlY + 0.25 * sy1;
          ctx.beginPath();
          ctx.arc(mx, my, 6, 0, Math.PI * 2);
          ctx.fillStyle = allowed ? (hasConflict ? '#fb923c' : '#22c55e') : '#1e293b';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          app.interactiveTargets.push({
            kind: 'phaseMove',
            x: mx,
            y: my,
            r: 9,
            nodeKey: node.key,
            moveKey: mv.key,
          });
        }

        // Live GO / RED badges outside inbound approach edge
        for (const arm of arms) {
          if (arm.inN <= 0) continue;
          const lat = laneLat(arm, true, arm.inN - 1) + LANE_W * 1.45 + 14 / sc;
          const pt = armLanePoint(arm, dBox + 12, lat);
          const [bx, by] = S(pt[0], pt[1]);
          const liveGreen =
            livePhaseIdx >= 0 && phases[livePhaseIdx]
              ? phases[livePhaseIdx].allow.some(k => k.startsWith(arm.id + '>'))
              : !phases.length
                ? sim.green(J, Math.abs(arm.u[0]) > Math.abs(arm.u[1]) ? 0 : 1)
                : false;

          ctx.fillStyle = liveGreen ? '#16a34a' : '#dc2626';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.2;
          roundRect(ctx, bx - 16, by - 9, 32, 18, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 10px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(liveGreen ? 'GO' : 'RED', bx, by + 0.5);
        }
      }

      // Clickable Lane Turn Arrow chips (L / S / R) on selected junction (drawn inside approach lanes)
      if (isSelectedNode) {
        for (const arm of arms) {
          if (arm.inN <= 0) continue;
          const perms = lanePerms(J, arm.id, arm.inN);
          for (let li = 0; li < arm.inN; li++) {
            const lat = laneLat(arm, true, li);
            const pt = armLanePoint(arm, dBox + 8, lat);
            const [cx, cy] = S(pt[0], pt[1]);
            const moves = perms[li] || ['L', 'S', 'R'];

            // Three compact sub-buttons around lane center: L, S, R
            const offsets: Array<{ m: TurnMove; dx: number; dy: number; glyph: string }> = [
              { m: 'L', dx: -8, dy: 0, glyph: '↶' },
              { m: 'S', dx: 0, dy: -8, glyph: '↑' },
              { m: 'R', dx: 8, dy: 0, glyph: '↱' },
            ];

            // Rotate offset cleanly to match screen approach angle
            const rot = Math.atan2(-arm.u[1], arm.u[0]); // world y-up -> screen y-down
            ctx.beginPath();
            ctx.arc(cx, cy, 13, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(14,20,25,0.88)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,183,3,0.8)';
            ctx.lineWidth = 1.2;
            ctx.stroke();

            for (const o of offsets) {
              // Place along screen orthogonal/forward directions
              const ux = -arm.u[0];
              const uy = arm.u[1]; // inbound direction in screen coords
              const rx = -uy;
              const ry = ux;
              const ox = o.m === 'S' ? cx + ux * 5 : o.m === 'L' ? cx - rx * 6 : cx + rx * 6;
              const oy = o.m === 'S' ? cy + uy * 5 : o.m === 'L' ? cy - ry * 6 : cy + ry * 6;
              const active = moves.includes(o.m);
              void rot;

              ctx.beginPath();
              ctx.arc(ox, oy, 5.2, 0, Math.PI * 2);
              ctx.fillStyle = active ? '#ffb703' : '#26323d';
              ctx.fill();
              ctx.fillStyle = active ? '#111111' : '#93a6b6';
              ctx.font = '700 8px "JetBrains Mono", monospace';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(o.m, ox, oy + 0.5);

              app.interactiveTargets.push({
                kind: 'turn',
                x: ox,
                y: oy,
                r: 6.5,
                nodeKey: node.key,
                armId: arm.id,
                laneIdx: li,
                move: o.m,
              });
            }
          }
        }
      }

      // Clickable PRIO / YIELD / STOP badges placed cleanly outside road curb (drawn after lane arrows)
      if ((J.ctrl === 'yield' || J.ctrl === 'stop') && (isSelectedNode || app.wb)) {
        for (const arm of arms) {
          if (arm.inN <= 0) continue;
          const apprVal =
            (J.appr && J.appr[arm.id]) ||
            (J.major && String(J.major) === String(arm.road.id) ? 'prio' : J.ctrl === 'stop' ? 'stop' : 'yield');
          const lat = laneLat(arm, true, arm.inN - 1) + LANE_W * 1.45 + 16 / sc;
          const pt = armLanePoint(arm, dBox + 11, lat);
          const [bx, by] = S(pt[0], pt[1]);
          const bw = 40;
          const bh = 18;
          ctx.fillStyle = apprVal === 'prio' ? '#16a34a' : apprVal === 'stop' ? '#dc2626' : '#d97706';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.2;
          roundRect(ctx, bx - bw / 2, by - bh / 2, bw, bh, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 10px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(apprVal === 'prio' ? 'PRIO' : apprVal === 'stop' ? 'STOP' : 'YIELD', bx, by + 0.5);

          app.interactiveTargets.push({
            kind: 'appr',
            x: bx,
            y: by,
            w: bw,
            h: bh,
            nodeKey: node.key,
            armId: arm.id,
          });
        }
      }
    }

    // 2. Selected Road Overlay: - Lanes + chip & draggable vertices
    const roadXy = app.sel.road?._xy;
    if (app.sel.road && roadXy && roadXy.length >= 2) {
      const r = app.sel.road;
      const xy = roadXy;
      const midIdx = Math.floor((xy.length - 1) / 2);
      const A = xy[midIdx];
      const B = xy[midIdx + 1];
      const mx = (A[0] + B[0]) / 2;
      const my = (A[1] + B[1]) / 2;
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const l = Math.hypot(dx, dy) || 1;
      const nx = dy / l;
      const ny = -dx / l;

      const drawLaneChip = (side: 'fwd' | 'rev', count: number, offsetM: number) => {
        const [sx, sy] = S(mx + nx * offsetM, my + ny * offsetM);
        ctx.fillStyle = 'rgba(14,20,25,0.92)';
        ctx.strokeStyle = '#ffb703';
        ctx.lineWidth = 1.5;
        roundRect(ctx, sx - 28, sy - 11, 56, 22, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#e9eff4';
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`→${count}L`, sx, sy + 0.5);

        // minus & plus circles
        for (const delta of [-1, 1] as const) {
          const bx = sx + delta * 20;
          ctx.beginPath();
          ctx.arc(bx, sy, 8, 0, Math.PI * 2);
          ctx.fillStyle = delta === 1 ? '#ffb703' : '#26323d';
          ctx.fill();
          ctx.fillStyle = delta === 1 ? '#111111' : '#e9eff4';
          ctx.fillText(delta === 1 ? '+' : '−', bx, sy + 0.5);
          app.interactiveTargets.push({
            kind: 'roadLane',
            x: bx,
            y: sy,
            r: 10,
            road: r,
            side,
            delta,
          });
        }
      };

      if (r.dir !== 'rev') drawLaneChip('fwd', r.lanes, roadWidth(r) * 0.5 + 8);
      if (r.dir === 'both') drawLaneChip('rev', r.lanesR ?? r.lanes, -(roadWidth(r) * 0.5 + 8));

      // Draggable road vertices
      r.pts.forEach((pt, idx) => {
        const [wx, wy] = r._xy![idx];
        const [sx, sy] = S(wx, wy);
        ctx.beginPath();
        ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffb703';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#0e1419';
        ctx.stroke();
        app.interactiveTargets.push({
          kind: 'vertex',
          x: sx,
          y: sy,
          r: 9,
          nodeKey: Geo.key(pt),
          wx,
          wy,
        });
      });
    }

    // 3. Draggable vertices on Workbench Roundabout Rings & selected junctions
    if (app.wb) {
      const seenVerts = new Set<string>();
      for (const r of store.roads) {
        if (!r._xy) continue;
        const isRing = /roundabout/i.test(r.name);
        if (!isRing && r !== app.sel.road) continue;
        r.pts.forEach((pt, idx) => {
          const key = Geo.key(pt);
          if (seenVerts.has(key)) return;
          seenVerts.add(key);
          const [wx, wy] = r._xy![idx];
          const [sx, sy] = S(wx, wy);
          ctx.beginPath();
          ctx.arc(sx, sy, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#38bdf8';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#0e1419';
          ctx.stroke();
          app.interactiveTargets.push({
            kind: 'vertex',
            x: sx,
            y: sy,
            r: 9,
            nodeKey: key,
            wx,
            wy,
          });
        });
      }
      if (app.sel.node) {
        const n = app.sel.node;
        const [sx, sy] = S(n.x, n.y);
        app.interactiveTargets.push({
          kind: 'vertex',
          x: sx,
          y: sy,
          r: 11,
          nodeKey: n.key,
          wx: n.x,
          wy: n.y,
        });
      }
    }
  }

  // Hotspots with priority share readout & visual emphasis
  const sec = sim.clock.now(sim.T);
  const shares = sim.hotspotShares();
  for (const hot of store.hotspots) {
    const [X, Y] = S(hot.xy[0], hot.xy[1]);
    const R = Math.max(18, hot.radius * sc);
    const K = HOT_KINDS[hot.kind] || HOT_KINDS.other;
    const on = RuleSet.inWindow(hot, sec);
    const sel = app.sel.hot === hot;
    const prio = hot.priority ?? 50;
    const share = shares[hot.id] ?? 0;
    if (X < -R || Y < -R || X > W + R || Y > H + R) continue;
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, R);
    g.addColorStop(0, K.c + (on && prio > 0 ? '66' : '22'));
    g.addColorStop(1, K.c + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(X, Y, R, 0, 7);
    ctx.fill();
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = sel ? 2.5 : 1.3;
    ctx.strokeStyle = sel ? '#ffb703' : K.c;
    ctx.globalAlpha = on && prio > 0 ? 1 : 0.4;
    ctx.beginPath();
    ctx.arc(X, Y, R, 0, 7);
    ctx.stroke();
    ctx.setLineDash([]);
    const pinR = 9 + hot.weight * 0.45 + (prio / 100) * 4;
    ctx.beginPath();
    ctx.arc(X, Y, pinR, 0, 7);
    ctx.fillStyle = K.c;
    ctx.fill();
    ctx.lineWidth = sel ? 3 : 2;
    ctx.strokeStyle = sel ? '#ffb703' : pal.dot;
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hot.role === 'dest' ? '▼' : hot.role === 'origin' ? '▲' : '◆', X, Y + 0.5);
    ctx.globalAlpha = 1;
    const labelText = store.hotspots.length > 1 || prio !== 50 ? `${hot.name} (${Math.round(share)}%)` : hot.name;
    const tw = ctx.measureText(labelText).width;
    const ly = Y + pinR + 13;
    ctx.fillStyle = pal.bg === '#0e1419' ? 'rgba(14,20,25,0.85)' : 'rgba(255,255,255,0.88)';
    ctx.strokeStyle = sel ? '#ffb703' : K.c;
    ctx.lineWidth = 1;
    roundRect(ctx, X - tw / 2 - 6, ly - 9, tw + 12, 18, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pal.label;
    ctx.fillText(labelText, X, ly + 0.5);
  }

  // Vehicles
  const selV = app.sel.veh;
  let selPos: [number, number, number, NetEdge, Vehicle] | null = null;
  for (const e of net.edges) {
    if (!e.cnt) continue;
    const g = edgeGeom(e, sc);
    e.ln.forEach((q, l) => {
      for (const v of q) {
        const [X, Y] = vehicleScreen(view, e, v, l, g);
        if (X < -10 || Y < -10 || X > W + 10 || Y > H + 10) continue;
        const r = Math.max(3 + v.L * 0.18, Math.min(9, v.L * 0.55 * sc));
        ctx.beginPath();
        ctx.arc(X, Y, r, 0, 7);
        ctx.fillStyle = v.c;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.stroke();
        if (v === selV) selPos = [X, Y, r, e, v];
      }
    });
  }
  if (selPos && selV) {
    ctx.beginPath();
    ctx.arc(selPos[0], selPos[1], selPos[2] + 5, 0, 7);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffb703';
    ctx.stroke();
    const v = selV;
    ctx.beginPath();
    let first = true;
    for (let i = v.i; i < v.p.length; i++) {
      for (const [x, y] of v.p[i].xy) {
        const [X, Y] = S(x, y);
        if (first) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
        first = false;
      }
    }
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = '#ffb703';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  app.selPos = selPos;

  // Traffic-light heads when zoomed mid-level
  if (sc >= 0.3 && sc < 1.5) {
    for (const [k, J] of Object.entries(store.junctions)) {
      if (J.ctrl !== 'signal') continue;
      const n = net.byKey.get(k);
      if (!n) continue;
      const [X, Y] = S(n.x, n.y);
      const on = sim.ctl(n);
      ([0, 1] as const).forEach(g => {
        ctx.fillStyle = on ? (sim.green(J, g) ? '#38c172' : '#ff5c5c') : '#ffb703';
        ctx.beginPath();
        ctx.arc(X + (g ? 9 : -9), Y - 14, 4.5, 0, 7);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#000';
        ctx.stroke();
      });
    }
  }

  // Workbench area outline
  if (store.wb) {
    const [X, Y] = S(store.wb.c[0], store.wb.c[1]);
    ctx.beginPath();
    ctx.arc(X, Y, store.wb.R * sc, 0, 7);
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffb703';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Road being drawn
  if (app.tool === 'draw' && app.draft.length) {
    const pts = app.draft.map(d => d.xy).concat(app.hover ? [app.hover.xy] : []);
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const [X, Y] = S(x, y);
      if (i) ctx.lineTo(X, Y);
      else ctx.moveTo(X, Y);
    });
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffb703';
    ctx.stroke();
    ctx.setLineDash([]);
    for (const d of app.draft) {
      const [X, Y] = S(d.xy[0], d.xy[1]);
      ctx.beginPath();
      ctx.arc(X, Y, 4, 0, 7);
      ctx.fillStyle = '#ffb703';
      ctx.fill();
    }
  }
  if (app.tool === 'draw' && app.hover && app.hover.snap) {
    const [X, Y] = S(app.hover.xy[0], app.hover.xy[1]);
    ctx.beginPath();
    ctx.arc(X, Y, 8, 0, 7);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#38c172';
    ctx.stroke();
  }

  if (app.tool === 'delete' && app.hoverRoad && app.hoverRoad._xy && app.hoverRoad._bb && vis(app.hoverRoad._bb)) {
    const hr = app.hoverRoad;
    ctx.save();
    ctx.beginPath();
    hr._xy!.forEach(([x, y], i) => {
      const [X, Y] = S(x, y);
      if (i) ctx.lineTo(X, Y);
      else ctx.moveTo(X, Y);
    });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = wpx(hr) + 8;
    ctx.globalAlpha = 0.78;
    ctx.stroke();
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
