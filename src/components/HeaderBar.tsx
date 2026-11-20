import React, { useRef, useState } from 'react';
import type { RoadLensApp } from '../ui/appState';

interface Props {
  app: RoadLensApp;
  clockText: string;
  avgR: number | null;
}

export const HeaderBar: React.FC<Props> = ({ app, clockText, avgR }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const mood = avgR == null || avgR < 1.3 ? 'Smooth' : avgR < 1.8 ? 'Busy' : 'Jammed';
  const moodColor = avgR == null || avgR < 1.3 ? '#22c55e' : avgR < 1.8 ? '#ffb703' : '#ef4444';

  const download = (name: string, text: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const what = app.store.fromText(await f.text());
      app.afterLoad();
      app.status('Loaded ' + what + '.');
    } catch (err) {
      app.status('Could not read that file: ' + (err instanceof Error ? err.message : String(err)));
    }
    e.target.value = '';
  };

  return (
    <header
      className={`flex flex-wrap items-center gap-2 px-3 py-2 bg-[var(--pn)] border-b ${
        app.wb ? 'border-b-[3px] border-b-[var(--ac)]' : 'border-b-[var(--ln)]'
      }`}
    >
      <h1 className="text-[17px] font-bold tracking-tight m-0 mr-1.5 text-[var(--tx)]">RoadLens</h1>
      <span className="text-[var(--mu)] text-[13px] truncate max-w-[260px]" title={app.store.name}>
        {app.store.name}
      </span>
      <span className="font-mono-nums text-[17px] font-bold ml-2 text-[var(--ac)]">{clockText}</span>
      <span className="text-[12px] font-semibold" style={{ color: moodColor }}>
        {mood}
      </span>

      <div className="flex-1" />

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => app.setTheme(app.theme === 'dark' ? 'light' : 'dark')}
          className="px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--mu)] hover:border-[var(--ac)] hover:text-[var(--tx)] whitespace-nowrap"
          title="Switch map & sidebar theme"
        >
          {app.theme === 'dark' ? 'Light map' : 'Dark map'}
        </button>
        <button
          type="button"
          disabled={app.wb}
          onClick={() => !app.locked() && download('roadlens-project.json', JSON.stringify(app.store.pack()))}
          className="px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)] disabled:opacity-45 whitespace-nowrap"
        >
          Save project
        </button>
        <button
          type="button"
          disabled={app.wb}
          onClick={() => !app.locked() && download('roadlens-roads.geojson', JSON.stringify(app.store.geojson()))}
          className="px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)] disabled:opacity-45 whitespace-nowrap"
        >
          Export GeoJSON
        </button>
        <button
          type="button"
          disabled={app.wb}
          onClick={() => !app.locked() && fileRef.current?.click()}
          className="px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)] disabled:opacity-45 whitespace-nowrap"
        >
          Load file
        </button>
        <input ref={fileRef} type="file" accept=".json,.geojson" className="hidden" onChange={handleFile} />

        {!confirmClear ? (
          <button
            type="button"
            disabled={app.wb}
            onClick={() => !app.locked() && setConfirmClear(true)}
            className="px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx)] hover:border-[#ef4444] hover:text-[#ef4444] disabled:opacity-45 whitespace-nowrap"
          >
            Clear all
          </button>
        ) : (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setConfirmClear(false);
                app.store.setDataset({ roads: [], buildings: [], name: 'Empty' });
                app.afterLoad();
              }}
              className="px-2 py-1 text-[12px] rounded border border-[#ef4444] bg-[#ef4444] text-white font-semibold whitespace-nowrap"
            >
              Confirm clear
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="px-2 py-1 text-[12px] rounded border border-[var(--ln)] bg-[var(--bg)] text-[var(--mu)] whitespace-nowrap"
            >
              Cancel
            </button>
          </span>
        )}
      </div>
    </header>
  );
};
