import React from 'react';
import { CONTROLS, HOT_KINDS, ROAD_TYPES } from '../config';
import type { RoadLensApp } from '../ui/appState';
import type { ControlType, HotspotKindKey, RoadDir, RoadTypeKey, ToolMode } from '../types';

interface Props {
  app: RoadLensApp;
}

const TOOL_LIST: Array<{ id: ToolMode; label: string }> = [
  { id: 'select', label: 'Select' },
  { id: 'draw', label: 'Draw road' },
  { id: 'hotspot', label: 'Pin hotspot' },
  { id: 'point', label: 'Add stop light' },
  { id: 'split', label: 'Split road' },
  { id: 'delete', label: 'Delete road' },
];

const HINTS: Record<ToolMode, string> = {
  select: 'Click a road, junction/control dot, hotspot pin, or driver. Drag to pan, scroll to zoom.',
  draw: 'Pick a type and flow, then click along the route. Double-click or press Enter to finish.',
  hotspot: 'Click the map to pin a hotspot (school, out of town, market, hospital…). Adjust its priority below.',
  point: 'Click on a road to place a control at a junction or mid-block.',
  split: 'Click on a road where you want to cut it in two so each half can be edited separately.',
  delete: 'Click any road on the map to delete it immediately (you can undo the last delete below).',
};

export const ToolsSection: React.FC<Props> = ({ app }) => {
  const hint =
    app.tool === 'draw' && app.draft.length
      ? `${app.draft.length} point(s). Keep clicking. Double-click or Enter to finish.`
      : app.tool === 'select' && !app.store.roads.length
        ? 'No roads yet: load the map or draw one.'
        : HINTS[app.tool];

  return (
    <details open className="border-b border-[var(--ln)] py-2">
      <summary className="cursor-pointer font-bold text-[13px] select-none text-[var(--tx)]">Tools</summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {TOOL_LIST.map(t => {
            const active = app.tool === t.id;
            const isDelete = t.id === 'delete';
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => app.setTool(t.id)}
                className={`flex-1 min-w-[92px] px-2 py-1.5 text-[12px] rounded border transition-colors whitespace-nowrap ${
                  active
                    ? isDelete
                      ? 'bg-[#ef4444] border-[#ef4444] text-white font-semibold'
                      : 'bg-[var(--ac)] border-[var(--ac)] text-[#111] font-semibold'
                    : isDelete
                      ? 'bg-[var(--bg)] border-[var(--ln)] text-[#ef4444] hover:border-[#ef4444]'
                      : 'bg-[var(--bg)] border-[var(--ln)] text-[var(--tx)] hover:border-[var(--ac)]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {app.tool === 'draw' && (
          <div className="space-y-1.5 rounded border border-[var(--ln)] bg-[var(--bg)] p-2">
            <label className="block text-[12px] text-[var(--mu)]">
              New road type
              <select
                value={app.newType}
                onChange={e => {
                  app.newType = e.target.value as RoadTypeKey;
                  app.notify();
                }}
                className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--pn)] px-2 py-1 text-[12px] text-[var(--tx)]"
              >
                {Object.entries(ROAD_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] text-[var(--mu)]">
              New road flow
              <select
                value={app.newDir}
                onChange={e => {
                  app.newDir = e.target.value as RoadDir;
                  app.notify();
                }}
                className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--pn)] px-2 py-1 text-[12px] text-[var(--tx)]"
              >
                <option value="both">Two-way</option>
                <option value="fwd">One-way: start → end</option>
                <option value="rev">One-way: end → start</option>
              </select>
            </label>
            <div className="flex gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => app.finishDraw()}
                className="flex-1 rounded bg-[var(--ac)] px-2 py-1 text-[12px] font-semibold text-[#111]"
              >
                Finish
              </button>
              <button
                type="button"
                onClick={() => app.cancelDraw()}
                className="flex-1 rounded border border-[var(--ln)] bg-[var(--pn)] px-2 py-1 text-[12px] text-[var(--tx)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {app.tool === 'hotspot' && (
          <div className="space-y-2 rounded border border-[var(--ln)] bg-[var(--bg)] p-2.5">
            <label className="block text-[12px] text-[var(--mu)]">
              Kind of hotspot
              <select
                value={app.newKind}
                onChange={e => app.setNewKind(e.target.value as HotspotKindKey)}
                className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--pn)] px-2 py-1.5 text-[12px] text-[var(--tx)]"
              >
                {Object.entries(HOT_KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.n}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] text-[var(--mu)]">
              <div className="flex items-center justify-between mb-1">
                <span>Prioritize (trip preference)</span>
                <span className="font-mono-nums font-semibold text-[var(--tx)]">{app.newPriority}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={app.newPriority}
                aria-label="New hotspot priority"
                onChange={e => {
                  app.newPriority = +e.target.value;
                  app.notify();
                }}
                className="w-full"
              />
              <span className="block text-[11px] text-[var(--mu)] mt-0.5">
                Higher priority attracts more daily trips (e.g. School or Out of town high, Hospital lower on regular days).
              </span>
            </label>
          </div>
        )}

        {app.tool === 'point' && (
          <div className="rounded border border-[var(--ln)] bg-[var(--bg)] p-2">
            <label className="block text-[12px] text-[var(--mu)]">
              Control to place
              <select
                value={app.newCtrl}
                onChange={e => {
                  app.newCtrl = e.target.value as ControlType;
                  app.notify();
                }}
                className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--pn)] px-2 py-1 text-[12px] text-[var(--tx)]"
              >
                {(['signal', 'stop', 'yield', 'crossing'] as ControlType[]).map(k => (
                  <option key={k} value={k}>
                    {CONTROLS[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {app.tool === 'delete' && (
          <div className="rounded border border-[#ef4444]/40 bg-[var(--bg)] p-2 space-y-1.5">
            <div className="text-[11px] text-[var(--mu)]">
              {app.hoverRoad ? `Ready to delete: ${app.hoverRoad.name}` : 'Hover over a road, then click to delete.'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {app.lastDeletedRoad && (
                <button
                  type="button"
                  onClick={() => app.undoDeleteRoad()}
                  className="px-2 py-1 text-[11px] rounded border border-[var(--ln)] bg-[var(--pn)] text-[var(--tx)] hover:border-[var(--ac)]"
                >
                  Undo delete
                </button>
              )}
              {app.deletedRoads.length > 1 && (
                <button
                  type="button"
                  onClick={() => app.restoreAllDeletedRoads()}
                  className="px-2 py-1 text-[11px] rounded border border-[var(--ln)] bg-[var(--pn)] text-[var(--tx)] hover:border-[var(--ac)]"
                >
                  Restore all ({app.deletedRoads.length})
                </button>
              )}
              {!app.wb && (
                <button
                  type="button"
                  disabled={app.loadingReal}
                  onClick={() => app.resetOriginalRoads()}
                  className="px-2 py-1 text-[11px] rounded border border-[var(--ln)] bg-[var(--pn)] text-[var(--mu)] hover:border-[var(--ac)] hover:text-[var(--tx)] disabled:opacity-50"
                >
                  Reset all original roads
                </button>
              )}
            </div>
          </div>
        )}

        <p className="text-[11px] text-[var(--mu)] m-0 leading-snug">{hint}</p>
        {app.statusText && <p className="text-[11px] text-[var(--ac)] m-0 leading-snug">{app.statusText}</p>}
        {app.tool !== 'delete' && app.lastDeletedRoad && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => app.undoDeleteRoad()}
              className="px-2 py-1 text-[11px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]"
            >
              Undo delete “{app.lastDeletedRoad.road.name}”
            </button>
            {app.deletedRoads.length > 1 && (
              <button
                type="button"
                onClick={() => app.restoreAllDeletedRoads()}
                className="px-2 py-1 text-[11px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]"
              >
                Restore all ({app.deletedRoads.length})
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
};
