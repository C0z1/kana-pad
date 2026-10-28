// Tiny key-value store on IndexedDB, with localStorage as fallback (private windows, old browsers).
const DB = "kana-pad", STORE = "kv";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
const db = () => (dbPromise ??= open());

function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error); // e.g. quota exceeded: fall back to localStorage instead of hanging
  }));
}

const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export const store = {
  async get(k, d) {
    try { return (await tx("readonly", s => s.get(k))) ?? ls.get(k, d); } catch { return ls.get(k, d); }
  },
  // Resolves true when the value is safely stored (IndexedDB, or localStorage as fallback).
  async set(k, v) {
    try {
      await tx("readwrite", s => s.put(v, k));
      try { localStorage.removeItem(k); } catch {}
      return true;
    } catch {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
    }
  },
  // Small, synchronous settings stay in localStorage so the first frame renders with them.
  getSync: ls.get,
  setSync: ls.set,
};
