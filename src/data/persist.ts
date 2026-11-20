import type { Store, PackedStore } from './store';

const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('roadlens', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

const tx = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', mode);
    const q = fn(t.objectStore('kv'));
    t.oncomplete = () => res(q && q.result);
    t.onerror = () => rej(t.error);
  });
};

export const kvGet = <T>(k: string): Promise<T | undefined> => tx<T>('readonly', s => s.get(k)).catch(() => undefined);
export const kvSet = (k: string, v: unknown): Promise<void> => tx('readwrite', s => s.put(v, k)).then(() => undefined).catch(() => {});

let timer: ReturnType<typeof setTimeout> | null = null;

export function saveSoon(store: Store) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (!store.wb) kvSet('project', store.pack());
  }, 600);
}

export const loadSaved = (): Promise<PackedStore | undefined> => kvGet<PackedStore>('project');
