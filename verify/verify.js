/**
 * Steve.ai Verify page — slice 1.1 functional smoke for the IndexedDB layer.
 *
 * Exercises every named export in /src/storage/db.js against the live
 * IndexedDB in the browser, reports green/red, and shows what's actually
 * persisted. This is both the test harness now and the user-facing
 * privacy proof in phase 5 — same artifact, grows as the rebuild progresses.
 */

import {
  openDB,
  saveEntry,
  getEntry,
  listEntries,
  deleteEntry,
  findByPlace,
  getSetting,
  setSetting,
  readTodayCache,
  writeTodayCache,
  exportAll,
  importAll
} from '/src/storage/db.js';

const SENTINEL_ID = '__verify-sentinel__';
const SENTINEL_SETTING = '__verify-sentinel-setting__';
const SENTINEL_TODAY_KEY = '__verify-sentinel-today__';

const testsEl = document.getElementById('v-tests');
const summaryEl = document.getElementById('v-summary');
const liveEl = document.getElementById('v-live');

// Render a single test row. Returns the row element so we can update it later.
function rowFor(label) {
  const row = document.createElement('div');
  row.className = 'v-test v-pending';
  row.innerHTML = `<span class="v-mark">·</span><span class="v-label">${label}</span><span class="v-detail" data-detail></span>`;
  testsEl.appendChild(row);
  return row;
}

function pass(row, detail = '') {
  row.classList.remove('v-pending', 'v-fail');
  row.classList.add('v-pass');
  row.querySelector('.v-mark').textContent = '✓';
  row.querySelector('[data-detail]').textContent = detail;
}

function fail(row, err) {
  row.classList.remove('v-pending', 'v-pass');
  row.classList.add('v-fail');
  row.querySelector('.v-mark').textContent = '✗';
  row.querySelector('[data-detail]').textContent = String(err && err.message ? err.message : err);
  console.error('[verify]', row.querySelector('.v-label').textContent, err);
}

async function runTest(label, fn) {
  const row = rowFor(label);
  try {
    const detail = await fn();
    pass(row, detail || '');
    return true;
  } catch (err) {
    fail(row, err);
    return false;
  }
}

function deepEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function cleanupSentinels() {
  // Best-effort cleanup; we don't want to fail tests if cleanup itself errors.
  try { await deleteEntry(SENTINEL_ID); } catch {}
  try { await setSetting(SENTINEL_SETTING, undefined); } catch {}
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const t = db.transaction('todayCache', 'readwrite');
      t.oncomplete = resolve;
      t.onerror = resolve;
      t.objectStore('todayCache').delete(SENTINEL_TODAY_KEY);
    });
  } catch {}
}

async function runAll() {
  testsEl.innerHTML = '';
  summaryEl.innerHTML = '';
  let passed = 0;
  let failed = 0;
  const tick = (ok) => { ok ? passed++ : failed++; };

  await cleanupSentinels();

  tick(await runTest('openDB() resolves the SteveDB handle', async () => {
    const db = await openDB();
    if (!db) throw new Error('no db handle');
    const names = Array.from(db.objectStoreNames).sort().join(', ');
    return `stores: ${names}`;
  }));

  tick(await runTest('saveEntry() persists with defaults + generated id', async () => {
    const saved = await saveEntry({
      id: SENTINEL_ID,
      raw: 'Met a couple at the school carnival. Dog Otis, kid Malachi, from California, all tatted up.',
      headline: 'California couple from the school carnival',
      summary: 'Dog Otis, kid Malachi, both tatted up, from California.',
      where_met: 'school carnival',
      names: ['unknown'],
      kids: ['Malachi'],
      pets: ['Otis'],
      traits: ['tatted up', 'California']
    });
    if (saved.id !== SENTINEL_ID) throw new Error(`id mismatch: ${saved.id}`);
    if (!saved.created_at) throw new Error('created_at not set');
    if (!saved.updated_at) throw new Error('updated_at not set');
    return `id=${saved.id.slice(0,12)}…`;
  }));

  tick(await runTest('getEntry() round-trips the saved entry', async () => {
    const got = await getEntry(SENTINEL_ID);
    if (!got) throw new Error('not found');
    if (!got.pets.includes('Otis')) throw new Error('pets missing Otis');
    if (!got.traits.includes('tatted up')) throw new Error('traits missing tatted up');
    return `headline="${got.headline}"`;
  }));

  tick(await runTest('listEntries() includes the sentinel', async () => {
    const all = await listEntries();
    if (!Array.isArray(all)) throw new Error('not an array');
    const found = all.find((e) => e.id === SENTINEL_ID);
    if (!found) throw new Error('sentinel missing');
    return `${all.length} entr${all.length === 1 ? 'y' : 'ies'} total`;
  }));

  tick(await runTest('findByPlace("school") matches case-insensitively', async () => {
    const hits = await findByPlace('SCHOOL');
    const found = hits.find((e) => e.id === SENTINEL_ID);
    if (!found) throw new Error('sentinel not in place hits');
    return `${hits.length} match${hits.length === 1 ? '' : 'es'}`;
  }));

  tick(await runTest('findByPlace("") returns empty', async () => {
    const hits = await findByPlace('');
    if (hits.length !== 0) throw new Error('expected []');
    return '';
  }));

  tick(await runTest('setSetting() + getSetting() round-trip', async () => {
    await setSetting(SENTINEL_SETTING, { foo: 'bar', n: 42 });
    const v = await getSetting(SENTINEL_SETTING);
    if (!deepEq(v, { foo: 'bar', n: 42 })) throw new Error(`got ${JSON.stringify(v)}`);
    return '';
  }));

  tick(await runTest('getSetting() fallback when key absent', async () => {
    const v = await getSetting('__definitely-not-set__', 'fallback-ok');
    if (v !== 'fallback-ok') throw new Error(`got ${v}`);
    return '';
  }));

  tick(await runTest('writeTodayCache() + readTodayCache() round-trip', async () => {
    await writeTodayCache(SENTINEL_TODAY_KEY, [{ entryId: SENTINEL_ID, eventTitle: 'Carnival' }]);
    const row = await readTodayCache(SENTINEL_TODAY_KEY);
    if (!row || !row.matches || row.matches[0].entryId !== SENTINEL_ID) throw new Error('cache row malformed');
    return `savedAt=${row.savedAt.slice(11, 19)}`;
  }));

  tick(await runTest('exportAll() returns entries + profile blob', async () => {
    const blob = await exportAll();
    if (typeof blob.schemaVersion !== 'number') throw new Error('schemaVersion missing');
    if (!Array.isArray(blob.entries)) throw new Error('entries not array');
    if (typeof blob.profile !== 'object') throw new Error('profile not object');
    return `v${blob.schemaVersion}, ${blob.entries.length} entr${blob.entries.length === 1 ? 'y' : 'ies'}`;
  }));

  tick(await runTest('importAll() restores from an export blob', async () => {
    const before = await exportAll();
    // Round-trip: export → modify in-memory → import → confirm
    const modified = JSON.parse(JSON.stringify(before));
    modified.profile['__round-trip-marker__'] = 'imported';
    await importAll(modified);
    const marker = await getSetting('__round-trip-marker__');
    if (marker !== 'imported') throw new Error(`marker not restored: ${marker}`);
    // Clean up the marker
    await setSetting('__round-trip-marker__', undefined);
    return '';
  }));

  tick(await runTest('deleteEntry() removes the sentinel', async () => {
    await deleteEntry(SENTINEL_ID);
    const after = await getEntry(SENTINEL_ID);
    if (after) throw new Error('still present after delete');
    return '';
  }));

  // Final cleanup pass.
  await cleanupSentinels();

  // Summary
  const total = passed + failed;
  summaryEl.innerHTML = `
    <span><strong>${total}</strong> tests</span>
    <span class="v-summary-pass"><strong>${passed}</strong> pass</span>
    ${failed ? `<span class="v-summary-fail"><strong>${failed}</strong> fail</span>` : `<span><strong>0</strong> fail</span>`}
  `;

  await refreshLive();
}

async function refreshLive() {
  try {
    const blob = await exportAll();
    liveEl.textContent = JSON.stringify(blob, null, 2);
  } catch (err) {
    liveEl.textContent = `(error reading DB: ${err.message})`;
  }
}

function downloadExport() {
  exportAll().then((blob) => {
    const data = JSON.stringify(blob, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `steve-ai-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

document.getElementById('v-rerun').addEventListener('click', runAll);
document.getElementById('v-refresh').addEventListener('click', refreshLive);
document.getElementById('v-export').addEventListener('click', downloadExport);

runAll();
