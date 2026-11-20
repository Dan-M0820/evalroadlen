import React, { useEffect, useRef, useState } from 'react';
import { CONTROLS, HOT_KINDS, ROAD_TYPES, defaultControl } from '../config';
import { Analyze, type MeasureResult } from '../engine/analyze';
import {
  armsAt,
  autoPhases,
  boxDistance,
  lanePerms,
  movements,
  phaseConflicts,
} from '../engine/junction';
import { roadWidth } from '../engine/network';
import type { RoadLensApp } from '../ui/appState';
import type {
  ApproachPriority,
  ControlType,
  HotspotKindKey,
  HotspotRole,
  RoadDir,
  RoadTypeKey,
  TurnMove,
} from '../types';

interface Props {
  app: RoadLensApp;
  tickCount: number;
}

const los = (r: number): [string, string, string] =>
  r >= 0.85
    ? ['A', 'free flow', '#2ecc71']
    : r >= 0.7
      ? ['B', 'smooth', '#7bd36b']
      : r >= 0.55
        ? ['C', 'slowing', '#c9d44a']
        : r >= 0.4
          ? ['D', 'busy', '#f1c40f']
          : r >= 0.25
            ? ['E', 'near capacity', '#f39c12']
            : ['F', 'jammed', '#e74c3c'];

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

const ROWS: Array<[string, keyof MeasureResult, number]> = [
  ['Average speed (km/h)', 'speed', 1],
  ['Time stopped (%)', 'stopped', -1],
  ['Vehicles per hour', 'flow', 0],
  ['Time lost here (veh·min)', 'loss', -1],
  ['Trips finished (town)', 'trips', 1],
  ['Avg trip delay (town, s)', 'delay', -1],
];

const fm = (v: number | null) =>
  v == null ? '–' : Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);

export const SelectedSection: React.FC<Props> = ({ app, tickCount }) => {
  const { road, node, hot } = app.sel;
  const [wbRadius, setWbRadius] = useState(500);
  const [expMap, setExpMap] = useState<Record<string, { base?: MeasureResult; last?: MeasureResult }>>({});
  const [expBusy, setExpBusy] = useState(false);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<{ key: string | null; pts: Array<{ t: number; n: number; r: number; pass: number }> }>({
    key: null,
    pts: [],
  });

  const same = (r: typeof road) => (r ? app.store.roads.filter(x => x.name === r.name) : []);
  const targets = (r: NonNullable<typeof road>) => (app.applyAll ? same(r) : [r]);

  let focus: { key: string; ids: number[]; label: string } | null = null;
  if (road) {
    focus = {
      key: 'r' + road.id,
      ids: targets(road).map(r => r.id),
      label: app.applyAll && same(road).length > 1 ? 'all segments of this street' : 'this road',
    };
  } else if (node) {
    const ids = new Set<number>();
    node.in.concat(node.out).forEach(e => ids.add(e.road.id));
    focus = { key: 'n' + node.key, ids: [...ids], label: 'the roads at this junction' };
  } else if (hot) {
    const H = app.sim.hot.find(x => x.h === hot);
    const ids = new Set<number>();
    (H ? H.nodes : []).slice(0, 25).forEach(n => n.in.concat(n.out).forEach(e => ids.add(e.road.id)));
    focus = { key: 'h' + hot.id, ids: [...ids], label: 'the roads around this hotspot' };
  }

  // Record sparkline sample
  useEffect(() => {
    const hist = histRef.current;
    if (!focus) {
      hist.key = null;
      return;
    }
    if (hist.key !== focus.key) {
      hist.key = focus.key;
      hist.pts = [];
    }
    const last = hist.pts[hist.pts.length - 1];
    if (last && app.sim.T < last.t) hist.pts = [];
    else if (!last || app.sim.T - last.t >= 10) {
      const sn = app.sim.snapshot(focus.ids);
      hist.pts.push({ t: app.sim.T, n: sn.n, r: sn.ratio, pass: sn.pass });
      if (hist.pts.length > 180) hist.pts.shift();
    }

    const cv = sparkRef.current;
    if (!cv) return;
    const c = cv.getContext('2d');
    if (!c) return;
    const W = cv.width;
    const H = cv.height;
    const p = hist.pts;
    c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(128,140,150,0.35)';
    c.lineWidth = 1;
    for (const y of [0.25, 0.5, 0.75]) {
      c.beginPath();
      c.moveTo(0, H * y);
      c.lineTo(W, H * y);
      c.stroke();
    }
    if (p.length < 2) {
      c.fillStyle = '#93a6b6';
      c.font = '11px system-ui';
      c.fillText('collecting…', 8, 16);
      return;
    }
    const mx = Math.max(5, ...p.map(q => q.n));
    const X = (i: number) => (i / 179) * W;
    const off = 180 - p.length;
    const drawLine = (fn: (q: (typeof p)[number]) => number, col: string) => {
      c.beginPath();
      p.forEach((q, i) => {
        const x = X(i + off);
        const y = fn(q);
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.strokeStyle = col;
      c.lineWidth = 2;
      c.stroke();
    };
    drawLine(q => 4 + (1 - q.n / mx) * (H - 8), '#4cc9f0');
    drawLine(q => 4 + (1 - q.r) * (H - 8), '#ffb703');
  }, [tickCount, focus?.key]);

  const title = road
    ? 'Selected: road'
    : node
      ? 'Selected: junction / control'
      : hot
        ? 'Selected: hotspot'
        : 'Selected';

  const snap = focus ? app.sim.snapshot(focus.ids) : null;
  const [L, losName, losCol] = snap ? los(snap.ratio) : ['A', 'free flow', '#2ecc71'];
  const histPts = histRef.current.pts;
  let flowText = '';
  if (histPts.length > 1) {
    const a = histPts.find(x => x.t >= histPts[histPts.length - 1].t - 600) || histPts[0];
    const b = histPts[histPts.length - 1];
    if (b.t - a.t >= 60) {
      flowText = ` · flow ${Math.round((Math.max(0, b.pass - a.pass) / (b.t - a.t)) * 3600)} veh/h`;
    }
  }

  const runExp = async () => {
    if (!focus) return;
    setExpBusy(true);
    const res = await Analyze.measure(app.sim, focus.ids);
    app.rebuild();
    setExpMap(prev => {
      const cur = prev[focus!.key] || {};
      return { ...prev, [focus!.key]: !cur.base ? { base: res } : { ...cur, last: res } };
    });
    setExpBusy(false);
  };

  return (
    <details open className="border-b border-[var(--ln)] py-2">
      <summary className="cursor-pointer font-bold text-[13px] select-none text-[var(--tx)]">{title}</summary>
      <div className="mt-2 space-y-2.5">
        {!road && !node && !hot && (
          <p className="text-[12px] text-[var(--mu)] m-0">
            Click a road, junction dot, or hotspot pin on the map to edit it and see what traffic does there.
          </p>
        )}

        {(road || node) && (
          <button
            type="button"
            onClick={() => app.zoomInSelected()}
            className="px-2.5 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]"
          >
            ⤢ Zoom in (metres)
          </button>
        )}

        {/* ---------- Selected Road ---------- */}
        {road && (
          <div className="space-y-2">
            <label className="block text-[12px] text-[var(--mu)]">
              Name
              <input
                type="text"
                value={road.name}
                onChange={e => {
                  road.name = e.target.value;
                  app.persist();
                  app.notify();
                }}
                className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)]"
              />
            </label>

            <div className="grid grid-cols-2 gap-1.5">
              <label className="block text-[12px] text-[var(--mu)]">
                Type
                <select
                  value={road.type}
                  onChange={e => {
                    if (app.wb) app.store.pushUndo();
                    const d = ROAD_TYPES[e.target.value as RoadTypeKey];
                    for (const x of targets(road)) {
                      x.type = e.target.value as RoadTypeKey;
                      x.lanes = d.lanes;
                      x.speed = d.speed;
                    }
                    app.changed();
                  }}
                  className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)]"
                >
                  {Object.entries(ROAD_TYPES).map(([k, t]) => (
                    <option key={k} value={k}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-[12px] text-[var(--mu)]">
                Speed limit (km/h)
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={road.speed}
                  onChange={e => {
                    if (app.wb) app.store.pushUndo();
                    const sp = clamp(+e.target.value || 30, 5, 100);
                    for (const x of targets(road)) x.speed = sp;
                    app.changed();
                  }}
                  className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)] font-mono-nums"
                />
              </label>
            </div>

            <div className="rounded border border-[var(--ln)] bg-[var(--bg)] p-2 space-y-1.5">
              <div className="text-[12px] font-semibold text-[var(--tx)]">Lanes per side</div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--mu)]">
                  {road.dir === 'rev' ? 'Reverse (end → start)' : 'Forward (start → end)'}
                </span>
                <div className="flex items-center gap-1.5 font-mono-nums">
                  <button
                    type="button"
                    onClick={() => app.adjustRoadLanes(road, 'fwd', -1)}
                    className="w-6 h-6 rounded border border-[var(--ln)] bg-[var(--pn)] text-[var(--tx)] hover:border-[var(--ac)]"
                  >
                    −
                  </button>
                  <span className="w-4 text-center text-[var(--tx)]">{road.lanes}</span>
                  <button
                    type="button"
                    onClick={() => app.adjustRoadLanes(road, 'fwd', 1)}
                    className="w-6 h-6 rounded border border-[var(--ln)] bg-[var(--pn)] text-[var(--tx)] hover:border-[var(--ac)]"
                  >
                    +
                  </button>
                </div>
              </div>
              {road.dir === 'both' && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[var(--mu)]">Opposite (end → start)</span>
                  <div className="flex items-center gap-1.5 font-mono-nums">
                    <button
                      type="button"
                      onClick={() => app.adjustRoadLanes(road, 'rev', -1)}
                      className="w-6 h-6 rounded border border-[var(--ln)] bg-[var(--pn)] text-[var(--tx)] hover:border-[var(--ac)]"
                    >
                      −
                    </button>
                    <span className="w-4 text-center text-[var(--tx)]">{road.lanesR ?? road.lanes}</span>
                    <button
                      type="button"
                      onClick={() => app.adjustRoadLanes(road, 'rev', 1)}
                      className="w-6 h-6 rounded border border-[var(--ln)] bg-[var(--pn)] text-[var(--tx)] hover:border-[var(--ac)]"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
            </div>

            <label className="block text-[12px] text-[var(--mu)]">
              Flow direction
              <select
                value={road.dir}
                onChange={e => {
                  if (app.wb) app.store.pushUndo();
                  for (const x of targets(road)) x.dir = e.target.value as RoadDir;
                  app.changed();
                }}
                className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)]"
              >
                <option value="both">Two-way</option>
                <option value="fwd">One-way: start → end</option>
                <option value="rev">One-way: end → start</option>
              </select>
            </label>

            <label className="block text-[12px] text-[var(--mu)]">
              <div className="flex justify-between">
                <span>Side friction (parking, stalls, pedestrians)</span>
                <span className="font-mono-nums text-[var(--tx)] font-semibold">
                  {Math.round((road.friction || 0) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((road.friction || 0) * 100)}
                onChange={e => {
                  const val = clamp(+e.target.value / 100, 0, 1);
                  for (const x of targets(road)) x.friction = val;
                  app.changed();
                }}
                className="w-full mt-1"
              />
            </label>

            <div>
              <div className="text-[12px] font-semibold text-[var(--tx)] mb-1">Vehicles allowed</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                {app.store.vehicles.map(y => {
                  const allowed = !(road.banned || []).includes(y.k);
                  return (
                    <label key={y.k} className="flex items-center gap-1.5 cursor-pointer text-[var(--tx)]">
                      <input
                        type="checkbox"
                        checked={allowed}
                        onChange={e => {
                          if (app.wb) app.store.pushUndo();
                          for (const x of targets(road)) {
                            const set = new Set(x.banned || []);
                            if (e.target.checked) set.delete(y.k);
                            else set.add(y.k);
                            x.banned = [...set];
                          }
                          app.changed();
                        }}
                      />
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full border border-black/50"
                        style={{ background: y.c }}
                      />
                      {y.n}
                    </label>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 text-[12px] text-[var(--tx)] cursor-pointer">
              <input
                type="checkbox"
                checked={!!road.closed}
                onChange={e => {
                  if (app.wb) app.store.pushUndo();
                  for (const x of targets(road)) x.closed = e.target.checked;
                  app.changed();
                }}
              />
              Road closed (no traffic, shown dashed red)
            </label>

            {same(road).length > 1 && (
              <label className="flex items-center gap-2 text-[12px] text-[var(--tx)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={app.applyAll}
                  onChange={e => {
                    app.applyAll = e.target.checked;
                    app.notify();
                  }}
                />
                Apply to all {same(road).length} segments named “{road.name}”
              </label>
            )}

            <div className="text-[12px] text-[var(--mu)] font-mono-nums">
              Width {roadWidth(road).toFixed(1)} m · Length {Math.round(app.store.length(road))} m
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (app.wb) app.store.pushUndo();
                  for (const x of targets(road)) {
                    if (x.dir === 'fwd') x.dir = 'rev';
                    else if (x.dir === 'rev') x.dir = 'fwd';
                  }
                  app.changed();
                }}
                className="px-2.5 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]"
              >
                Reverse flow
              </button>
              <button
                type="button"
                onClick={() => app.setTool('split')}
                className="px-2.5 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]"
              >
                Split road…
              </button>
              <button
                type="button"
                onClick={() => app.deleteRoad(road)}
                className="px-2.5 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[#ef4444] hover:border-[#ef4444]"
              >
                Delete road
              </button>
            </div>
          </div>
        )}

        {/* ---------- Selected Junction ---------- */}
        {node && (() => {
          const J = app.store.junctions[node.key] || defaultControl('free');
          const arms = armsAt(app.store.roads, node.key);
          const mvs = movements(arms);
          const dBox = arms.length ? boxDistance(arms) : 10;
          const ensureJ = () => {
            const cur = app.store.junctions[node.key] || defaultControl('free');
            app.store.junctions[node.key] = cur;
            return cur;
          };

          const inRoadNames = new Map<number, string>();
          const outRoadNames = new Map<number, string>();
          node.in.forEach(e => inRoadNames.set(e.road.id, e.road.name));
          node.out.forEach(e => outRoadNames.set(e.road.id, e.road.name));
          const turnPairs: Array<[string, string]> = [];
          inRoadNames.forEach((a, i) =>
            outRoadNames.forEach((b, o) => {
              if (i !== o) turnPairs.push([`${i}>${o}`, `${a} → ${b}`]);
            })
          );

          const phases = J.phases || [];
          const activeIdx = Math.min(app.editPhaseIdx, Math.max(0, phases.length - 1));
          const activePhase = phases[activeIdx];
          const conflicts =
            J.ctrl === 'signal' && activePhase && arms.length >= 2
              ? phaseConflicts(activePhase.allow, mvs, arms, dBox)
              : [];
          const liveIdx = J.ctrl === 'signal' ? app.sim.phaseNow(J) : -1;

          return (
            <div className="space-y-2.5">
              <label className="block text-[12px] text-[var(--mu)]">
                Control
                <select
                  value={J.ctrl}
                  onChange={e => {
                    if (app.wb) app.store.pushUndo();
                    const cur = ensureJ();
                    cur.ctrl = e.target.value as ControlType;
                    if (cur.ctrl === 'signal' && (!cur.phases || !cur.phases.length) && mvs.length) {
                      cur.phases = autoPhases(arms, mvs, cur.gA || 20, cur.allRed ?? 3);
                    }
                    app.junctionChanged();
                  }}
                  className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--tx)]"
                >
                  {Object.entries(CONTROLS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>

              {/* Approach Priority (for yield/stop) */}
              {(J.ctrl === 'yield' || J.ctrl === 'stop') && arms.some(a => a.inN > 0) && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-semibold text-[var(--tx)]">Approach priority</span>
                    <span className="text-[11px] text-[var(--mu)]">Click badges on map or here</span>
                  </div>
                  <div className="space-y-1">
                    {arms
                      .filter(a => a.inN > 0)
                      .map(arm => {
                        const val: ApproachPriority =
                          (J.appr && J.appr[arm.id]) ||
                          (J.major && String(J.major) === String(arm.road.id)
                            ? 'prio'
                            : J.ctrl === 'stop'
                              ? 'stop'
                              : 'yield');
                        return (
                          <div
                            key={arm.id}
                            className="flex items-center justify-between gap-2 rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1.5"
                          >
                            <span className="text-[12px] text-[var(--tx)] truncate">{arm.road.name}</span>
                            <div className="flex gap-1 shrink-0">
                              {(['prio', 'yield', 'stop'] as ApproachPriority[]).map(opt => {
                                const on = val === opt;
                                const bg =
                                  opt === 'prio'
                                    ? 'bg-[#16a34a] text-white'
                                    : opt === 'stop'
                                      ? 'bg-[#dc2626] text-white'
                                      : 'bg-[#d97706] text-white';
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => app.cycleApproachPriority(node.key, arm.id, opt)}
                                    className={`px-1.5 py-0.5 text-[11px] rounded ${
                                      on ? bg + ' font-semibold' : 'text-[var(--mu)] hover:text-[var(--tx)]'
                                    }`}
                                  >
                                    {opt === 'prio' ? 'Priority' : opt === 'stop' ? 'Stop' : 'Yield'}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Lane Turns */}
              {arms.some(a => a.inN > 0) && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-semibold text-[var(--tx)]">Lane turns</span>
                    <span className="text-[11px] text-[var(--mu)]">Click lane arrows on map</span>
                  </div>
                  <div className="space-y-1.5">
                    {arms
                      .filter(a => a.inN > 0)
                      .map(arm => {
                        const perms = lanePerms(J, arm.id, arm.inN);
                        return (
                          <div key={arm.id} className="rounded border border-[var(--ln)] bg-[var(--bg)] p-2 space-y-1">
                            <div className="text-[11px] text-[var(--mu)]">
                              {arm.road.name} ({arm.inN} inbound)
                            </div>
                            {perms.map((moves, li) => (
                              <div key={li} className="flex items-center justify-between text-[12px]">
                                <span className="text-[var(--tx)] font-mono-nums">Lane {li + 1}</span>
                                <div className="flex gap-1">
                                  {(['L', 'S', 'R'] as TurnMove[]).map(m => {
                                    const on = moves.includes(m);
                                    return (
                                      <button
                                        key={m}
                                        type="button"
                                        onClick={() => app.toggleLaneMove(node.key, arm.id, li, m)}
                                        className={`w-6 h-6 rounded text-[12px] font-bold ${
                                          on
                                            ? 'bg-[var(--ac)] text-[#111]'
                                            : 'bg-[var(--pn)] border border-[var(--ln)] text-[var(--mu)]'
                                        }`}
                                        title={m === 'L' ? 'Left turn' : m === 'S' ? 'Straight' : 'Right turn'}
                                      >
                                        {m === 'L' ? '↶' : m === 'S' ? '↑' : '↱'}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Signal Phases */}
              {J.ctrl === 'signal' && (
                <div className="space-y-2 rounded border border-[var(--ln)] bg-[var(--bg)] p-2">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-semibold text-[var(--tx)]">Signal phases</span>
                    <span className="font-mono-nums text-[11px] text-[#22c55e]">
                      {liveIdx >= 0 ? `Live: Phase ${liveIdx + 1}` : 'Live: All-red'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {phases.map((_, pi) => (
                      <button
                        key={pi}
                        type="button"
                        onClick={() => {
                          app.editPhaseIdx = pi;
                          app.notify();
                        }}
                        className={`px-2 py-1 text-[11px] rounded font-mono-nums ${
                          pi === activeIdx
                            ? 'bg-[var(--ac)] text-[#111] font-bold'
                            : 'bg-[var(--pn)] border border-[var(--ln)] text-[var(--tx)]'
                        }`}
                      >
                        {liveIdx === pi ? '● ' : ''}P{pi + 1}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        if (app.wb) app.store.pushUndo();
                        const cur = ensureJ();
                        cur.phases = [...(cur.phases || []), { dur: 15, clear: 3, allow: [] }];
                        app.editPhaseIdx = cur.phases.length - 1;
                        app.junctionChanged();
                      }}
                      className="px-2 py-1 text-[11px] rounded border border-[var(--ln)] bg-[var(--pn)] text-[var(--tx)] hover:border-[var(--ac)]"
                      title="Add phase"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (app.wb) app.store.pushUndo();
                        const cur = ensureJ();
                        cur.phases = autoPhases(arms, mvs, 20, 3);
                        app.editPhaseIdx = 0;
                        app.junctionChanged();
                      }}
                      className="px-2 py-1 text-[11px] rounded border border-[var(--ln)] bg-[var(--pn)] text-[var(--tx)] hover:border-[var(--ac)]"
                      title="Auto-generate phases"
                    >
                      ↻
                    </button>
                  </div>

                  {activePhase && (
                    <>
                      <div className="grid grid-cols-3 gap-1.5 text-[11px] text-[var(--mu)]">
                        <label>
                          Green (s)
                          <input
                            type="number"
                            min={3}
                            value={activePhase.dur}
                            onChange={e => {
                              activePhase.dur = Math.max(3, +e.target.value || 15);
                              app.junctionChanged();
                            }}
                            className="mt-0.5 w-full rounded border border-[var(--ln)] bg-[var(--pn)] px-1.5 py-1 text-[12px] text-[var(--tx)] font-mono-nums"
                          />
                        </label>
                        <label>
                          All-red (s)
                          <input
                            type="number"
                            min={0}
                            value={activePhase.clear}
                            onChange={e => {
                              activePhase.clear = Math.max(0, +e.target.value || 0);
                              app.junctionChanged();
                            }}
                            className="mt-0.5 w-full rounded border border-[var(--ln)] bg-[var(--pn)] px-1.5 py-1 text-[12px] text-[var(--tx)] font-mono-nums"
                          />
                        </label>
                        <label>
                          Offset (s)
                          <input
                            type="number"
                            min={0}
                            value={J.offset || 0}
                            onChange={e => {
                              ensureJ().offset = Math.max(0, +e.target.value || 0);
                              app.junctionChanged();
                            }}
                            className="mt-0.5 w-full rounded border border-[var(--ln)] bg-[var(--pn)] px-1.5 py-1 text-[12px] text-[var(--tx)] font-mono-nums"
                          />
                        </label>
                      </div>

                      {conflicts.length > 0 && (
                        <div className="rounded border border-[#d97706] bg-[#d97706]/10 px-2 py-1.5 text-[11px] text-[#ffb703]">
                          ⚠ {conflicts.length} crossing conflict(s) in Phase {activeIdx + 1}: left turns yield to opposing traffic.
                        </div>
                      )}

                      <div className="text-[11px] text-[var(--mu)]">Green movements (click curves on map or toggle):</div>
                      <div className="max-h-32 overflow-auto space-y-1">
                        {mvs.map(mv => {
                          const armA = arms.find(a => a.id === mv.a);
                          const armB = arms.find(a => a.id === mv.b);
                          const on = activePhase.allow.includes(mv.key);
                          return (
                            <label
                              key={mv.key}
                              className="flex items-center justify-between gap-2 text-[11px] text-[var(--tx)] cursor-pointer"
                            >
                              <span className="flex items-center gap-1.5 truncate">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() => app.togglePhaseMovement(node.key, mv.key)}
                                />
                                {armA?.road.name} → {armB?.road.name}
                              </span>
                              <span className="font-mono-nums text-[var(--mu)]">{mv.type}</span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {J.ctrl === 'crossing' && (
                <div className="grid grid-cols-2 gap-1.5 text-[12px] text-[var(--mu)]">
                  <label>
                    Pedestrians every (s)
                    <input
                      type="number"
                      min={10}
                      value={J.every ?? 40}
                      onChange={e => {
                        ensureJ().every = Math.max(10, +e.target.value || 40);
                        app.junctionChanged();
                      }}
                      className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[var(--tx)] font-mono-nums"
                    />
                  </label>
                  <label>
                    Crossing lasts (s)
                    <input
                      type="number"
                      min={2}
                      value={J.dur ?? 8}
                      onChange={e => {
                        ensureJ().dur = Math.max(2, +e.target.value || 8);
                        app.junctionChanged();
                      }}
                      className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[var(--tx)] font-mono-nums"
                    />
                  </label>
                </div>
              )}

              {J.ctrl !== 'free' && (
                <div className="grid grid-cols-2 gap-1.5 text-[12px] text-[var(--mu)]">
                  <label>
                    Discharge gap (s, 0=auto)
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={J.dh || 0}
                      onChange={e => {
                        ensureJ().dh = Math.max(0, +e.target.value || 0);
                        app.junctionChanged();
                      }}
                      className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[var(--tx)] font-mono-nums"
                    />
                  </label>
                  <div>
                    <span>Active hours</span>
                    <div className="flex gap-1 mt-1">
                      <input
                        type="time"
                        value={J.from || ''}
                        onChange={e => {
                          ensureJ().from = e.target.value;
                          app.junctionChanged();
                        }}
                        className="w-1/2 rounded border border-[var(--ln)] bg-[var(--bg)] px-1 py-1 text-[11px] text-[var(--tx)]"
                      />
                      <input
                        type="time"
                        value={J.to || ''}
                        onChange={e => {
                          ensureJ().to = e.target.value;
                          app.junctionChanged();
                        }}
                        className="w-1/2 rounded border border-[var(--ln)] bg-[var(--bg)] px-1 py-1 text-[11px] text-[var(--tx)]"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="text-[12px] font-semibold text-[var(--tx)] mb-1">Banned turns</div>
                <div className="max-h-28 overflow-auto space-y-1">
                  {turnPairs.slice(0, 16).map(([id, label]) => (
                    <label key={id} className="flex items-center gap-1.5 text-[11px] text-[var(--tx)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(J.bans || []).includes(id)}
                        onChange={e => {
                          const cur = ensureJ();
                          cur.bans = cur.bans || [];
                          if (e.target.checked && !cur.bans.includes(id)) cur.bans.push(id);
                          if (!e.target.checked) cur.bans = cur.bans.filter(x => x !== id);
                          app.junctionChanged();
                        }}
                      />
                      {label}
                    </label>
                  ))}
                  {turnPairs.length === 0 && <span className="text-[11px] text-[var(--mu)]">No turns here.</span>}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {app.wb && (
                  <button
                    type="button"
                    onClick={() => app.insertTemplate('roundabout')}
                    className="px-2.5 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]"
                  >
                    Convert to roundabout
                  </button>
                )}
                {app.store.junctions[node.key] && (
                  <button
                    type="button"
                    onClick={() => {
                      if (app.wb) app.store.pushUndo();
                      delete app.store.junctions[node.key];
                      app.changed(node.key);
                    }}
                    className="px-2.5 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[#ef4444] hover:border-[#ef4444]"
                  >
                    Remove control
                  </button>
                )}
              </div>

              <div>
                <div className="text-[12px] font-semibold text-[var(--tx)] mb-1">Queues at this junction</div>
                <div className="space-y-1">
                  {node.in.map((e, idx) => {
                    let q = 0;
                    let c = 0;
                    for (const ln of e.ln) {
                      for (const v of ln) {
                        c++;
                        if (v.v < 1 && v.s > e.len - 80) q++;
                      }
                    }
                    return (
                      <div
                        key={e.id + '-' + idx}
                        className="flex items-center justify-between rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[11px]"
                      >
                        <span className="text-[var(--tx)] truncate">{e.road.name}</span>
                        <span className="font-mono-nums text-[var(--mu)] shrink-0">
                          {q} waiting · {c} total
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ---------- Selected Hotspot ---------- */}
        {hot && (() => {
          const shares = app.sim.hotspotShares();
          const share = shares[hot.id] ?? 0;
          const st = app.sim.hstat[hot.id];
          const H = app.sim.hot.find(x => x.h === hot);
          const active = app.sim.hotAct.some(x => x.h === hot);
          const prio = hot.priority ?? 50;

          return (
            <div className="space-y-2">
              <label className="block text-[12px] text-[var(--mu)]">
                Name
                <input
                  type="text"
                  value={hot.name}
                  onChange={e => {
                    hot.name = e.target.value;
                    app.hotChanged();
                  }}
                  className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)]"
                />
              </label>

              <label className="block text-[12px] text-[var(--mu)]">
                Kind
                <select
                  value={hot.kind}
                  onChange={e => {
                    hot.kind = e.target.value as HotspotKindKey;
                    const def = HOT_KINDS[hot.kind];
                    if (def) {
                      hot.priority = def.priority;
                      hot.weight = def.weight;
                      hot.role = def.role;
                      hot.from = def.from;
                      hot.to = def.to;
                    }
                    app.hotChanged();
                  }}
                  className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)]"
                >
                  {Object.entries(HOT_KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.n}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-[12px] text-[var(--mu)]">
                What it does
                <select
                  value={hot.role}
                  onChange={e => {
                    hot.role = e.target.value as HotspotRole;
                    app.hotChanged();
                  }}
                  className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)]"
                >
                  <option value="dest">Attracts trips (people travel TO it)</option>
                  <option value="origin">Generates trips (people leave FROM it)</option>
                  <option value="both">Both directions</option>
                </select>
              </label>

              <div className="rounded border border-[var(--ac)]/50 bg-[var(--bg)] p-2 space-y-1">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-[var(--tx)]">Prioritize (trip share)</span>
                  <span className="font-mono-nums font-bold text-[var(--ac)]">
                    {prio}% · {Math.round(share)}% of hotspot trips
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={prio}
                  aria-label="Selected hotspot priority"
                  onChange={e => {
                    hot.priority = +e.target.value;
                    app.hotChanged();
                  }}
                  className="w-full"
                />
                <p className="text-[11px] text-[var(--mu)] m-0">
                  Adjust where most people go (e.g. turn School or Out of town up, Hospital down to 10–20% on ordinary days).
                </p>
              </div>

              <label className="block text-[12px] text-[var(--mu)]">
                <div className="flex justify-between">
                  <span>Strength (extra trip pull)</span>
                  <span className="font-mono-nums text-[var(--tx)] font-semibold">{hot.weight} / 10</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={hot.weight}
                  onChange={e => {
                    hot.weight = clamp(+e.target.value || 1, 1, 10);
                    app.hotChanged();
                  }}
                  className="w-full mt-1"
                />
              </label>

              <div className="grid grid-cols-2 gap-1.5 text-[12px] text-[var(--mu)]">
                <label>
                  Reach (m)
                  <input
                    type="number"
                    min={30}
                    max={800}
                    value={hot.radius}
                    onChange={e => {
                      hot.radius = clamp(+e.target.value || 150, 30, 800);
                      app.hotChanged();
                    }}
                    className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[var(--tx)] font-mono-nums"
                  />
                </label>
                <div>
                  <span>Active hours</span>
                  <div className="flex gap-1 mt-1">
                    <input
                      type="time"
                      value={hot.from}
                      onChange={e => {
                        hot.from = e.target.value;
                        app.hotChanged();
                      }}
                      className="w-1/2 rounded border border-[var(--ln)] bg-[var(--bg)] px-1 py-1 text-[11px] text-[var(--tx)]"
                    />
                    <input
                      type="time"
                      value={hot.to}
                      onChange={e => {
                        hot.to = e.target.value;
                        app.hotChanged();
                      }}
                      className="w-1/2 rounded border border-[var(--ln)] bg-[var(--bg)] px-1 py-1 text-[11px] text-[var(--tx)]"
                    />
                  </div>
                </div>
              </div>

              <div className="text-[12px] text-[var(--mu)] font-mono-nums">
                <span className={active ? 'text-[#22c55e] font-semibold' : 'text-[var(--tx)] font-semibold'}>
                  {active ? 'Active now' : 'Outside active hours'}
                </span>{' '}
                · {H ? H.nodes.length : 0} access points
                <br />
                Trips started: <b className="text-[var(--tx)]">{st ? st.started : 0}</b> · finished:{' '}
                <b className="text-[var(--tx)]">{st ? st.n : 0}</b>
                {st && st.n ? ` · avg delay ${Math.round(st.dsum / st.n)} s` : ''}
              </div>

              <button
                type="button"
                onClick={() => app.deleteHotspot(hot)}
                className="px-2.5 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[#ef4444] hover:border-[#ef4444]"
              >
                Remove hotspot
              </button>
            </div>
          );
        })()}

        {/* ---------- Live Telemetry + Sparkline ---------- */}
        {focus && snap && (
          <div className="pt-2 border-t border-[var(--ln)] space-y-1.5">
            <div className="text-[12px] font-semibold text-[var(--tx)]">Live on {focus.label}</div>
            {snap.n > 0 ? (
              <div className="text-[12px] text-[var(--mu)] space-y-0.5 font-mono-nums">
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block min-w-[20px] text-center font-bold text-[#111] rounded px-1"
                    style={{ background: losCol }}
                  >
                    {L}
                  </span>
                  <span className="font-semibold text-[var(--tx)]">{losName}</span>
                </div>
                <div>
                  <b className="text-[var(--tx)]">{snap.n}</b> veh · avg{' '}
                  <b className="text-[var(--tx)]">{Math.round(snap.speed)}</b> km/h (limit{' '}
                  {Math.round(snap.limit)}) · stopped <b className="text-[var(--tx)]">{snap.stopped}</b>
                  {flowText}
                </div>
                <div className="text-[11px]">
                  {Object.entries(snap.byType)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' · ')}
                </div>
              </div>
            ) : (
              <div className="text-[12px] text-[var(--mu)]">
                No vehicles right now{road && road.closed ? ' (road is closed)' : ''}.
              </div>
            )}
            <canvas ref={sparkRef} width={300} height={80} className="w-full h-20 rounded bg-[var(--bg)]" />
            <div className="text-[11px] text-[var(--mu)]">
              <span className="text-[#ffb703]">━</span> speed vs free flow &nbsp;{' '}
              <span className="text-[#4cc9f0]">━</span> vehicles (last 30 min)
            </div>
          </div>
        )}

        {/* ---------- Edit in Workbench ---------- */}
        {!app.wb && (road || node || hot) && (
          <div className="pt-2 border-t border-[var(--ln)] space-y-1.5">
            <div className="text-[12px] font-semibold text-[var(--tx)]">Edit in a workbench</div>
            <p className="text-[11px] text-[var(--mu)] m-0">
              Opens a separate local copy. Edits and tests stay isolated until you press Apply.
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12px] text-[var(--mu)]">
                Radius
                <select
                  value={wbRadius}
                  onChange={e => setWbRadius(+e.target.value)}
                  className="rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)]"
                >
                  <option value={300}>300 m</option>
                  <option value={500}>500 m</option>
                  <option value={800}>800 m</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => app.enterWorkbench(wbRadius)}
                className="flex-1 rounded bg-[var(--ac)] px-2.5 py-1.5 text-[12px] font-semibold text-[#111] hover:brightness-110"
              >
                Open workbench
              </button>
            </div>
          </div>
        )}

        {/* ---------- Before / After Experiment ---------- */}
        {focus && (() => {
          const E = expMap[focus.key] || {};
          return (
            <div className="pt-2 border-t border-[var(--ln)] space-y-1.5">
              <div className="text-[12px] font-semibold text-[var(--tx)]">Test what your change does</div>
              <p className="text-[11px] text-[var(--mu)] m-0">
                Runs 10 simulated minutes of identical traffic to compare before vs. after.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={expBusy}
                  onClick={runExp}
                  className="px-2.5 py-1 text-[12px] rounded bg-[var(--ac)] text-[#111] font-semibold disabled:opacity-50"
                >
                  {expBusy ? 'Running 10 min…' : E.base ? 'Run test again' : 'Run baseline test'}
                </button>
                {E.last && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpMap(prev => ({
                        ...prev,
                        [focus!.key]: { base: E.last },
                      }))
                    }
                    className="px-2 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)]"
                  >
                    Use as baseline
                  </button>
                )}
                {E.base && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpMap(prev => {
                        const copy = { ...prev };
                        delete copy[focus!.key];
                        return copy;
                      })
                    }
                    className="px-2 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--mu)]"
                  >
                    Reset
                  </button>
                )}
              </div>
              {E.base && (
                <table className="w-full text-[11px] border-collapse font-mono-nums mt-1">
                  <thead>
                    <tr className="border-b border-[var(--ln)] text-[var(--mu)]">
                      <th className="text-left py-1">Metric</th>
                      <th className="text-right py-1">Base</th>
                      {E.last && (
                        <>
                          <th className="text-right py-1">Now</th>
                          <th className="text-right py-1">Change</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map(([lbl, k, good]) => {
                      const a = E.base![k];
                      const b = E.last ? E.last[k] : null;
                      let chText = '–';
                      let chCol = 'var(--mu)';
                      if (E.last && a != null && b != null) {
                        const d = b - a;
                        const pc = a ? (d / Math.abs(a)) * 100 : 0;
                        const better = good === 0 ? null : d * good > 0;
                        chCol =
                          Math.abs(pc) < 3 || better == null
                            ? 'var(--mu)'
                            : better
                              ? '#22c55e'
                              : '#ef4444';
                        chText = `${d > 0 ? '+' : ''}${fm(d)} (${pc > 0 ? '+' : ''}${Math.round(pc)}%)`;
                      }
                      return (
                        <tr key={String(k)} className="border-b border-[var(--ln)]/50">
                          <td className="py-1 text-[var(--tx)] font-sans">{lbl}</td>
                          <td className="py-1 text-right text-[var(--tx)]">{fm(a)}</td>
                          {E.last && (
                            <>
                              <td className="py-1 text-right text-[var(--tx)]">{fm(b)}</td>
                              <td className="py-1 text-right" style={{ color: chCol }}>
                                {chText}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })()}
      </div>
    </details>
  );
};
