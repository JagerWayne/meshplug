// ============================================================================
// AUTO-SAVE & RECOVERY
// ============================================================================
// Keeps a copy of the working model in IndexedDB so a crash, a closed tab or
// a mistyped "New" never costs more than a few seconds of work.
//
// Only the scan geometry and the settings that shape it are stored. The
// selection mask and the shell are derived from the geometry, so they are
// rebuilt rather than saved - that keeps the stored blob small.

const AUTOSAVE_DB = 'meshplug';
const AUTOSAVE_STORE = 'sessions';
const AUTOSAVE_KEY = 'current';
const AUTOSAVE_INTERVAL = 30000;      // 30 seconds
const AUTOSAVE_MAX_AGE = 1000 * 60 * 60 * 24 * 7;  // a week

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------
function openAutosaveDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(AUTOSAVE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) {
        db.createObjectStore(AUTOSAVE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open the autosave store'));
  });
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE, 'readonly');
    const req = tx.objectStore(AUTOSAVE_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE, 'readwrite');
    tx.objectStore(AUTOSAVE_STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function idbDelete(db, key) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(AUTOSAVE_STORE, 'readwrite');
      tx.objectStore(AUTOSAVE_STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Serialisation
//   Named apart from the worker's helpers on purpose: every module shares
//   one global scope, so a duplicate function name would silently replace
//   the other one.
// ---------------------------------------------------------------------------
function serializeSessionGeometry(geometry) {
  if (!geometry || !geometry.attributes.position) return null;
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const idx = geometry.index;
  return {
    position: pos.array.slice(0),
    normal: nrm ? nrm.array.slice(0) : null,
    index: idx ? idx.array.slice(0) : null
  };
}

function deserializeSessionGeometry(data) {
  if (!data || !data.position) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  if (data.normal) geometry.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
  if (data.index) geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// The autosave manager
// ---------------------------------------------------------------------------
class AutosaveManager {
  constructor() {
    this.db = null;
    this.timer = null;
    this.lastSaved = 0;
    this.enabled = true;
    this.pending = false;
    this.saveFn = null;      // set by the app: () => snapshot or null
    this.onRestore = null;    // set by the app: (snapshot) => void
    this.onStatus = null;    // set by the app: (status) => void
  }

  async init() {
    try {
      this.db = await openAutosaveDb();
      return true;
    } catch (e) {
      this.db = null;
      return false;
    }
  }

  status(state, detail) {
    if (this.onStatus) this.onStatus(state, detail);
  }

  // Reads the stored session, if it is still worth offering.
  async peek() {
    if (!this.db) return null;
    try {
      const rec = await idbGet(this.db, AUTOSAVE_KEY);
      if (!rec || !rec.snapshot) return null;
      if (Date.now() - rec.savedAt > AUTOSAVE_MAX_AGE) {
        await idbDelete(this.db, AUTOSAVE_KEY);
        return null;
      }
      return rec;
    } catch (e) {
      return null;
    }
  }

  async save() {
    if (!this.enabled || !this.db || !this.saveFn) return false;
    if (this.pending) return false;   // a save is already queued
    this.pending = true;
    try {
      const snapshot = this.saveFn();
      if (!snapshot || !snapshot.geometry) {
        this.status('empty');
        return false;
      }      await idbPut(this.db, AUTOSAVE_KEY, {
        savedAt: Date.now(),
        snapshot
      });
      this.lastSaved = Date.now();
      this.status('saved');
      return true;
    } catch (e) {
      this.status('error', e.message);
      return false;
    } finally {
      this.pending = false;
    }
  }

  // Starts the periodic save. `saveFn` returns the snapshot to store.
  start(saveFn) {
    this.saveFn = saveFn;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.save(), AUTOSAVE_INTERVAL);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async clear() {
    if (!this.db) return false;
    await idbDelete(this.db, AUTOSAVE_KEY);
    this.lastSaved = 0;
    this.status('cleared');
    return true;
  }

  async restore() {
    const rec = await this.peek();
    if (!rec || !this.onRestore) return false;
    this.onRestore(rec.snapshot, rec.savedAt);
    return true;
  }
}

const autosave = new AutosaveManager();

// ---------------------------------------------------------------------------
// The restore banner
// ---------------------------------------------------------------------------
const RestoreBanner = ({ snapshot, savedAt, onRestore, onDismiss }) => {
  const when = savedAt ? new Date(savedAt).toLocaleString() : 'an earlier session';
  const label = snapshot && snapshot.name ? snapshot.name : 'your last model';
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#0a0f1d]/95 border border-cyan-500/40 shadow-2xl backdrop-blur-md">
      <Icon name="refresh" className="w-4 h-4 text-cyan-400 shrink-0" />
      <div className="text-[11px] text-slate-300">
        Found <strong className="text-cyan-200">{label}</strong> from {when}.
      </div>
      <button
        onClick={onRestore}
        className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold"
      >
        Restore
      </button>
      <button
        onClick={onDismiss}
        className="px-2 py-1 rounded-lg text-slate-500 hover:text-slate-300 text-[11px] font-semibold"
        title="Discard the saved session"
      >
        Discard
      </button>
    </div>
  );
};
