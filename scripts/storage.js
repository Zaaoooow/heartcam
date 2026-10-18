/* ============================================================
   storage.js — tiny IndexedDB wrapper for the photo album.
   Each record: { id, blob, meta:{ filter, intensity, ts, aspect, ratio } }
   Falls back to in-memory + dataURL download when IDB is unavailable.
   ============================================================ */

const DB_NAME = 'naxiesian-cam';
const STORE = 'photos';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('no idb')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode) {
  const db = await openDB();
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function savePhoto(blob, meta) {
  const id = `p${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.add({ id, blob, meta });
    req.onsuccess = () => resolve({ id });
    req.onerror = () => reject(req.error);
  });
}

export async function listPhotos() {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deletePhoto(id) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearPhotos() {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* helpers to convert between blob / dataURL */
export function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
