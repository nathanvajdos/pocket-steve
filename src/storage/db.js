/**
 * Steve.ai — IndexedDB Storage Layer (v2 architecture, phase 1.1)
 *
 * Modeled after Cue's src/storage/db.js. Stores every captured person on
 * device. Zero data leaves the device when the user is in local-only mode.
 *
 * This module is additive — it ships alongside the existing Supabase path
 * and doesn't yet replace it. Phase 1.2 will introduce a storage abstraction
 * that the rest of the app reads from; phase 6 deletes the Supabase code.
 *
 * Object stores (v1 schema):
 *   - entries: { id, raw, headline, summary, where_met, names, kids, pets,
 *                traits, next_likely_at, next_likely_where, parent_id,
 *                created_at, updated_at }
 *   - profile: { key, value }  — single-row settings store. Keys:
 *       'localOnlyMode' (bool, default false), 'aiMode' (bool, default true),
 *       'calendarIcsUrl' (string), 'displayName' (string)
 *   - todayCache: { date, matches }  — yesterday's "today" calculation, so the
 *       home screen renders fast before the .ics refetch completes.
 *
 * No indexes beyond keyPath in v1. We'll add (where_met, created_at) indexes
 * when the library view starts to feel slow at >500 entries.
 *
 * Verifiability: open DevTools → Application → IndexedDB → SteveDB. Every
 * row is plain JSON. Nothing is obfuscated; this is part of the privacy
 * story, not a bug.
 */

const DB_NAME = 'SteveDB';
const DB_VERSION = 1;

let _dbPromise = null;

/**
 * Open (or upgrade) the database. Cached per page-load.
 */
export function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('where_met', 'where_met', { unique: false });
        s.createIndex('created_at', 'created_at', { unique: false });
        s.createIndex('parent_id', 'parent_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('todayCache')) {
        db.createObjectStore('todayCache', { keyPath: 'date' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return _dbPromise;
}

/**
 * Generic transactional helper. Wraps an objectStore call in a promise.
 *   tx('entries', 'readwrite', store => store.put(entry))
 */
async function tx(storeName, mode, op) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const req = op(store);
    if (req && 'onsuccess' in req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } else {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    }
  });
}

// -------- entries --------

/** Generate a uuid-like id without pulling in a dep. */
function newId() {
  // RFC4122 v4-ish — good enough for client-side row keys.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function saveEntry(entry) {
  const now = new Date().toISOString();
  const withDefaults = {
    id: entry.id || newId(),
    raw: entry.raw || '',
    headline: entry.headline || '',
    summary: entry.summary || '',
    where_met: entry.where_met || 'Unspecified',
    names: entry.names || [],
    kids: entry.kids || [],
    pets: entry.pets || [],
    traits: entry.traits || [],
    next_likely_at: entry.next_likely_at || null,
    next_likely_where: entry.next_likely_where || null,
    parent_id: entry.parent_id || null,
    created_at: entry.created_at || now,
    updated_at: now
  };
  await tx('entries', 'readwrite', (store) => store.put(withDefaults));
  return withDefaults;
}

export async function getEntry(id) {
  return tx('entries', 'readonly', (store) => store.get(id));
}

export async function listEntries() {
  return tx('entries', 'readonly', (store) => store.getAll());
}

export async function deleteEntry(id) {
  return tx('entries', 'readwrite', (store) => store.delete(id));
}

/** Find entries whose where_met matches the given string (case-insensitive substring). */
export async function findByPlace(place) {
  if (!place) return [];
  const all = await listEntries();
  const needle = place.trim().toLowerCase();
  return all.filter((e) => (e.where_met || '').toLowerCase().includes(needle));
}

// -------- profile (settings) --------

export async function getSetting(key, fallback = null) {
  const row = await tx('profile', 'readonly', (store) => store.get(key));
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  return tx('profile', 'readwrite', (store) => store.put({ key, value }));
}

// -------- today cache --------

export async function readTodayCache(dateKey) {
  return tx('todayCache', 'readonly', (store) => store.get(dateKey));
}

export async function writeTodayCache(dateKey, matches) {
  return tx('todayCache', 'readwrite', (store) =>
    store.put({ date: dateKey, matches, savedAt: new Date().toISOString() })
  );
}

// -------- export / import (portability + Verify-page proof) --------

/** Return everything in the DB as a JSON-serializable blob. */
export async function exportAll() {
  const [entries, profileRows] = await Promise.all([
    listEntries(),
    tx('profile', 'readonly', (store) => store.getAll())
  ]);
  return {
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
    profile: Object.fromEntries((profileRows || []).map((r) => [r.key, r.value]))
  };
}

/** Replace local data with an exported blob. Used by the Verify page + restore flow. */
export async function importAll(blob) {
  if (!blob || typeof blob !== 'object') throw new Error('invalid import blob');
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['entries', 'profile'], 'readwrite');
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.objectStore('entries').clear();
    t.objectStore('profile').clear();
    (blob.entries || []).forEach((e) => t.objectStore('entries').put(e));
    Object.entries(blob.profile || {}).forEach(([key, value]) =>
      t.objectStore('profile').put({ key, value })
    );
  });
}
