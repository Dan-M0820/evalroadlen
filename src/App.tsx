import { useEffect, useMemo, useRef, useState } from 'react';
import { drawScene, posAt } from './render/draw';
import { RoadLensApp } from './ui/appState';
import { attachCanvasController } from './ui/canvasController';
import { HeaderBar } from './components/HeaderBar';
import { WorkbenchBar } from './components/WorkbenchBar';
import { MapLayersSection } from './components/MapLayersSection';
import { ToolsSection } from './components/ToolsSection';
import { SelectedSection } from './components/SelectedSection';
import { HotspotsSection } from './components/HotspotsSection';
import { TrafficTimeSection } from './components/TrafficTimeSection';
import { DriverRulesEfficiencySection } from './components/DriverRulesEfficiencySection';

export default function App() {
  const app = useMemo(() => new RoadLensApp(), []);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setVersion] = useState(0);
  const [tickCount, setTickCount] = useState(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', app.theme);
    const unsub = app.subscribe(() => setVersion(v => v + 1));
    const unsubTick = app.subscribeTick(() => setTickCount(t => t + 1));
    return () => {
      unsub();
      unsubTick();
    };
  }, [app]);

  useEffect(() => {
    const cv = canvasRef.current;
    const stage = stageRef.current;
    if (!cv || !stage) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = stage.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.floor(r.width * dpr));
      cv.height = Math.max(1, Math.floor(r.height * dpr));
      cv.style.width = r.width + 'px';
      cv.style.height = r.height + 'px';
      app.view.W = r.width;
      app.view.H = r.height;
      app.markDirty();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    resize();

    const detachController = attachCanvasController(app, cv);
    (window as unknown as { app?: RoadLensApp }).app = app;
    app.boot();

    let fr = 0;
    let raf = 0;
    let timer = 0;
    let disposed = false;
    const loop = () => {
      if (disposed) return;
      const tFrame = performance.now();
      const sim = app.sim;
      const running = sim.run && !sim.busy;
      if (running) {
        for (let i = 0; i < app.speedMul; i++) sim.step(0.1);
      }
      const v = app.sel.veh;
      if (v && app.follow) {
        const e = v.p[v.i];
        if (e) {
          const p = posAt(e, v.s);
          app.view.cx += (p[0] - app.view.cx) * 0.2;
          app.view.cy += (p[1] - app.view.cy) * 0.2;
          app.dirty = true;
        }
      }
      if (running || app.dirty) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawScene(app, ctx);
        app.dirty = false;
      }
      if (running && ++fr % 15 === 0) {
        if (v && !v.p[v.i]?.ln.some(q => q.includes(v))) app.select({});
        app.notifyTick();
      }
      const dtFrame = performance.now() - tFrame;
      if (dtFrame > 16) {
        timer = window.setTimeout(() => {
          if (!disposed) raf = requestAnimationFrame(loop);
        }, Math.min(32, Math.round(dtFrame * 0.5)));
      } else {
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      ro.disconnect();
      detachController();
    };
  }, [app]);

  const sc = app.view.scale;
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const scaleM = steps.find(s => s * sc >= 70) || 5000;
  const zoomedInHint = sc >= 1.5 && (app.sel.node || app.sel.road || app.wb);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--bg)] text-[var(--tx)]">
      <HeaderBar app={app} clockText={app.sim.clock.fmt(app.sim.T)} avgR={app.sim.avgR} />

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <main ref={stageRef} className="flex-1 relative min-w-0 min-h-0 overflow-hidden">
          <canvas
            ref={canvasRef}
            id="map"
            className={`absolute inset-0 touch-none ${
              app.tool === 'select'
                ? 'cursor-grab active:cursor-grabbing'
                : app.tool === 'delete'
                  ? 'cursor-pointer'
                  : 'cursor-crosshair'
            }`}
          />

          <WorkbenchBar app={app} />

          {/* Zoom buttons */}
          <div className="absolute right-2.5 top-2.5 flex flex-col gap-1 z-10">
            <button
              type="button"
              onClick={() => {
                app.view.zoomAt(app.view.W / 2, app.view.H / 2, 1.5);
                app.notify();
              }}
              aria-label="Zoom in"
              className="w-8 h-8 rounded border border-[var(--ln)] bg-[var(--pn)] text-[var(--tx)] text-[17px] leading-none hover:border-[var(--ac)]"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => {
                app.view.zoomAt(app.view.W / 2, app.view.H / 2, 1 / 1.5);
                app.notify();
              }}
              aria-label="Zoom out"
              className="w-8 h-8 rounded border border-[var(--ln)] bg-[var(--pn)] text-[var(--tx)] text-[17px] leading-none hover:border-[var(--ac)]"
            >
              −
            </button>
          </div>

          {/* Congestion & Vehicle Legend */}
          <div className="hidden sm:block absolute left-2.5 bottom-9 rounded-lg border border-[var(--ln)] bg-[var(--pn)]/90 px-2.5 py-2 text-[11px] pointer-events-none">
            <div className="font-semibold text-[var(--tx)] mb-1">Congestion</div>
            <div className="space-y-0.5 text-[var(--mu)]">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-[#2ecc71]" /> free flow
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-[#f1c40f]" /> slowing
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-[#e74c3c]" /> jammed
              </div>
            </div>
            <div className="font-semibold text-[var(--tx)] mt-2 mb-1">Vehicles</div>
            <div className="space-y-0.5 text-[var(--mu)]">
              {app.store.vehicles.map(v => (
                <div key={v.k} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full border border-black/50"
                    style={{ background: v.c }}
                  />
                  {v.n}
                </div>
              ))}
            </div>
          </div>

          {/* Scale bar */}
          <div className="absolute left-2.5 bottom-2.5 flex items-center gap-1.5 text-[11px] font-mono-nums text-[var(--tx)] pointer-events-none">
            <div
              className="h-1.5 border-2 border-[var(--tx)] border-t-0"
              style={{ width: `${Math.max(16, scaleM * sc)}px` }}
            />
            <span>{scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`}</span>
          </div>

          {/* Zoomed-in visual editor hint */}
          {zoomedInHint && (
            <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-md border border-[var(--ln)] bg-[var(--pn)]/90 px-3 py-1 text-[11px] text-[var(--mu)] pointer-events-none whitespace-nowrap">
              Click lane arrows (L/S/R), approach badges, or phase curves · Drag handles to move
            </div>
          )}
        </main>

        <aside className="w-full md:w-[360px] max-h-[46vh] md:max-h-none overflow-auto px-3 py-1.5 pb-6 bg-[var(--pn)] border-t md:border-t-0 md:border-l border-[var(--ln)]">
          <MapLayersSection app={app} />
          <ToolsSection app={app} />
          <SelectedSection app={app} tickCount={tickCount} />
          <HotspotsSection app={app} />
          <TrafficTimeSection app={app} tickCount={tickCount} />
          <DriverRulesEfficiencySection app={app} />
        </aside>
      </div>
    </div>
  );
}
