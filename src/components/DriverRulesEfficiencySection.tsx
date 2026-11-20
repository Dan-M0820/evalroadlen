import React, { useState } from 'react';
import { DEFAULT_VEHICLES, ROAD_TYPES } from '../config';
import { Analyze } from '../engine/analyze';
import type { RoadLensApp } from '../ui/appState';
import type { VehicleType } from '../types';

interface Props {
  app: RoadLensApp;
}

const FIELDS: Array<[keyof VehicleType, string, number]> = [
  ['tau', 'Following gap (s)', 0.1],
  ['f', 'Speed vs limit ×', 0.05],
  ['acc', 'Acceleration m/s²', 0.1],
  ['aggr', 'Aggressiveness 0–1', 0.05],
  ['avoid', 'Avoids jams 0–1', 0.05],
  ['spread', 'Driver variety 0–1', 0.05],
  ['dwellP', 'Stops per km', 0.1],
  ['dwell', 'Stop time (s)', 1],
  ['L', 'Length (m)', 0.5],
];

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export const DriverRulesEfficiencySection: React.FC<Props> = ({ app }) => {
  const [rv, setRv] = useState('all');
  const [rr, setRr] = useState('all');
  const [ra, setRa] = useState<'ban' | 'cap'>('ban');
  const [rval, setRval] = useState(20);
  const [rf, setRf] = useState('06:00');
  const [rt, setRt] = useState('20:00');
  const [suggText, setSuggText] = useState('');
  const [canApplySugg, setCanApplySugg] = useState(false);

  const roadName = (x: string | number) =>
    x === 'all'
      ? 'any road'
      : String(x).startsWith('type:')
        ? 'all ' + ROAD_TYPES[String(x).slice(5) as keyof typeof ROAD_TYPES].label.toLowerCase() + 's'
        : (app.store.roads.find(r => String(r.id) === String(x)) || { name: 'a deleted road' }).name;

  const worst = app.sim.worstRoads(6);
  const veh = app.sel.veh;

  return (
    <>
      <details className="border-b border-[var(--ln)] py-2">
        <summary className="cursor-pointer font-bold text-[13px] select-none text-[var(--tx)]">
          Driver tendencies
        </summary>
        <div className="mt-2 space-y-2">
          {app.store.vehicles.map(y => (
            <div key={y.k} className="rounded border border-[var(--ln)] bg-[var(--bg)] p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={y.c}
                  onChange={e => {
                    y.c = e.target.value;
                    app.persist();
                    app.notify();
                  }}
                  className="w-7 h-7 rounded border border-[var(--ln)] bg-transparent p-0"
                />
                <input
                  type="text"
                  value={y.n}
                  onChange={e => {
                    y.n = e.target.value;
                    app.persist();
                    app.notify();
                  }}
                  className="flex-1 rounded border border-[var(--ln)] bg-[var(--pn)] px-2 py-1 text-[12px] font-semibold text-[var(--tx)]"
                />
                {app.store.vehicles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      app.store.vehicles = app.store.vehicles.filter(v => v.k !== y.k);
                      app.store.rules = app.store.rules.filter(r => r.v !== y.k);
                      app.rebuild();
                      app.persist();
                    }}
                    className="px-1.5 py-0.5 text-[11px] rounded border border-[var(--ln)] text-[var(--mu)] hover:text-[#ef4444]"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px] text-[var(--mu)]">
                {FIELDS.map(([p, label, step]) => (
                  <label key={String(p)}>
                    {label}
                    <input
                      type="number"
                      step={step}
                      value={Number(y[p])}
                      onChange={e => {
                        let val = Math.max(0, +e.target.value || 0);
                        if (p === 'aggr' || p === 'avoid' || p === 'spread') val = clamp(val, 0, 1);
                        (y[p] as number) = val;
                        app.persist();
                        app.notify();
                      }}
                      className="mt-0.5 w-full rounded border border-[var(--ln)] bg-[var(--pn)] px-1.5 py-0.5 text-[12px] text-[var(--tx)] font-mono-nums"
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const base = DEFAULT_VEHICLES[2];
              const k = 'v' + Date.now().toString(36);
              app.store.vehicles.push({
                ...base,
                k,
                n: 'New type',
                c: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
                w: 10,
              });
              app.persist();
              app.notify();
            }}
            className="px-2.5 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]"
          >
            Add vehicle type
          </button>
        </div>
      </details>

      <details className="border-b border-[var(--ln)] py-2">
        <summary className="cursor-pointer font-bold text-[13px] select-none text-[var(--tx)]">
          Rules by vehicle, road and time
        </summary>
        <div className="mt-2 space-y-1.5 text-[12px]">
          <label className="block text-[var(--mu)]">
            Vehicle
            <select
              value={rv}
              onChange={e => setRv(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[var(--tx)]"
            >
              <option value="all">All vehicles</option>
              {app.store.vehicles.map(y => (
                <option key={y.k} value={y.k}>
                  {y.n}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[var(--mu)]">
            Road
            <select
              value={rr}
              onChange={e => setRr(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[var(--tx)]"
            >
              <option value="all">Any road</option>
              {Object.entries(ROAD_TYPES).map(([k, t]) => (
                <option key={k} value={`type:${k}`}>
                  All {t.label.toLowerCase()}s
                </option>
              ))}
              {app.sel.road && (
                <option value={String(app.sel.road.id)}>Selected: {app.sel.road.name}</option>
              )}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block text-[var(--mu)]">
              Rule
              <select
                value={ra}
                onChange={e => setRa(e.target.value as 'ban' | 'cap')}
                className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[var(--tx)]"
              >
                <option value="ban">Ban</option>
                <option value="cap">Speed cap</option>
              </select>
            </label>
            {ra === 'cap' && (
              <label className="block text-[var(--mu)]">
                Max km/h
                <input
                  type="number"
                  value={rval}
                  onChange={e => setRval(+e.target.value || 20)}
                  className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[var(--tx)] font-mono-nums"
                />
              </label>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[var(--mu)]">
            <span>From</span>
            <input
              type="time"
              value={rf}
              onChange={e => setRf(e.target.value)}
              className="rounded border border-[var(--ln)] bg-[var(--bg)] px-1.5 py-1 text-[11px] text-[var(--tx)]"
            />
            <span>to</span>
            <input
              type="time"
              value={rt}
              onChange={e => setRt(e.target.value)}
              className="rounded border border-[var(--ln)] bg-[var(--bg)] px-1.5 py-1 text-[11px] text-[var(--tx)]"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              app.store.rules.push({ v: rv, r: rr, a: ra, val: rval, from: rf || '00:00', to: rt || '23:59' });
              app.sim.refreshRules();
              app.sim.router.cache.clear();
              app.persist();
              app.notify();
            }}
            className="px-2.5 py-1 rounded bg-[var(--ac)] text-[#111] font-semibold"
          >
            Add rule
          </button>

          <div className="space-y-1 pt-1">
            {app.store.rules.length === 0 ? (
              <p className="text-[11px] text-[var(--mu)] m-0">No rules yet.</p>
            ) : (
              app.store.rules.map((r, idx) => {
                const vName =
                  r.v === 'all'
                    ? 'vehicles'
                    : (app.store.vehicles.find(y => y.k === r.v)?.n || '?').toLowerCase() + 's';
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[11px]"
                  >
                    <span className="text-[var(--tx)]">
                      {r.a === 'ban' ? `No ${vName} on` : `Max ${r.val} km/h on`} {roadName(r.r)}, {r.from}–{r.to}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        app.store.rules.splice(idx, 1);
                        app.sim.refreshRules();
                        app.sim.router.cache.clear();
                        app.persist();
                        app.notify();
                      }}
                      className="text-[var(--mu)] hover:text-[#ef4444]"
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </details>

      <details open className="border-b border-[var(--ln)] py-2">
        <summary className="cursor-pointer font-bold text-[13px] select-none text-[var(--tx)]">
          Town-wide efficiency
        </summary>
        <div className="mt-2 space-y-2">
          <div className="text-[12px] text-[var(--mu)] font-mono-nums">
            {app.sim.avgD == null
              ? 'Measuring…'
              : `Average delay ${Math.round(app.sim.avgD)} s per trip` +
                (Analyze.base != null ? ` (original: ${Math.round(Analyze.base)} s)` : '')}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => {
                Analyze.base = app.sim.avgD;
                app.notify();
              }}
              className="rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)] hover:border-[var(--ac)]"
            >
              Mark as original
            </button>
            <button
              type="button"
              onClick={() =>
                Analyze.suggest(
                  app.sim,
                  (t, hasApply) => {
                    setSuggText(t);
                    setCanApplySugg(!!hasApply);
                  },
                  () => app.rebuild()
                )
              }
              className="rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)] hover:border-[var(--ac)]"
            >
              Suggest improvement
            </button>
          </div>
          {suggText && (
            <div className="rounded border border-[var(--ln)] bg-[var(--bg)] p-2 text-[12px] text-[var(--tx)] space-y-1.5">
              <div>{suggText}</div>
              {canApplySugg && Analyze.last && (
                <button
                  type="button"
                  onClick={() => {
                    Analyze.last?.ap();
                    Analyze.last = null;
                    setCanApplySugg(false);
                    setSuggText('Applied.');
                    app.changed();
                  }}
                  className="px-2 py-1 text-[11px] rounded bg-[var(--ac)] text-[#111] font-semibold"
                >
                  Apply
                </button>
              )}
            </div>
          )}

          <div>
            <div className="text-[12px] font-semibold text-[var(--tx)] mb-1">Biggest bottlenecks</div>
            {worst.length === 0 ? (
              <p className="text-[11px] text-[var(--mu)] m-0">No slow spots yet.</p>
            ) : (
              <div className="space-y-1">
                {worst.map(x => (
                  <button
                    key={x.road.id}
                    type="button"
                    onClick={() => {
                      app.select({ road: x.road });
                      if (x.road._bb) app.view.fit(x.road._bb, 0.5);
                      app.notify();
                    }}
                    className="w-full flex items-center justify-between gap-2 rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1 text-[11px] hover:border-[var(--ac)]"
                  >
                    <span className="text-[var(--tx)] truncate">{x.road.name}</span>
                    <span className="font-mono-nums text-[var(--mu)] shrink-0">
                      {Math.round(x.loss / 60)} veh·min lost
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </details>

      <details open={!!veh} className="py-2">
        <summary className="cursor-pointer font-bold text-[13px] select-none text-[var(--tx)]">
          Selected driver
        </summary>
        <div className="mt-2 space-y-1.5 text-[12px]">
          {!veh ? (
            <p className="text-[11px] text-[var(--mu)] m-0">Click a dot on the map to follow one driver.</p>
          ) : (() => {
            const e = veh.p[veh.i];
            const left = veh.p.slice(veh.i).reduce((a, x) => a + x.len, 0) - veh.s;
            return (
              <>
                <div className="flex items-center gap-1.5 font-semibold text-[var(--tx)]">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full border border-black/50"
                    style={{ background: veh.c }}
                  />
                  {veh.ty.n} #{veh.id}
                </div>
                <div className="text-[var(--mu)] font-mono-nums text-[11px] space-y-0.5">
                  <div>
                    Speed <b className="text-[var(--tx)]">{Math.round(veh.v * 3.6)}</b> km/h · on{' '}
                    <b className="text-[var(--tx)]">{e?.road.name || 'road'}</b>
                  </div>
                  <div>
                    Aggr <b className="text-[var(--tx)]">{veh.aggr.toFixed(2)}</b> · gap{' '}
                    <b className="text-[var(--tx)]">{veh.tau.toFixed(2)} s</b> · {Math.round(veh.f * 100)}% limit
                  </div>
                  <div>
                    {veh.avoid ? 'Re-routes around jams' : 'Fixed route'} · {Math.round(left)} m left
                  </div>
                  {veh.w != null && <div className="text-[var(--ac)]">Stopped to load passengers</div>}
                  {veh.hot && <div className="text-[var(--ac)]">Trip to/from a hotspot</div>}
                </div>
                <label className="flex items-center gap-2 text-[12px] text-[var(--tx)] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={app.follow}
                    onChange={e2 => {
                      app.follow = e2.target.checked;
                      app.notify();
                    }}
                  />
                  Follow on map
                </label>
              </>
            );
          })()}
        </div>
      </details>
    </>
  );
};
