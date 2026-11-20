import React, { useState } from 'react';
import type { RoadLensApp } from '../ui/appState';

interface Props {
  app: RoadLensApp;
}

export const WorkbenchBar: React.FC<Props> = ({ app }) => {
  const [tplOpen, setTplOpen] = useState(false);
  const [probOpen, setProbOpen] = useState(false);

  if (!app.wb) return null;
  const problems = app.problems();

  return (
    <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5 max-w-[calc(100%-90px)]">
      <div className="flex flex-wrap items-center gap-2 bg-[var(--pn)] border-2 border-[var(--ac)] rounded-lg px-3 py-1.5 shadow-lg">
        <span className="font-bold text-[var(--ac)] text-[12px]">Workbench</span>
        <span className="text-[var(--mu)] text-[12px] hidden sm:inline">Edits stay separate until applied</span>

        <button
          type="button"
          disabled={!app.store.canUndo()}
          onClick={() => app.undo()}
          className="px-2 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)] disabled:opacity-40 whitespace-nowrap"
        >
          ↶ Undo
        </button>
        <button
          type="button"
          disabled={!app.store.canRedo()}
          onClick={() => app.redo()}
          className="px-2 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)] disabled:opacity-40 whitespace-nowrap"
        >
          ↷ Redo
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setTplOpen(v => !v);
              setProbOpen(false);
            }}
            className="px-2.5 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)] whitespace-nowrap"
          >
            + Insert template
          </button>
          {tplOpen && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-[var(--pn)] border border-[var(--ln)] rounded-md p-1 shadow-xl z-20 flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => {
                  setTplOpen(false);
                  app.insertTemplate('cross');
                }}
                className="text-left px-2.5 py-1.5 text-[12px] rounded hover:bg-[var(--bg)] text-[var(--tx)]"
              >
                4-way Cross junction
              </button>
              <button
                type="button"
                onClick={() => {
                  setTplOpen(false);
                  app.insertTemplate('t');
                }}
                className="text-left px-2.5 py-1.5 text-[12px] rounded hover:bg-[var(--bg)] text-[var(--tx)]"
              >
                T-Junction (yield)
              </button>
              <button
                type="button"
                onClick={() => {
                  setTplOpen(false);
                  app.insertTemplate('roundabout');
                }}
                className="text-left px-2.5 py-1.5 text-[12px] rounded hover:bg-[var(--bg)] text-[var(--tx)]"
              >
                Roundabout (editable ring)
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setProbOpen(v => !v);
            setTplOpen(false);
          }}
          className={`px-2.5 py-1 text-[12px] rounded border whitespace-nowrap font-mono-nums ${
            problems.length
              ? 'border-[#d97706] text-[#ffb703] bg-[var(--bg)]'
              : 'border-[var(--ln)] text-[var(--mu)] bg-[var(--bg)]'
          }`}
        >
          ⚠ Problems ({problems.length})
        </button>

        <button
          type="button"
          onClick={() => app.applyWorkbench()}
          className="px-2.5 py-1 text-[12px] rounded bg-[var(--ac)] text-[#111] font-semibold hover:brightness-110 whitespace-nowrap"
        >
          ✓ Apply to town
        </button>
        <button
          type="button"
          onClick={() => app.discardWorkbench()}
          className="px-2.5 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[#ef4444] hover:text-[#ef4444] whitespace-nowrap"
        >
          ✕ Discard
        </button>
      </div>

      {probOpen && (
        <div className="w-[420px] max-w-[92vw] max-h-56 overflow-auto bg-[var(--pn)] border border-[var(--ln)] rounded-lg p-2.5 shadow-xl">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-semibold text-[12px] text-[var(--tx)]">
              Network &amp; junction diagnostics ({problems.length})
            </span>
            <button
              type="button"
              onClick={() => setProbOpen(false)}
              className="text-[11px] text-[var(--mu)] hover:text-[var(--tx)]"
            >
              Close
            </button>
          </div>
          {problems.length === 0 ? (
            <div className="text-[12px] text-[#22c55e]">No lane, signal, or one-way issues detected.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {problems.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (p.nodeKey) {
                      const n = app.sim.net.byKey.get(p.nodeKey) || null;
                      if (n) {
                        app.select({ node: n });
                        app.view.cx = n.x;
                        app.view.cy = n.y;
                        app.view.scale = Math.max(app.view.scale, 3.2);
                        app.notify();
                      }
                    }
                    setProbOpen(false);
                  }}
                  className="text-left px-2 py-1.5 rounded border border-[var(--ln)] bg-[var(--bg)] hover:border-[var(--ac)] text-[12px]"
                >
                  <span className={p.severity === 'error' ? 'text-[#ef4444] font-semibold' : 'text-[#ffb703] font-semibold'}>
                    {p.severity === 'error' ? 'Error' : 'Check'}:
                  </span>{' '}
                  <span className="text-[var(--tx)]">{p.message}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
