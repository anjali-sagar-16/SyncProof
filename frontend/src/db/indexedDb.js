/**
 * IndexedDB Storage Engine for SyncProof
 * Provides persistent browser-side caching for equipment, inspections,
 * and the offline mutation outbox queue.
 */

const DB_NAME = 'SyncProofDB';
const DB_VERSION = 2;

let dbInstance = null;

/**
 * Checks if IndexedDB is supported in the current environment.
 */
export function isIndexedDbSupported() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

/**
 * Generates a valid RFC4122 v4 UUID.
 */
export function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Closes the active database connection and resets the singleton instance.
 */
export function closeDB() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Initializes and opens the IndexedDB database.
 */
export function openDB() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  if (!isIndexedDbSupported()) {
    return Promise.reject(new Error('IndexedDB is not supported in this environment.'));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Equipment store
      if (!db.objectStoreNames.contains('equipment')) {
        const equipStore = db.createObjectStore('equipment', { keyPath: 'id' });
        equipStore.createIndex('code', 'code', { unique: true });
        equipStore.createIndex('status', 'status', { unique: false });
      }

      // 2. Inspections store
      if (!db.objectStoreNames.contains('inspections')) {
        const inspStore = db.createObjectStore('inspections', { keyPath: 'id' });
        inspStore.createIndex('equipment_id', 'equipment_id', { unique: false });
        inspStore.createIndex('inspector_id', 'inspector_id', { unique: false });
        inspStore.createIndex('version', 'version', { unique: false });
        inspStore.createIndex('has_pending_conflict', 'has_pending_conflict', { unique: false });
      }

      // 3. Outbox / Mutation Queue store (Offline-first mutation queue)
      if (!db.objectStoreNames.contains('outbox')) {
        const outboxStore = db.createObjectStore('outbox', { keyPath: 'id' });
        outboxStore.createIndex('clientMutationId', 'clientMutationId', { unique: true });
        outboxStore.createIndex('status', 'status', { unique: false });
        outboxStore.createIndex('createdAt', 'createdAt', { unique: false });
        outboxStore.createIndex('entityId', 'entityId', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(new Error(`Failed to open IndexedDB: ${event.target.error?.message || 'Unknown error'}`));
    };
  });
}

/**
 * Helper to execute a transaction on an object store.
 */
async function getStore(storeName, mode = 'readonly') {
  const db = await openDB();
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

// ==============================================================================
// Equipment Cache Methods
// ==============================================================================

export async function saveEquipment(item) {
  if (!item || !item.id) return null;
  const store = await getStore('equipment', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ ...item, _cachedAt: new Date().toISOString() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveEquipmentBatch(items = []) {
  if (!items || items.length === 0) return 0;
  const db = await openDB();
  const tx = db.transaction('equipment', 'readwrite');
  const store = tx.objectStore('equipment');
  const now = new Date().toISOString();

  for (const item of items) {
    if (item && item.id) {
      store.put({ ...item, _cachedAt: now });
    }
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(items.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllEquipment() {
  const store = await getStore('equipment', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getEquipmentById(id) {
  const store = await getStore('equipment', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ==============================================================================
// Inspections Cache Methods
// ==============================================================================

export async function saveInspection(item) {
  if (!item || !item.id) return null;
  const store = await getStore('inspections', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ ...item, _cachedAt: new Date().toISOString() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveInspectionBatch(items = []) {
  if (!items || items.length === 0) return 0;
  const db = await openDB();
  const tx = db.transaction('inspections', 'readwrite');
  const store = tx.objectStore('inspections');
  const now = new Date().toISOString();

  for (const item of items) {
    if (item && item.id) {
      store.put({ ...item, _cachedAt: now });
    }
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(items.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllInspections() {
  const store = await getStore('inspections', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      // Sort newest to oldest
      const results = req.result || [];
      results.sort((a, b) => new Date(b.created_at || b._cachedAt) - new Date(a.created_at || a._cachedAt));
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getInspectionById(id) {
  const store = await getStore('inspections', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteInspection(id) {
  const store = await getStore('inspections', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// ==============================================================================
// Mutation Outbox Queue Methods (Offline-first persistent operations)
// ==============================================================================

/**
 * Enqueues a mutation into the local outbox.
 * Assigns a unique clientMutationId and tracks state.
 *
 * @param {Object} mutation
 * @returns {Promise<Object>} The persisted mutation record
 */
export async function enqueueMutation({
  action, // 'create' | 'update'
  entityId, // inspection UUID (for update) or null (for create)
  equipmentId, // required for create
  baseVersion, // required for update (OCC version)
  changes = {},
  clientState = null,
  baseState = null,
  optimisticRecord = null,
}) {
  const clientMutationId = generateUuid();
  const now = new Date().toISOString();

  const mutation = {
    id: clientMutationId,
    clientMutationId,
    action,
    entityId: entityId || clientMutationId, // temporary ID if create
    equipmentId: equipmentId || null,
    baseVersion: baseVersion ? Number(baseVersion) : 1,
    changes,
    clientState,
    baseState,
    optimisticRecord,
    status: 'pending', // 'pending' | 'syncing' | 'synced' | 'failed' | 'conflicted'
    retryCount: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };

  const store = await getStore('outbox', 'readwrite');
  await new Promise((resolve, reject) => {
    const req = store.put(mutation);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return mutation;
}

/**
 * Retrieves all mutations currently needing synchronization:
 * status in ('pending', 'syncing', 'failed').
 */
export async function getPendingMutations() {
  const store = await getStore('outbox', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      // Filter for actionable mutations and sort chronologically
      const pending = all
        .filter((m) => m.status === 'pending' || m.status === 'failed')
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      resolve(pending);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves all mutations in the outbox regardless of status.
 */
export async function getAllMutations() {
  const store = await getStore('outbox', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves a single mutation by ID.
 */
export async function getMutationById(id) {
  const store = await getStore('outbox', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Updates a mutation's status and properties.
 */
export async function updateMutation(id, updates = {}) {
  const db = await openDB();
  const tx = db.transaction('outbox', 'readwrite');
  const store = tx.objectStore('outbox');

  return new Promise((resolve, reject) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        return resolve(null);
      }

      const updated = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve(updated);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Deletes a mutation record from the outbox.
 */
export async function removeMutation(id) {
  const store = await getStore('outbox', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Clears all successfully synced mutations from the outbox.
 */
export async function clearSyncedMutations() {
  const all = await getAllMutations();
  const synced = all.filter((m) => m.status === 'synced');
  const db = await openDB();
  const tx = db.transaction('outbox', 'readwrite');
  const store = tx.objectStore('outbox');

  for (const m of synced) {
    store.delete(m.id);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(synced.length);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Returns breakdown counts of the outbox.
 */
export async function getOutboxStats() {
  if (!isIndexedDbSupported()) {
    return { total: 0, pending: 0, syncing: 0, synced: 0, failed: 0, conflicted: 0 };
  }

  try {
    const all = await getAllMutations();
    return {
      total: all.length,
      pending: all.filter((m) => m.status === 'pending').length,
      syncing: all.filter((m) => m.status === 'syncing').length,
      synced: all.filter((m) => m.status === 'synced').length,
      failed: all.filter((m) => m.status === 'failed').length,
      conflicted: all.filter((m) => m.status === 'conflicted').length,
    };
  } catch {
    return { total: 0, pending: 0, syncing: 0, synced: 0, failed: 0, conflicted: 0 };
  }
}

// ==============================================================================
// Cache Statistics & Diagnostics
// ==============================================================================

export async function getCacheStats() {
  if (!isIndexedDbSupported()) {
    return { available: false, equipmentCount: 0, inspectionCount: 0, outboxCount: 0, pendingSyncCount: 0 };
  }

  try {
    const [equipment, inspections, outboxStats] = await Promise.all([
      getAllEquipment(),
      getAllInspections(),
      getOutboxStats(),
    ]);

    return {
      available: true,
      equipmentCount: equipment.length,
      inspectionCount: inspections.length,
      outboxCount: outboxStats.total,
      pendingSyncCount: outboxStats.pending + outboxStats.failed,
    };
  } catch {
    return { available: false, equipmentCount: 0, inspectionCount: 0, outboxCount: 0, pendingSyncCount: 0 };
  }
}
