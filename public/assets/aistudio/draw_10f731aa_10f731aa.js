import { ROAD_TYPES, HEAT, HOT_KINDS, CTRL_COLOR } from '../config.js';
import { RuleSet } from '../engine/rules.js';
import { roadWidth } from '../engine/network.js';

const PAL = {
  dark:  { bg: '#10171c', bld: '#35444f', casing: '#04070a', road: '#56636e', label: '#e9eff4', halo: '#0a0f13', sel: '#ffffff', dot: '#0a0f13' },
  light: { bg: '#e9ece6', bld: '#cbc4b4', casing: '#6f7a82', road: '#fbfbfb', label: '#16212b', halo: '#ffffff', sel: '#111111', dot: '#222222' }
};
export const palette = () => matchMedia('(prefers-color-scheme: light)').matches ? PAL.light : PAL.dark;

// congestion score 1 (free) .. 0 (jam) -> green / yellow / red
const HEAT_TABLE = Array.from({ length: 25 }, (_, i) => { const t = i / 24; const h = t < .5 ? HEAT.red + (HEAT.yellow - HEAT.red) * t * 2 : HEAT.yellow + (HEAT.green - HEAT.yellow) * (t - .5) * 2; return `hsl(${h},85%,48%)`; });
export const heatColor = r => HEAT_TABLE[Math.round(Math.max(0, Math.min(1, (r - .2) / .65)) * 24)];

// How a road is laid out on screen (pixels): total width, width of one direction's stripe, and its centre offset to the right.
export function edgeGeom(e, sc) {
  const r = e.road, W = Math.max(ROAD_TYPES[r.type].minPx, roadWidth(r) * sc), both = r.dir === 'both';
  return { W, stripe: both ? W / 2 : W, off: both ? W / 4 : 0 };
}
// point at distance s along an edge, plus unit heading
export function posAt(e, s) {
  const xy = e.xy, cum = e.cum; let i = 0; while (i < xy.length - 2 && cum[i + 1] < s) i++;
  const A = xy[i], B = xy[i + 1], sl = cum[i + 1] - cum[i] || 1, t = Math.max(0, Math.min(1, (s - cum[i]) / sl)), ux = (B[0] - A[0]) / sl, uy = (B[1] - A[1]) / sl;
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, ux, uy];
}
// screen position of a vehicle (lane offset in pixels so dots stay inside their stripe at any zoom)
export function vehicleScreen(view, e, v, lane, g) {
  const p = posAt(e, v.s), [sx, sy] = view.toScreen(p[0], p[1]), lat = g.off + (lane + .5 - e.lanes / 2) * g.stripe / e.lanes;
  return [sx + lat * p[3], sy + lat * p[2]];
}

export function drawScene(app, ctx) {
  const { view, store, sim, layers, pal } = app, net = sim.net, sc = view.scale, W = view.W, H = view.H;
  const vx0 = view.cx - W / 2 / sc - 40, vx1 = view.cx + W / 2 / sc + 40, vy0 = view.cy - H / 2 / sc - 40, vy1 = view.cy + H / 2 / sc + 40;
  const vis = b => !(b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1);
  const S = (x, y) => view.toScreen(x, y), H2 = () => view.H;
  ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);

  // buildings = small squares
  if (layers.buildings && store.bxy && sc >= .05) {
    const s = Math.max(2, 9 * sc), b = store.bxy; ctx.fillStyle = pal.bld;
    for (let i = 0; i < b.length; i += 2) { const x = b[i], y = b[i + 1]; if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue; ctx.fillRect((x - view.cx) * sc + W / 2 - s / 2, -(y - view.cy) * sc + H / 2 - s / 2, s, s); }
  }

  // roads: outline pass, then fill pass (so junctions merge cleanly)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const paths = new Map(), order = app.roadOrder;
  for (const r of order) { if (!vis(r._bb)) continue; const p = new Path2D(); r._xy.forEach(([x, y], i) => { const [X, Y] = S(x, y); i ? p.lineTo(X, Y) : p.moveTo(X, Y); }); paths.set(r, p); }
  const wpx = r => Math.max(ROAD_TYPES[r.type].minPx, roadWidth(r) * sc);
  if (app.sel.road) { const p = paths.get(app.sel.road); if (p) { ctx.strokeStyle = pal.sel; ctx.lineWidth = wpx(app.sel.road) + 9; ctx.globalAlpha = .9; ctx.stroke(p); ctx.globalAlpha = 1; } }
  ctx.strokeStyle = pal.casing; for (const [r, p] of paths) { ctx.lineWidth = wpx(r) + 2; ctx.stroke(p); }
  for (const [r, p] of paths) { ctx.strokeStyle = layers.mode === 'type' ? ROAD_TYPES[r.type].color : pal.road; ctx.lineWidth = wpx(r); ctx.stroke(p); }

  for (const [r, p] of paths) if (r.closed) { ctx.setLineDash([7, 7]); ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = Math.max(2, wpx(r) * .5); ctx.stroke(p); ctx.setLineDash([]); }

  // congestion: each direction of travel is coloured on its own side of the road
  const needArrows = e => e.road.dir !== 'both' ? sc >= .1 : layers.arrows;
  ctx.lineCap = 'butt';
  const edgePath = (e, off) => { const p = new Path2D(); e.xy.forEach(([x, y], i) => { const [X, Y] = S(x, y), n = e.nrm[i]; const px = X + off * n[0], py = Y - off * n[1]; i ? p.lineTo(px, py) : p.moveTo(px, py); }); return p; };
  const visEdges = net.edges.filter(e => paths.has(e.road));
  if (layers.mode === 'heat') for (const e of visEdges) { const g = edgeGeom(e, sc); ctx.strokeStyle = heatColor(e.r); ctx.lineWidth = Math.max(1.6, g.stripe * .82); ctx.stroke(edgePath(e, g.off)); }

  // flow arrows
  ctx.lineCap = 'round';
  for (const e of visEdges) {
    if (!needArrows(e) && e.road !== app.sel.road) continue;
    const g = edgeGeom(e, sc), P = e.xy.map(([x, y], i) => { const [X, Y] = S(x, y), n = e.nrm[i]; return [X + g.off * n[0], Y - g.off * n[1]]; });
    const sz = Math.max(2.6, Math.min(6, g.stripe * .42)); let acc = 22;
    for (let i = 0; i < P.length - 1; i++) {
      const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dy); if (l < 1) continue; const ux = dx / l, uy = dy / l; let t = acc;
      for (; t < l; t += 64) { const cx = P[i][0] + ux * t, cy = P[i][1] + uy * t; ctx.beginPath(); ctx.moveTo(cx + ux * sz, cy + uy * sz); ctx.lineTo(cx - ux * sz - uy * sz * .8, cy - uy * sz + ux * sz * .8); ctx.lineTo(cx - ux * sz + uy * sz * .8, cy - uy * sz - ux * sz * .8); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = .8; ctx.stroke(); }
      acc = t - l;
    }
  }

  // street names
  if (layers.labels && sc >= .22) {
    ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; let n = 0;
    for (const [r] of paths) { if (n > 120 || r.name.startsWith(ROAD_TYPES[r.type].label)) continue; const m = r._xy; if (m.length < 2) continue;
      const i = Math.floor((m.length - 1) / 2), [ax, ay] = S(m[i][0], m[i][1]), [bx, by] = S(m[i + 1][0], m[i + 1][1]), l = Math.hypot(bx - ax, by - ay); if (l < ctx.measureText(r.name).width + 12) continue;
      let ang = Math.atan2(by - ay, bx - ax); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      ctx.save(); ctx.translate((ax + bx) / 2, (ay + by) / 2); ctx.rotate(ang); ctx.lineWidth = 3; ctx.strokeStyle = pal.halo; ctx.strokeText(r.name, 0, 0); ctx.fillStyle = pal.label; ctx.fillText(r.name, 0, 0); ctx.restore(); n++; }
  }

  // junction and control dots (white = plain junction; coloured = a control is set; also on the middle of a road)
  if (layers.junctions && sc >= .1) for (const n of net.nodes) {
    const J = store.junctions[n.key], ctl = J && J.ctrl !== 'free', sel = app.sel.node === n;
    if ((n.deg < 3 && !ctl && !sel) || n.x < vx0 || n.x > vx1 || n.y < vy0 || n.y > vy1) continue;
    const [X, Y] = S(n.x, n.y); ctx.beginPath(); ctx.arc(X, Y, sel ? 9 : Math.max(3.5, Math.min(6.5, 3 + sc * 3)) + (ctl ? 1 : 0), 0, 7);
    ctx.fillStyle = CTRL_COLOR[J ? J.ctrl : 'free'] || '#fff'; ctx.fill(); ctx.lineWidth = sel ? 3 : 1.5; ctx.strokeStyle = sel ? '#ffb703' : pal.dot; ctx.stroke();
    if (J && J.ctrl === 'crossing' && sc >= .25) { ctx.fillStyle = '#000'; ctx.fillRect(X - 3, Y - 1, 6, 2); }
  }

  // hotspots: pinned trip generators with their reach
  const sec = sim.clock.now(sim.T);
  for (const H of store.hotspots) {
    const [X, Y] = S(H.xy[0], H.xy[1]), R = Math.max(18, H.radius * sc), K = HOT_KINDS[H.kind] || HOT_KINDS.other, on = RuleSet.inWindow(H, sec), sel = app.sel.hot === H;
    if (X < -R || Y < -R || X > W + R || Y > H2() + R) continue;
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, R); g.addColorStop(0, K.c + (on ? '66' : '22')); g.addColorStop(1, K.c + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill();
    ctx.setLineDash([5, 5]); ctx.lineWidth = sel ? 2.5 : 1.3; ctx.strokeStyle = sel ? '#ffb703' : K.c; ctx.globalAlpha = on ? 1 : .45; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(X, Y, 10 + H.weight * .6, 0, 7); ctx.fillStyle = K.c; ctx.fill(); ctx.lineWidth = sel ? 3 : 2; ctx.strokeStyle = sel ? '#ffb703' : pal.dot; ctx.stroke();
    ctx.fillStyle = '#111'; ctx.font = '700 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(H.role === 'dest' ? '▼' : H.role === 'origin' ? '▲' : '◆', X, Y + .5);
    ctx.globalAlpha = 1; ctx.lineWidth = 3; ctx.strokeStyle = pal.halo; ctx.strokeText(H.name, X, Y + 22 + H.weight * .5); ctx.fillStyle = pal.label; ctx.fillText(H.name, X, Y + 22 + H.weight * .5);
  }

  // vehicles = dots, colour = vehicle type
  const selV = app.sel.veh; let selPos = null;
  for (const e of net.edges) {
    if (!e.cnt) continue; const g = edgeGeom(e, sc);
    e.ln.forEach((q, l) => { for (const v of q) {
      const [X, Y] = vehicleScreen(view, e, v, l, g); if (X < -10 || Y < -10 || X > W + 10 || Y > H + 10) continue;
      const r = Math.max(3 + v.L * .18, Math.min(9, v.L * .55 * sc));
      ctx.beginPath(); ctx.arc(X, Y, r, 0, 7); ctx.fillStyle = v.c; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.stroke();
      if (v === selV) selPos = [X, Y, r, e, v];
    } });
  }
  if (selPos) { ctx.beginPath(); ctx.arc(selPos[0], selPos[1], selPos[2] + 5, 0, 7); ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffb703'; ctx.stroke();
    // show the rest of the planned route
    const v = selV; ctx.beginPath(); let first = true;
    for (let i = v.i; i < v.p.length; i++) for (const [x, y] of v.p[i].xy) { const [X, Y] = S(x, y); first ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); first = false; }
    ctx.setLineDash([2, 6]); ctx.strokeStyle = '#ffb703'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]); }
  app.selPos = selPos;

  // traffic-light heads
  if (sc >= .3) for (const [k, J] of Object.entries(store.junctions)) {
    if (J.ctrl !== 'signal') continue; const n = net.byKey.get(k); if (!n) continue; const [X, Y] = S(n.x, n.y), on = sim.ctl(n);
    [0, 1].forEach(g => { ctx.fillStyle = on ? (sim.green(J, g) ? '#38c172' : '#ff5c5c') : '#ffb703'; ctx.beginPath(); ctx.arc(X + (g ? 9 : -9), Y - 14, 4.5, 0, 7); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.stroke(); });
  }

  // workbench area outline
  if (store.wb) { const [X, Y] = S(store.wb.c[0], store.wb.c[1]); ctx.beginPath(); ctx.arc(X, Y, store.wb.R * sc, 0, 7); ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.strokeStyle = '#ffb703'; ctx.stroke(); ctx.setLineDash([]); }

  // road being drawn
  if (app.tool === 'draw' && app.draft.length) {
    const pts = app.draft.map(d => d.xy).concat(app.hover ? [app.hover.xy] : []); ctx.beginPath(); pts.forEach(([x, y], i) => { const [X, Y] = S(x, y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.setLineDash([7, 6]); ctx.lineWidth = 3; ctx.strokeStyle = '#ffb703'; ctx.stroke(); ctx.setLineDash([]);
    for (const d of app.draft) { const [X, Y] = S(d.xy[0], d.xy[1]); ctx.beginPath(); ctx.arc(X, Y, 4, 0, 7); ctx.fillStyle = '#ffb703'; ctx.fill(); }
  }
  if (app.tool === 'draw' && app.hover && app.hover.snap) { const [X, Y] = S(app.hover.xy[0], app.hover.xy[1]); ctx.beginPath(); ctx.arc(X, Y, 8, 0, 7); ctx.lineWidth = 2.5; ctx.strokeStyle = '#38c172'; ctx.stroke(); }
}
