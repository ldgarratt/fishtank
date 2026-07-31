/*
 * Maia 3 inference worker.
 *
 * Runs the ONNX model off the main thread with onnxruntime-web, and caches the
 * (large) model in IndexedDB so it is downloaded once per browser.
 *
 * Structure follows the Maia platform's own worker
 * (CSSLab/maia-platform-frontend, public/maia-worker.js, GPL-3.0).
 *
 * Messages in:  { type: 'init' } | { type: 'infer', id, tokens, eloSelf, eloOppo }
 * Messages out: { type: 'ready' } | { type: 'progress', loaded, total }
 *               | { type: 'result', id, logitsMove, logitsValue }
 *               | { type: 'error', message, id? }
 */

'use strict';

// Vendored first (deploy downloads these), CDN as a fallback for plain checkouts.
const LOCAL_ORT = '../engine/ort/';
const CDN_ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/';
const LOCAL_MODEL = '../engine/maia3/maia3_simplified.onnx';
const CDN_MODEL =
  'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/main/public/maia3/maia3_simplified.onnx';

const DB_NAME = 'FishTankMaia';
const STORE = 'models';
const KEY = 'maia3';

let session = null;
let loading = null;

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

/* ---------- model cache ---------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
  });
}

async function readCache() {
  try {
    const db = await openDB();
    const store = db.transaction([STORE], 'readonly').objectStore(STORE);
    const rec = await new Promise((resolve, reject) => {
      const r = store.get(KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
    return rec ? await rec.data.arrayBuffer() : null;
  } catch (e) {
    return null; // private mode, quota, etc. — just re-download
  }
}

async function writeCache(buffer) {
  try {
    const db = await openDB();
    const store = db.transaction([STORE], 'readwrite').objectStore(STORE);
    store.put({ id: KEY, data: new Blob([buffer]), size: buffer.byteLength, at: Date.now() });
  } catch (e) {
    /* caching is best-effort */
  }
}

/** Download with progress reporting. */
async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    post({ type: 'progress', loaded, total });
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out.buffer;
}

/* ---------- setup ---------- */

function loadRuntime() {
  try {
    importScripts(LOCAL_ORT + 'ort.wasm.min.js');
    self.ort.env.wasm.wasmPaths = LOCAL_ORT;
  } catch (e) {
    importScripts(CDN_ORT + 'ort.wasm.min.js');
    self.ort.env.wasm.wasmPaths = CDN_ORT;
  }
  // Single-threaded keeps this working without cross-origin isolation.
  self.ort.env.wasm.numThreads = 1;
}

async function init() {
  if (session) return;
  if (loading) return loading;

  loading = (async () => {
    loadRuntime();

    let buffer = await readCache();
    if (!buffer) {
      try {
        buffer = await download(LOCAL_MODEL);
      } catch (e) {
        buffer = await download(CDN_MODEL);
      }
      await writeCache(buffer);
    }

    session = await self.ort.InferenceSession.create(buffer);
    post({ type: 'ready' });
  })();

  try {
    await loading;
  } finally {
    loading = null;
  }
}

/* ---------- messages ---------- */

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'init') {
      await init();
      return;
    }

    if (msg.type === 'infer') {
      if (!session) await init();
      const feeds = {
        tokens: new self.ort.Tensor('float32', new Float32Array(msg.tokens), [1, 64, 12]),
        elo_self: new self.ort.Tensor('float32', Float32Array.from([msg.eloSelf]), [1]),
        elo_oppo: new self.ort.Tensor('float32', Float32Array.from([msg.eloOppo]), [1]),
      };
      const out = await session.run(feeds);
      const logitsMove = new Float32Array(out.logits_move.data);
      const logitsValue = new Float32Array(out.logits_value.data);
      post(
        {
          type: 'result',
          id: msg.id,
          logitsMove: logitsMove.buffer,
          logitsValue: logitsValue.buffer,
        },
        [logitsMove.buffer, logitsValue.buffer]
      );
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: (err && err.message) || String(err) });
  }
};
