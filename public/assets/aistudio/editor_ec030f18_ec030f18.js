import { Geo } from '../engine/geo.js';
import { roadWidth } from '../engine/network.js';
import { edgeGeom, vehicleScreen } from '../render/draw.js';

// Mouse / touch on the map: pan, zoom, select (road, junction, vehicle) and draw new roads.
export class Editor {
  constructor(app, cv) {
    this.app = app; this.cv = cv; this.drag = null;
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); const hot = ['select', 'hotspot'].includes(app.tool) ? this.hitHot(e.offsetX, e.offsetY) : null; this.drag = { x: e.offsetX, y: e.offsetY, lx: e.offsetX, ly: e.offsetY, moved: false, hot }; });
    cv.addEventListener('pointermove', e => this.move(e));
    cv.addEventListener('pointerup', e => { const d = this.drag; this.drag = null; if (!d) return; if (!d.moved) this.click(e.offsetX, e.offsetY); else if (d.hot) app.hotChanged(); });
    cv.addEventListener('wheel', e => { e.preventDefault(); app.view.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * .0016)); }, { passive: false });
    cv.addEventListener('dblclick', () => app.finishDraw());
    addEventListener('keydown', e => {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'Enter') app.finishDraw(); else if (e.key === 'Escape') { app.cancelDraw(); app.select({}); if (app.tool !== 'select') app.setTool('select'); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && app.sel.road) app.deleteRoad(app.sel.road);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && app.sel.hot) app.deleteHotspot(app.sel.hot);
    });
  }

  move(e) {
    const d = this.drag, app = this.app;
    if (d) {
      if (!d.moved && Math.hypot(e.offsetX - d.x, e.offsetY - d.y) > 4) d.moved = true;
      if (d.moved) { if (d.hot) { app.store.moveHotspot(d.hot, app.view.toWorld(e.offsetX, e.offsetY)); app.select({ hot: d.hot }); } else { app.view.pan(e.offsetX - d.lx, e.offsetY - d.ly); app.follow = false; } d.lx = e.offsetX; d.ly = e.offsetY; }
      return;
    }
    if (['draw', 'point', 'split'].includes(app.tool)) app.hover = this.snap(e.offsetX, e.offsetY);
  }

  click(px, py) {
    const app = this.app;
    if (app.tool === 'draw') { const s = this.snap(px, py); app.draft.push(s); app.emit('hint'); return; }
    if (app.tool === 'point') { app.addControl(this.snap(px, py)); return; }
    if (app.tool === 'split') { app.splitAt(this.snap(px, py)); return; }
    const hot = this.hitHot(px, py); if (hot) { app.select({ hot }); return; }
    if (app.tool === 'hotspot') { app.addHotspot(this.app.view.toWorld(px, py)); return; }
    const v = this.hitVehicle(px, py); if (v) { app.select({ veh: v }); return; }
    const n = this.hitNode(px, py); if (n) { app.select({ node: n }); return; }
    app.select({ road: this.hitRoad(px, py) });
  }

  hitVehicle(px, py) {
    const { view, sim } = this.app; let best = null, bd = 1e9;
    for (const e of sim.net.edges) { if (!e.cnt) continue; const g = edgeGeom(e, view.scale);
      e.ln.forEach((q, l) => q.forEach(v => { const [X, Y] = vehicleScreen(view, e, v, l, g), d = Math.hypot(X - px, Y - py); if (d < bd && d < 10) { bd = d; best = v; } })); }
    return best;
  }
  hitHot(px, py) {
    const { view, store } = this.app; let best = null, bd = 1e9;
    for (const h of store.hotspots) { const [X, Y] = view.toScreen(h.xy[0], h.xy[1]), d = Math.hypot(X - px, Y - py); if (d < 14 + h.weight * .6 && d < bd) { bd = d; best = h; } }
    return best;
  }
  hitNode(px, py) {
    const { view, sim, store } = this.app; let best = null, bd = 11;
    for (const n of sim.net.nodes) { const J = store.junctions[n.key]; if (n.deg < 3 && !(J && J.ctrl !== 'free')) continue; const [X, Y] = view.toScreen(n.x, n.y), d = Math.hypot(X - px, Y - py); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  hitRoad(px, py) {
    const { view, store } = this.app, [wx, wy] = view.toWorld(px, py), tol = 9 / view.scale; let best = null, bd = 1e9;
    for (const r of store.roads) {
      const b = r._bb, m = tol + roadWidth(r); if (wx < b[0] - m || wx > b[2] + m || wy < b[1] - m || wy > b[3] + m) continue;
      for (let i = 0; i < r._xy.length - 1; i++) { const d = segDist(wx, wy, r._xy[i], r._xy[i + 1]) - Math.min(roadWidth(r) / 2, tol); if (d < tol && d < bd) { bd = d; best = r; } }
    }
    return best;
  }

  // Snap to an existing road point (so roads join at junctions) or to the nearest spot on a road (adds a junction there).
  snap(px, py) {
    const { view, store } = this.app, [wx, wy] = view.toWorld(px, py), tol = 13 / view.scale; let best = null, bd = tol;
    for (const r of store.roads) {
      const b = r._bb; if (wx < b[0] - tol || wx > b[2] + tol || wy < b[1] - tol || wy > b[3] + tol) continue;
      r._xy.forEach((q, i) => { const d = Math.hypot(q[0] - wx, q[1] - wy); if (d < bd) { bd = d; best = { ll: r.pts[i], xy: q, snap: true, ins: null, road: r }; } });
      for (let i = 0; i < r._xy.length - 1; i++) { const A = r._xy[i], B = r._xy[i + 1], c = closest(wx, wy, A, B), d = Math.hypot(c[0] - wx, c[1] - wy);
        if (d < bd - .5) { bd = d; best = { ll: Geo.ll(c[0], c[1]).map(v => Math.round(v * 1e6) / 1e6), xy: c, snap: true, ins: r, road: r }; } }
    }
    return best || { ll: Geo.ll(wx, wy).map(v => Math.round(v * 1e6) / 1e6), xy: [wx, wy], snap: false, ins: null };
  }
}

function closest(px, py, A, B) { const dx = B[0] - A[0], dy = B[1] - A[1], t = Math.max(0, Math.min(1, ((px - A[0]) * dx + (py - A[1]) * dy) / (dx * dx + dy * dy || 1))); return [A[0] + t * dx, A[1] + t * dy]; }
function segDist(px, py, A, B) { const c = closest(px, py, A, B); return Math.hypot(px - c[0], py - c[1]); }
