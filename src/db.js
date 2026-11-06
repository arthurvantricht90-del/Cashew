// Minimal IndexedDB wrapper: stores 'kv', 'tx' (keyPath id), 'pdfs' (keyPath id)
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('expense-tracker', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('kv');
      db.createObjectStore('tx', { keyPath: 'id' });
      db.createObjectStore('pdfs', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function store(name, mode = 'readonly') { return (await open()).transaction(name, mode).objectStore(name); }

export const db = {
  async get(key) { return req((await store('kv')).get(key)); },
  async set(key, val) { return req((await store('kv', 'readwrite')).put(val, key)); },
  async allTx() { return req((await store('tx')).getAll()); },
  async putTx(list) {
    const d = await open();
    return new Promise((res, rej) => {
      const tr = d.transaction('tx', 'readwrite'); const s = tr.objectStore('tx');
      for (const t of list) s.put(t);
      tr.oncomplete = () => res(); tr.onerror = () => rej(tr.error);
    });
  },
  async allPdfMeta() {
    const all = await req((await store('pdfs')).getAll());
    return all.map(({ blob, ...m }) => m);
  },
  async allPdfs() { return req((await store('pdfs')).getAll()); },
  async getPdf(id) { return req((await store('pdfs')).get(id)); },
  async putPdf(p) { return req((await store('pdfs', 'readwrite')).put(p)); },
  async delPdf(id) { return req((await store('pdfs', 'readwrite')).delete(id)); },
  async clearAll() {
    const d = await open();
    await Promise.all(['kv', 'tx', 'pdfs'].map(n => req(d.transaction(n, 'readwrite').objectStore(n).clear())));
  },
};
