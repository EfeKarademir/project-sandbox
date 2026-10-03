// Shared IndexedDB helpers. Schema: docs/spec.md
const DB_NAME = 'tabnest';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('items')) {
        db.createObjectStore('items', { keyPath: 'id' }).createIndex('collectionId', 'collectionId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqDone(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbRun(stores, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(stores, mode);
  const result = await reqDone(fn(tx));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return result;
}

// Let the service worker rebuild its context menus after collection changes.
function notifyChanged() {
  const swallow = () => void chrome.runtime.lastError;
  try { chrome.runtime.sendMessage({ type: 'collections-changed' }, swallow); } catch (_) { /* no receiver */ }
}

const uid = () => crypto.randomUUID();

async function listCollections(includeArchived = false) {
  const rows = await dbRun('collections', 'readonly', (tx) => tx.objectStore('collections').getAll());
  rows.sort((a, b) => a.position - b.position);
  // includeArchived === 'only' → archived collections alone (Archived sidebar view).
  if (includeArchived === 'only') return rows.filter((c) => c.archivedAt);
  if (includeArchived) return rows;
  return rows.filter((c) => !c.archivedAt); // default: hide archived everywhere
}

async function listItems() {
  return dbRun('items', 'readonly', (tx) => tx.objectStore('items').getAll());
}

async function listItemsBy(collectionId) {
  const rows = await dbRun('items', 'readonly', (tx) =>
    tx.objectStore('items').index('collectionId').getAll(IDBKeyRange.only(collectionId))
  );
  rows.sort((a, b) => a.position - b.position);
  return rows;
}

async function putCollection(c) {
  await dbRun('collections', 'readwrite', (tx) => tx.objectStore('collections').put(c));
  notifyChanged();
}

async function putItem(i) {
  await dbRun('items', 'readwrite', (tx) => tx.objectStore('items').put(i));
}

async function deleteItem(id) {
  await dbRun('items', 'readwrite', (tx) => tx.objectStore('items').delete(id));
}

async function deleteCollectionDeep(id) {
  await dbRun(['collections', 'items'], 'readwrite', (tx) => {
    tx.objectStore('collections').delete(id);
    const cursor = tx.objectStore('items').index('collectionId').openCursor(IDBKeyRange.only(id));
    cursor.onsuccess = () => {
      const cur = cursor.result;
      if (cur) { cur.delete(); cur.continue(); }
    };
  });
  notifyChanged();
}

async function makeCollection(name) {
  const existing = await listCollections(true);
  const c = {
    id: uid(),
    name,
    position: existing.length ? Math.max(...existing.map((x) => x.position)) + 1 : 0,
    createdAt: Date.now(),
  };
  await putCollection(c);
  return c;
}

async function makeItem(collectionId, data) {
  const items = await listItemsBy(collectionId);
  const item = {
    id: uid(),
    collectionId,
    title: data.title || '',
    url: data.url,
    favIconUrl: data.favIconUrl || undefined,
    tags: (data.tags || []).map((t) => String(t).toLowerCase()),
    position: items.length ? Math.max(...items.map((x) => x.position)) + 1 : 0,
    createdAt: Date.now(),
    lastOpenedAt: undefined,
  };
  await putItem(item);
  return item;
}

async function exportAll() {
  return {
    version: 1,
    exportedAt: Date.now(),
    collections: await listCollections(true),
    items: await listItems(),
  };
}

async function importAll(data) {
  if (!data || !Array.isArray(data.collections) || !Array.isArray(data.items)) {
    throw new Error('Not a TabNest backup file');
  }
  await dbRun(['collections', 'items'], 'readwrite', (tx) => {
    const cols = tx.objectStore('collections');
    const items = tx.objectStore('items');
    cols.clear();
    items.clear();
    for (const c of data.collections) cols.put(c);
    for (const i of data.items) items.put(i);
  });
  notifyChanged();
}
