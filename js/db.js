// db.js — almacenamiento local cifrado (IndexedDB + WebCrypto).
// Todo se guarda en el dispositivo. Una clave de datos (DEK) cifra entradas y fotos.
// Sin PIN, la DEK se guarda en claro junto a los datos. Con PIN, se guarda
// envuelta con una clave derivada del PIN (PBKDF2), y solo vive en memoria al desbloquear.

const DB_NAME = 'momento';
const DB_VERSION = 1;
const PBKDF2_ITER = 150000;

const te = new TextEncoder();
const td = new TextDecoder();

let dbPromise = null;
let dek = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base de datos bloqueada'));
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function idbGet(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}
async function idbGetAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}
async function idbPut(store, value) {
  const db = await openDB();
  return wrap(db.transaction(store, 'readwrite').objectStore(store).put(value));
}
async function idbDel(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}
async function idbCount(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).count());
}

// ---------- cifrado ----------

function requireKey() {
  if (!dek) throw new Error('Diario bloqueado');
}

async function encryptBytes(bytes) {
  requireKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, bytes);
  return { iv, data };
}
async function decryptBytes(rec) {
  requireKey();
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, dek, rec.data);
}
async function encryptJSON(obj) {
  return encryptBytes(te.encode(JSON.stringify(obj)));
}
async function decryptJSON(rec) {
  return JSON.parse(td.decode(await decryptBytes(rec)));
}

function importRaw(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

async function deriveKEK(pin, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ---------- llavero ----------

/** Prepara la clave de datos. Devuelve { locked, hasPin }. */
export async function init() {
  if (!('indexedDB' in window) || !crypto || !crypto.subtle) {
    throw new Error('Este navegador no soporta almacenamiento cifrado. Prueba con Chrome, Safari o Firefox actualizados.');
  }
  const ring = await idbGet('meta', 'keyring');
  if (!ring) {
    dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const raw = await crypto.subtle.exportKey('raw', dek);
    await idbPut('meta', { key: 'keyring', raw, wrapped: null, createdAt: Date.now() });
    return { locked: false, hasPin: false };
  }
  if (ring.raw) {
    dek = await importRaw(ring.raw);
    return { locked: false, hasPin: false };
  }
  return { locked: true, hasPin: true };
}

export function isUnlocked() {
  return !!dek;
}

export async function hasPin() {
  const ring = await idbGet('meta', 'keyring');
  return !!(ring && ring.wrapped);
}

/** Desbloquea con el PIN. Lanza error si el PIN es incorrecto. */
export async function unlock(pin) {
  const ring = await idbGet('meta', 'keyring');
  if (!ring || !ring.wrapped) throw new Error('No hay PIN configurado');
  const w = ring.wrapped;
  const kek = await deriveKEK(pin, w.salt, w.iterations);
  let raw;
  try {
    raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: w.iv }, kek, w.data);
  } catch (e) {
    throw new Error('PIN incorrecto');
  }
  dek = await importRaw(raw);
}

export function lock() {
  dek = null;
}

export async function setPin(pin) {
  requireKey();
  const raw = await crypto.subtle.exportKey('raw', dek);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveKEK(pin, salt, PBKDF2_ITER);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
  const ring = (await idbGet('meta', 'keyring')) || { key: 'keyring', createdAt: Date.now() };
  await idbPut('meta', { ...ring, raw: null, wrapped: { salt, iv, data, iterations: PBKDF2_ITER } });
}

export async function removePin(pin) {
  await unlock(pin);
  const raw = await crypto.subtle.exportKey('raw', dek);
  const ring = await idbGet('meta', 'keyring');
  await idbPut('meta', { ...ring, raw, wrapped: null });
}

export async function changePin(oldPin, newPin) {
  await unlock(oldPin);
  await setPin(newPin);
}

// ---------- entradas ----------

export async function listEntries() {
  const recs = await idbGetAll('entries');
  const out = [];
  for (const r of recs) {
    try {
      out.push(await decryptJSON(r));
    } catch (e) {
      console.warn('Entrada ilegible', r.id, e);
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

export async function saveEntry(entry) {
  const rec = await encryptJSON(entry);
  await idbPut('entries', { id: entry.id, iv: rec.iv, data: rec.data });
}

export async function deleteEntry(entry) {
  await idbDel('entries', entry.id);
  if (entry.photoId) await idbDel('photos', entry.photoId);
}

export async function countEntries() {
  return idbCount('entries');
}

// ---------- fotos ----------

export async function savePhoto(id, fullBlob, thumbBlob) {
  const full = await encryptBytes(await fullBlob.arrayBuffer());
  const thumb = await encryptBytes(await thumbBlob.arrayBuffer());
  await idbPut('photos', { id, type: fullBlob.type || 'image/jpeg', full, thumb });
}

export async function getPhoto(id) {
  const r = await idbGet('photos', id);
  if (!r) return null;
  return {
    full: new Blob([await decryptBytes(r.full)], { type: r.type }),
    thumb: new Blob([await decryptBytes(r.thumb)], { type: r.type }),
  };
}

export async function getThumb(id) {
  const r = await idbGet('photos', id);
  if (!r) return null;
  return new Blob([await decryptBytes(r.thumb)], { type: r.type });
}

export async function deletePhoto(id) {
  await idbDel('photos', id);
}

// ---------- utilidades ----------

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) {}
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch (e) {}
  return null;
}

/** Borra toda la base de datos. Conviene recargar la página después. */
export async function wipeAll() {
  dek = null;
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await new Promise((res, rej) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
    req.onblocked = () => res();
  });
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
