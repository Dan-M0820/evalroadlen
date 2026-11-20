import React, { useEffect, useRef } from 'react';
import { DAY_TYPES } from '../config';
import type { RoadLensApp } from '../ui/appState';
import type { DayTypeKey } from '../types';

interface Props {
  app: RoadLensApp;
  tickCount: number;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export const TrafficTimeSection: React.FC<Props> = ({ app, tickCount }) => {
  const demRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);

  const drawDem = () => {
    const cv = demRef.current;
    if (!cv) return;
    const dx = cv.getContext('2d');
    if (!dx) return;
    dx.clearRect(0, 0, 280, 70);
    const w = 280 / 24;
    const h = Math.floor(app.sim.clock.hour(app.sim.T));
    app.store.demand.forEach((v, i) => {
      dx.fillStyle = i === h ? '#ffb703' : '#4cc9f0';
      dx.fillRect(i * w + 1, 70 - v * 66, w - 2, v * 66);
    });
  };

  useEffect(() => {
    drawDem();
  }, [tickCount, app.store.demand]);

  const setDemandAt = (clientX: number, clientY: number) => {
    const cv = demRef.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const i = clamp(Math.floor(((clientX - r.left) / r.width) * 24), 0, 23);
    app.store.demand[i] = Math.round(clamp((r.bottom - clientY) / r.height, 0, 1) * 20) / 20;
    drawDem();
  };

  const mins = Math.floor(app.sim.clock.now(app.sim.T) / 900) * 15;
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');

  return (
    <details open className="border-b border-[var(--ln)] py-2">
      <summary className="cursor-pointer font-bold text-[13px] select-none text-[var(--tx)]">Traffic and time</summary>
      <div className="mt-2 space-y-2">
        <label className="block text-[12px] text-[var(--mu)]">
          Day type
          <select
            value={app.store.day}
            onChange={e => {
              app.store.day = e.target.value as DayTypeKey;
              app.persist();
              app.notify();
            }}
            className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)]"
          >
            {Object.entries(DAY_TYPES).map(([k, d]) => (
              <option key={k} value={k}>
                {d.n}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-[12px] text-[var(--mu)]">
          <div className="flex justify-between">
            <span>Time of day</span>
            <span className="font-mono-nums text-[var(--tx)] font-semibold">
              {hh}:{mm}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1439}
            step={15}
            value={mins}
            onChange={e => {
              app.sim.clock.start = +e.target.value * 60 - app.sim.T;
              app.rebuild();
            }}
            className="w-full mt-1"
          />
        </label>

        <div>
          <canvas
            ref={demRef}
            width={280}
            height={70}
            onPointerDown={e => {
              draggingRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDemandAt(e.clientX, e.clientY);
            }}
            onPointerMove={e => {
              if (draggingRef.current) setDemandAt(e.clientX, e.clientY);
            }}
            onPointerUp={() => {
              draggingRef.current = false;
              app.persist();
            }}
            className="w-full h-[70px] rounded bg-[var(--bg)] touch-none cursor-crosshair"
          />
          <p className="text-[11px] text-[var(--mu)] m-0 mt-1">Drag bars to set hourly demand.</p>
        </div>

        <label className="block text-[12px] text-[var(--mu)]">
          <div className="flex justify-between">
            <span>Overall traffic</span>
            <span className="font-mono-nums text-[var(--tx)] font-semibold">{app.sim.params.load}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={app.sim.params.load}
            onChange={e => {
              app.sim.params.load = +e.target.value;
              app.notify();
            }}
            className="w-full mt-1"
          />
        </label>

        <div>
          <div className="text-[12px] font-semibold text-[var(--tx)] mb-1">Vehicle mix</div>
          <div className="space-y-1">
            {app.store.vehicles.map(y => (
              <div key={y.k} className="grid grid-cols-[110px_1fr_28px] items-center gap-1.5 text-[12px]">
                <span className="flex items-center gap-1.5 truncate text-[var(--tx)]">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-black/50"
                    style={{ background: y.c }}
                  />
                  {y.n}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={y.w}
                  onChange={e => {
                    y.w = +e.target.value;
                    app.persist();
                    app.notify();
                  }}
                />
                <span className="font-mono-nums text-[11px] text-[var(--mu)] text-right">{y.w}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              app.sim.run = !app.sim.run;
              app.notify();
            }}
            className={`px-3 py-1 text-[12px] rounded font-semibold ${
              app.sim.run
                ? 'bg-[var(--ac)] text-[#111]'
                : 'border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)]'
            }`}
          >
            {app.sim.run ? 'Pause' : 'Play'}
          </button>
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--mu)]">
            Speed
            <select
              value={app.speedMul}
              onChange={e => {
                app.speedMul = +e.target.value;
                app.notify();
              }}
              className="rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)] font-mono-nums"
            >
              {[1, 2, 4, 8, 16, 32].map(s => (
                <option key={s} value={s}>
                  ×{s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="text-[11px] text-[var(--mu)] font-mono-nums">
          {app.store.roads.length} roads · {app.store.buildings.length} buildings · {app.sim.nv} vehicles
        </div>
      </div>
    </details>
  );
};
