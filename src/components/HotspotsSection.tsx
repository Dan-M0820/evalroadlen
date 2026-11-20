import React from 'react';
import { HOT_KINDS } from '../config';
import { RuleSet } from '../engine/rules';
import type { RoadLensApp } from '../ui/appState';

interface Props {
  app: RoadLensApp;
}

export const HotspotsSection: React.FC<Props> = ({ app }) => {
  const hotspots = app.store.hotspots;
  const shares = app.sim.hotspotShares();
  const sec = app.sim.clock.now(app.sim.T);

  const applyBalanced = (preset: 'school_rush' | 'out_of_town' | 'even') => {
    for (const h of hotspots) {
      if (preset === 'even') {
        h.priority = 50;
      } else if (preset === 'school_rush') {
        h.priority = h.kind === 'school' ? 90 : h.kind === 'terminal' ? 75 : h.kind === 'hospital' ? 15 : 40;
      } else if (preset === 'out_of_town') {
        h.priority = h.kind === 'out_of_town' ? 95 : h.kind === 'terminal' ? 70 : h.kind === 'hospital' ? 10 : 35;
      }
    }
    app.hotChanged();
  };

  return (
    <details open className="border-b border-[var(--ln)] py-2">
      <summary className="cursor-pointer font-bold text-[13px] select-none text-[var(--tx)]">
        Hotspots ({hotspots.length})
      </summary>
      <div className="mt-2 space-y-2">
        {hotspots.length === 0 ? (
          <div className="space-y-1.5">
            <p className="text-[12px] text-[var(--mu)] m-0">
              No hotspots yet. Pick “Pin hotspot”, then click the map where a school, out-of-town highway exit, market, or hospital is.
            </p>
            <button
              type="button"
              onClick={() => app.setTool('hotspot')}
              className="px-2.5 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]"
            >
              Start pinning hotspots
            </button>
          </div>
        ) : (
          <>
            {hotspots.length >= 2 && (
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                <span className="text-[var(--mu)] mr-1">Quick mix:</span>
                <button
                  type="button"
                  onClick={() => applyBalanced('school_rush')}
                  className="px-1.5 py-0.5 rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]"
                >
                  School rush
                </button>
                <button
                  type="button"
                  onClick={() => applyBalanced('out_of_town')}
                  className="px-1.5 py-0.5 rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]"
                >
                  Out of town
                </button>
                <button
                  type="button"
                  onClick={() => applyBalanced('even')}
                  className="px-1.5 py-0.5 rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]"
                >
                  Equal 50%
                </button>
              </div>
            )}

            <div className="space-y-1.5">
              {hotspots.map(h => {
                const kind = HOT_KINDS[h.kind] || HOT_KINDS.other;
                const active = RuleSet.inWindow(h, sec);
                const share = shares[h.id] ?? 0;
                const st = app.sim.hstat[h.id];
                const isSel = app.sel.hot === h;
                const prio = h.priority ?? 50;

                return (
                  <div
                    key={h.id}
                    className={`rounded border px-2.5 py-2 transition-colors ${
                      isSel ? 'border-[var(--ac)] bg-[var(--pn2)]' : 'border-[var(--ln)] bg-[var(--bg)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          app.select({ hot: h });
                          app.view.cx = h.xy[0];
                          app.view.cy = h.xy[1];
                          if (app.view.scale < 0.35) app.view.scale = 0.35;
                          app.notify();
                        }}
                        className="flex items-center gap-1.5 text-left min-w-0 flex-1"
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-black/50"
                          style={{ background: kind.c }}
                        />
                        <span className="font-semibold text-[12px] text-[var(--tx)] truncate">{h.name}</span>
                      </button>
                      <span className="font-mono-nums text-[11px] text-[var(--ac)] font-semibold shrink-0">
                        {active ? `${Math.round(share)}% share` : 'Off-hours'}
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-[11px] text-[var(--mu)] shrink-0">Prioritize</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={prio}
                        aria-label={`Prioritize ${h.name}`}
                        onChange={e => {
                          h.priority = +e.target.value;
                          app.hotChanged();
                        }}
                        className="w-full"
                      />
                      <span className="font-mono-nums text-[11px] text-[var(--tx)] w-8 text-right shrink-0">
                        {prio}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--mu)] font-mono-nums">
                      <span>
                        {h.role === 'dest' ? 'attracts' : h.role === 'origin' ? 'generates' : 'both'} · strength {h.weight}/10
                      </span>
                      <span>
                        {st ? `${st.started} started · ${st.n} done` : '0 trips'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </details>
  );
};
