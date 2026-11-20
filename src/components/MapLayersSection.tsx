import React, { useState } from 'react';
import { AREAS } from '../data/osm';
import type { RoadLensApp } from '../ui/appState';

interface Props {
  app: RoadLensApp;
}

export const MapLayersSection: React.FC<Props> = ({ app }) => {
  const [area, setArea] = useState('both');

  return (
    <details className="border-b border-[var(--ln)] py-2">
      <summary className="cursor-pointer font-bold text-[13px] select-none text-[var(--tx)]">Map and layers</summary>
      <div className="mt-2 space-y-2">
        <label className="block text-[12px] text-[var(--mu)]">
          Area
          <select
            value={area}
            onChange={e => setArea(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1.5 text-[13px] text-[var(--tx)]"
          >
            {Object.entries(AREAS).map(([k, a]) => (
              <option key={k} value={k}>
                {a.n}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={app.loadingReal || app.wb}
          onClick={() => app.loadReal(area)}
          className="w-full rounded bg-[var(--ac)] px-2.5 py-1.5 text-[12px] font-semibold text-[#111] hover:brightness-110 disabled:opacity-50"
        >
          {app.loadingReal ? 'Loading OpenStreetMap…' : 'Load real roads (OpenStreetMap)'}
        </button>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={app.wb}
            onClick={() => app.loadDemo(false)}
            className="rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--tx)] hover:border-[var(--ac)] disabled:opacity-50"
          >
            Use demo town
          </button>
          <button
            type="button"
            onClick={() => {
              app.view.fit(app.store.bounds());
              app.notify();
            }}
            className="rounded border border-[var(--ln)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--tx)] hover:border-[var(--ac)]"
          >
            Fit to screen
          </button>
        </div>

        <button
          type="button"
          disabled={app.loadingReal || app.wb}
          onClick={() => app.resetOriginalRoads()}
          className="w-full rounded border border-[var(--ln)] bg-[var(--bg)] px-2.5 py-1.5 text-[12px] text-[var(--tx)] hover:border-[var(--ac)] disabled:opacity-50"
        >
          Reset original roads
        </button>

        <div className="space-y-1 pt-1 text-[12px] text-[var(--tx)]">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={app.layers.buildings}
              onChange={e => {
                app.layers.buildings = e.target.checked;
                app.notify();
              }}
            />
            Buildings (squares)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={app.layers.junctions}
              onChange={e => {
                app.layers.junctions = e.target.checked;
                app.notify();
              }}
            />
            Junction and control dots
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={app.layers.labels}
              onChange={e => {
                app.layers.labels = e.target.checked;
                app.notify();
              }}
            />
            Street names
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={app.layers.arrows}
              onChange={e => {
                app.layers.arrows = e.target.checked;
                app.notify();
              }}
            />
            Flow arrows on every road
          </label>
        </div>

        <div className="flex items-center gap-4 pt-1 text-[12px] text-[var(--tx)]">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="mapMode"
              checked={app.layers.mode === 'heat'}
              onChange={() => {
                app.layers.mode = 'heat';
                app.notify();
              }}
            />
            Congestion colours
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="mapMode"
              checked={app.layers.mode === 'type'}
              onChange={() => {
                app.layers.mode = 'type';
                app.notify();
              }}
            />
            Road types
          </label>
        </div>
      </div>
    </details>
  );
};
