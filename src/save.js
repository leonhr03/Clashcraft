// IndexedDB persistence for worlds and modified chunks.
const DB_NAME = 'blockwelt';
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('worlds')) d.createObjectStore('worlds', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}

export async function listWorlds() {
  try {
    const all = await tx('worlds', 'readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  } catch (e) { console.warn(e); return []; }
}

export function saveWorldMeta(meta) { return tx('worlds', 'readwrite', (s) => s.put(meta)); }

export async function loadChunks(worldId) {
  const map = new Map();
  const d = await db();
  await new Promise((res, rej) => {
    const t = d.transaction('chunks', 'readonly');
    const s = t.objectStore('chunks');
    const range = IDBKeyRange.bound(worldId + ':', worldId + ':￿');
    const req = s.openCursor(range);
    req.onsuccess = () => {
      const c = req.result;
      if (c) { map.set(c.key.slice(worldId.length + 1), new Uint8Array(c.value)); c.continue(); }
    };
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  return map;
}

export function saveChunks(worldId, entries) {
  if (!entries.length) return Promise.resolve();
  return tx('chunks', 'readwrite', (s) => { for (const [k, data] of entries) s.put(data, worldId + ':' + k); });
}

export async function deleteWorld(worldId) {
  await tx('worlds', 'readwrite', (s) => s.delete(worldId));
  const d = await db();
  await new Promise((res) => {
    const t = d.transaction('chunks', 'readwrite');
    t.objectStore('chunks').delete(IDBKeyRange.bound(worldId + ':', worldId + ':￿'));
    t.oncomplete = res; t.onerror = res;
  });
}

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem('blockwelt_settings') || '{}'); } catch (e) { return {}; }
}
export function storeSettings(s) {
  try { localStorage.setItem('blockwelt_settings', JSON.stringify(s)); } catch (e) { /* ignore */ }
}
