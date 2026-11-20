// Browser storage (IndexedDB) so work survives a reload. Best effort: the app still works if this fails.
const open = () => new Promise((res, rej) => { const r = indexedDB.open('roadlens', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
export const kvGet = k => tx('readonly', s => s.get(k)).catch(() => undefined);
export const kvSet = (k, v) => tx('readwrite', s => s.put(v, k)).catch(() => {});

let timer = null;
export function saveSoon(store) { clearTimeout(timer); // never save a workbench copy as the project
  timer = setTimeout(() => { if (!store.wb) kvSet('project', store.pack()); }, 600); }
export const loadSaved = () => kvGet('project');
