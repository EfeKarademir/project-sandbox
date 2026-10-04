// Self-check for listCollections filter modes. Run: node test/test-db-filter.mjs
import fs from 'fs';
import vm from 'vm';

const rows = [
  { id: 'a', name: 'Active', position: 0, createdAt: 1 },
  { id: 'b', name: 'Archived', position: 1, createdAt: 2, archivedAt: 5 },
];

function sandboxWith(rows) {
  let dbInstance;
  const makeDb = () => ({
    objectStoreNames: { contains: () => true },
    close() {},
    transaction: (stores, mode) => ({
      objectStore: (name) => ({
        // getAll: create a request whose onsuccess assignment fires the callback.
        getAll: () => {
          const r = {};
          Object.defineProperty(r, 'onsuccess', {
            set(f) { queueMicrotask(() => { r.result = rows; f(); }); },
            get() { return undefined; },
            configurable: true,
          });
          return r;
        },
      }),
      set oncomplete(f) { queueMicrotask(() => f()); },
      onerror: null,
    }),
  });

  const sb = {
    console, Promise, crypto,
    chrome: { runtime: { sendMessage() {} } },
    indexedDB: {
      open: () => {
        const req = {};
        Object.defineProperty(req, 'onsuccess', {
          set(f) { dbInstance = makeDb(); queueMicrotask(() => { req.result = dbInstance; f(); }); },
          get() { return undefined; },
          configurable: true,
        });
        Object.defineProperty(req, 'onerror', {
          set(f) { /* no error path in stub */ },
          get() { return undefined; },
          configurable: true,
        });
        return req;
      },
    },
  };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(new URL('../db.js', import.meta.url), 'utf8'), sb);
  return sb;
}

const sb = sandboxWith(rows);
const all = await sb.listCollections(true);   // includeArchived=true → everything
const only = await sb.listCollections('only'); // 'only' → archived alone
const def = await sb.listCollections(false);  // default → active alone

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } };
assert(all.some((c) => c.id === 'a') && all.some((c) => c.id === 'b'), 'true -> both');
assert(only.length === 1 && only[0].id === 'b', "'only' -> archived only");
assert(def.length === 1 && def[0].id === 'a', 'false/default -> active only');
console.log('PASS: listCollections true/only/false behave as expected');
