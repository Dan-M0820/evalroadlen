import { Geo } from '../engine/geo';
import { roadWidth, type NetNode, type Vehicle } from '../engine/network';
import { edgeGeom, vehicleScreen, type CanvasInteractiveTarget } from '../render/draw';
import type { RoadLensApp } from './appState';
import type { Hotspot, Road } from '../types';

type DragState =
  | { kind: 'pan'; x: number; y: number; lx: number; ly: number; moved: boolean }
  | { kind: 'hot'; x: number; y: number; lx: number; ly: number; moved: boolean; hot: Hotspot }
  | { kind: 'vertex'; x: number; y: number; lx: number; ly: number; moved: boolean; nodeKey: string; pushedUndo: boolean };

export function attachCanvasController(app: RoadLensApp, cv: HTMLCanvasElement): () => void {
  let drag: DragState | null = null;

  const hitInteractive = (px: number, py: number): CanvasInteractiveTarget | null => {
    for (let i = app.interactiveTargets.length - 1; i >= 0; i--) {
      const t = app.interactiveTargets[i];
      if (t.kind === 'appr') {
        if (Math.abs(px - t.x) <= t.w / 2 + 3 && Math.abs(py - t.y) <= t.h / 2 + 3) return t;
      } else {
        if (Math.hypot(px - t.x, py - t.y) <= t.r) return t;
      }
    }
    return null;
  };

  const hitVehicle = (px: number, py: number): Vehicle | null => {
    const { view, sim } = app;
    let best: Vehicle | null = null;
    let bd = 1e9;
    for (const e of sim.net.edges) {
      if (!e.cnt) continue;
      const g = edgeGeom(e, view.scale);
      e.ln.forEach((q, l) =>
        q.forEach(v => {
          const [X, Y] = vehicleScreen(view, e, v, l, g);
          const d = Math.hypot(X - px, Y - py);
          if (d < bd && d < 10) {
            bd = d;
            best = v;
          }
        })
      );
    }
    return best;
  };

  const hitHot = (px: number, py: number): Hotspot | null => {
    const { view, store } = app;
    let best: Hotspot | null = null;
    let bd = 1e9;
    for (const h of store.hotspots) {
      const [X, Y] = view.toScreen(h.xy[0], h.xy[1]);
      const d = Math.hypot(X - px, Y - py);
      if (d < 15 + h.weight * 0.6 && d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  };

  const hitNode = (px: number, py: number): NetNode | null => {
    const { view, sim, store } = app;
    let best: NetNode | null = null;
    let bd = 11;
    for (const n of sim.net.nodes) {
      const J = store.junctions[n.key];
      if (n.deg < 3 && !(J && J.ctrl !== 'free')) continue;
      const [X, Y] = view.toScreen(n.x, n.y);
      const d = Math.hypot(X - px, Y - py);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  };

  const hitRoad = (px: number, py: number): Road | null => {
    const { view, store } = app;
    const [wx, wy] = view.toWorld(px, py);
    const tol = 9 / view.scale;
    let best: Road | null = null;
    let bd = 1e9;
    for (const r of store.roads) {
      const b = r._bb;
      const xy = r._xy;
      if (!b || !xy) continue;
      const m = tol + roadWidth(r);
      if (wx < b[0] - m || wx > b[2] + m || wy < b[1] - m || wy > b[3] + m) continue;
      for (let i = 0; i < xy.length - 1; i++) {
        const d = segDist(wx, wy, xy[i], xy[i + 1]) - Math.min(roadWidth(r) / 2, tol);
        if (d < tol && d < bd) {
          bd = d;
          best = r;
        }
      }
    }
    return best;
  };

  const snap = (px: number, py: number) => {
    const { view, store } = app;
    const [wx, wy] = view.toWorld(px, py);
    const tol = 13 / view.scale;
    let best: { ll: [number, number]; xy: [number, number]; snap: boolean; ins: Road | null; road?: Road } | null = null;
    let bd = tol;
    for (const r of store.roads) {
      const b = r._bb;
      const xy = r._xy;
      if (!b || !xy) continue;
      if (wx < b[0] - tol || wx > b[2] + tol || wy < b[1] - tol || wy > b[3] + tol) continue;
      xy.forEach((q, i) => {
        const d = Math.hypot(q[0] - wx, q[1] - wy);
        if (d < bd) {
          bd = d;
          best = { ll: r.pts[i], xy: q, snap: true, ins: null, road: r };
        }
      });
      for (let i = 0; i < xy.length - 1; i++) {
        const A = xy[i];
        const B = xy[i + 1];
        const c = closest(wx, wy, A, B);
        const d = Math.hypot(c[0] - wx, c[1] - wy);
        if (d < bd - 0.5) {
          bd = d;
          best = {
            ll: Geo.ll(c[0], c[1]).map(v => Math.round(v * 1e6) / 1e6) as [number, number],
            xy: c,
            snap: true,
            ins: r,
            road: r,
          };
        }
      }
    }
    return (
      best || {
        ll: Geo.ll(wx, wy).map(v => Math.round(v * 1e6) / 1e6) as [number, number],
        xy: [wx, wy] as [number, number],
        snap: false,
        ins: null,
      }
    );
  };

  const handleClick = (px: number, py: number) => {
    if (app.tool === 'draw') {
      app.draft.push(snap(px, py));
      app.notify();
      return;
    }
    if (app.tool === 'point') {
      app.addControl(snap(px, py));
      return;
    }
    if (app.tool === 'split') {
      app.splitAt(snap(px, py));
      return;
    }
    if (app.tool === 'delete') {
      const r = hitRoad(px, py);
      if (r) app.deleteRoad(r);
      else app.status('Click directly on a road to delete it.');
      return;
    }

    // Check zoomed-in visual junction/road editor targets first
    const t = hitInteractive(px, py);
    if (t && t.kind !== 'vertex') {
      if (t.kind === 'turn') {
        app.toggleLaneMove(t.nodeKey, t.armId, t.laneIdx, t.move);
        return;
      }
      if (t.kind === 'appr') {
        app.cycleApproachPriority(t.nodeKey, t.armId);
        return;
      }
      if (t.kind === 'phaseMove') {
        app.togglePhaseMovement(t.nodeKey, t.moveKey);
        return;
      }
      if (t.kind === 'roadLane') {
        app.adjustRoadLanes(t.road, t.side, t.delta);
        return;
      }
    }

    const hot = hitHot(px, py);
    if (hot) {
      app.select({ hot });
      return;
    }
    if (app.tool === 'hotspot') {
      app.addHotspot(app.view.toWorld(px, py));
      return;
    }
    const v = hitVehicle(px, py);
    if (v) {
      app.select({ veh: v });
      return;
    }
    const n = hitNode(px, py);
    if (n) {
      app.select({ node: n });
      return;
    }
    app.select({ road: hitRoad(px, py) });
  };

  const onPointerDown = (e: PointerEvent) => {
    cv.setPointerCapture(e.pointerId);
    if (app.tool === 'select' || app.tool === 'hotspot') {
      const target = app.tool === 'select' ? hitInteractive(e.offsetX, e.offsetY) : null;
      if (target && target.kind === 'vertex') {
        drag = {
          kind: 'vertex',
          x: e.offsetX,
          y: e.offsetY,
          lx: e.offsetX,
          ly: e.offsetY,
          moved: false,
          nodeKey: target.nodeKey,
          pushedUndo: false,
        };
        return;
      }
      const hot = hitHot(e.offsetX, e.offsetY);
      if (hot) {
        drag = { kind: 'hot', x: e.offsetX, y: e.offsetY, lx: e.offsetX, ly: e.offsetY, moved: false, hot };
        return;
      }
    }
    drag = { kind: 'pan', x: e.offsetX, y: e.offsetY, lx: e.offsetX, ly: e.offsetY, moved: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (drag) {
      if (!drag.moved && Math.hypot(e.offsetX - drag.x, e.offsetY - drag.y) > 4) {
        drag.moved = true;
      }
      if (drag.moved) {
        if (drag.kind === 'hot') {
          app.store.moveHotspot(drag.hot, app.view.toWorld(e.offsetX, e.offsetY));
          app.select({ hot: drag.hot });
        } else if (drag.kind === 'vertex') {
          if (app.wb && !drag.pushedUndo) {
            app.store.pushUndo();
            drag.pushedUndo = true;
          }
          drag.nodeKey = app.store.moveNode(drag.nodeKey, app.view.toWorld(e.offsetX, e.offsetY));
        } else {
          app.view.pan(e.offsetX - drag.lx, e.offsetY - drag.ly);
          app.follow = false;
        }
        drag.lx = e.offsetX;
        drag.ly = e.offsetY;
        app.markDirty();
      }
      return;
    }
    if (app.tool === 'draw' || app.tool === 'point' || app.tool === 'split') {
      app.hover = snap(e.offsetX, e.offsetY);
      app.markDirty();
    } else if (app.tool === 'delete') {
      const hr = hitRoad(e.offsetX, e.offsetY);
      if (hr !== app.hoverRoad) {
        app.hoverRoad = hr;
        app.notifyUI();
      }
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.moved) {
      handleClick(e.offsetX, e.offsetY);
    } else if (d.kind === 'hot') {
      app.hotChanged();
    } else if (d.kind === 'vertex') {
      app.changed(app.sel.node ? d.nodeKey : undefined);
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    app.view.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0016));
    app.notify();
  };

  const onDblClick = () => app.finishDraw();

  const onKeyDown = (e: KeyboardEvent) => {
    const tag = document.activeElement?.tagName || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    if (e.key === 'Enter') app.finishDraw();
    else if (e.key === 'Escape') {
      app.cancelDraw();
      app.select({});
      if (app.tool !== 'select') app.setTool('select');
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && app.sel.road) {
      app.deleteRoad(app.sel.road);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && app.sel.hot) {
      app.deleteHotspot(app.sel.hot);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (app.wb) {
        e.preventDefault();
        if (e.shiftKey) app.redo();
        else app.undo();
      }
    }
  };

  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', onPointerUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('dblclick', onDblClick);
  window.addEventListener('keydown', onKeyDown);

  return () => {
    cv.removeEventListener('pointerdown', onPointerDown);
    cv.removeEventListener('pointermove', onPointerMove);
    cv.removeEventListener('pointerup', onPointerUp);
    cv.removeEventListener('wheel', onWheel);
    cv.removeEventListener('dblclick', onDblClick);
    window.removeEventListener('keydown', onKeyDown);
  };
}

function closest(px: number, py: number, A: [number, number], B: [number, number]): [number, number] {
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const t = Math.max(0, Math.min(1, ((px - A[0]) * dx + (py - A[1]) * dy) / (dx * dx + dy * dy || 1)));
  return [A[0] + t * dx, A[1] + t * dy];
}

function segDist(px: number, py: number, A: [number, number], B: [number, number]): number {
  const c = closest(px, py, A, B);
  return Math.hypot(px - c[0], py - c[1]);
}
