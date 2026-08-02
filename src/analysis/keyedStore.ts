// Shared machinery behind the two on-device keyed stores — learnedWeightsStore
// (localStorage, sync) and sampleStore (IndexedDB, async). They keep separate
// public interfaces on purpose: loadWeights is SYNC and called inside Vue
// computeds, so the two cannot unify behind one async facade. Only the plumbing
// is shared, so it can't drift between them.
//
// Record-level versioning: each value is persisted inside an envelope
// { v, data }. A record with no envelope is an older device that stored the bare
// value — read as v0 and passed through `migrate`, which returns the upgraded
// value or null to drop it. The IndexedDB *database* version stays 1; this
// record-level `v` is a separate, finer-grained concept.

/** The persisted wrapper. `v` is the record schema version; `data` the payload. */
interface Envelope<T> {
  v: number;
  data: T;
}

/** Upgrade a stored value read at `fromVersion` to the current shape, or return
 *  null to drop it as unreadable. A bare (un-enveloped) legacy record is passed
 *  in at `fromVersion === 0`. */
export type Migrate<T> = (data: unknown, fromVersion: number) => T | null;

export interface KeyedStoreOptions<T> {
  /** Current record schema version stamped on writes. */
  version: number;
  /** Applied on read to records stamped below `version` (and to bare legacy
   *  records, at version 0). Defaults to an identity pass-through — appropriate
   *  while every historical shape is still structurally compatible. */
  migrate?: Migrate<T>;
}

const identityMigrate: Migrate<unknown> = (data) => data;

/** Type guard for the envelope shape, so a bare legacy value is distinguishable
 *  from an enveloped one. */
function isEnvelope(raw: unknown): raw is Envelope<unknown> {
  return typeof raw === "object" && raw !== null && "v" in raw && "data" in raw && typeof (raw as { v: unknown }).v === "number";
}

/** Unwrap a parsed record: run its migration if it is older / un-enveloped,
 *  returning the current-shape value or null when unreadable. */
function unwrap<T>(parsed: unknown, version: number, migrate: Migrate<T>): T | null {
  if (isEnvelope(parsed)) {
    if (parsed.v >= version) return parsed.data as T;
    return migrate(parsed.data, parsed.v);
  }
  // Bare value from before record versioning existed → treat as v0.
  return migrate(parsed, 0);
}

export interface LocalKeyedStore<T> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  remove(key: string): void;
  /** Every stored entry under the prefix, with the prefix stripped from `key`. */
  list(): { key: string; value: T }[];
}

/** A synchronous, prefix-scoped localStorage store with the shared codec +
 *  record versioning. Owns the `typeof localStorage === "undefined"` guard, so
 *  callers never repeat it. */
export function createLocalKeyedStore<T>({ prefix, version, migrate = identityMigrate as Migrate<T> }: KeyedStoreOptions<T> & { prefix: string }): LocalKeyedStore<T> {
  const available = (): boolean => typeof localStorage !== "undefined";

  const parse = (raw: string | null): T | null => {
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    return unwrap(parsed, version, migrate);
  };

  return {
    get(key) {
      if (!available()) return null;
      return parse(localStorage.getItem(prefix + key));
    },
    set(key, value) {
      if (!available()) return;
      const envelope: Envelope<T> = { v: version, data: value };
      localStorage.setItem(prefix + key, JSON.stringify(envelope));
    },
    remove(key) {
      if (!available()) return;
      localStorage.removeItem(prefix + key);
    },
    list() {
      if (!available()) return [];
      const out: { key: string; value: T }[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(prefix)) continue;
        const value = parse(localStorage.getItem(k));
        if (value !== null) out.push({ key: k.slice(prefix.length), value });
      }
      return out;
    },
  };
}

export interface IdbKeyedStore<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<T[]>;
}

/** A record inside the object store: the primary key plus the value envelope.
 *  The envelope carries the record-level version; the object store's key path is
 *  `key`. */
interface IdbRecord<T> {
  key: string;
  v: number;
  data: T;
}

/** An asynchronous, single-object-store IndexedDB store with the shared codec +
 *  record versioning. Owns openDb / transaction / close boilerplate and the
 *  availability guard. The IDB database version is fixed at 1; the per-record
 *  `v` is the separate schema version this store stamps and migrates. */
export function createIdbKeyedStore<T>({
  dbName,
  storeName,
  version,
  migrate = identityMigrate as Migrate<T>,
}: KeyedStoreOptions<T> & { dbName: string; storeName: string }): IdbKeyedStore<T> {
  const available = (): boolean => typeof indexedDB !== "undefined";

  const openDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.addEventListener("upgradeneeded", () => {
        if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName, { keyPath: "key" });
      });
      req.addEventListener("success", () => resolve(req.result));
      req.addEventListener("error", () => reject(req.error ?? new Error("indexedDB open failed")));
    });

  /** Migrate a raw stored record to the current-shape value, or null to drop it.
   *  Records written before this envelope existed lack `v`/`data` and stored the
   *  payload under a store-specific field — the caller's migrate handles that
   *  legacy shape via the whole-record fallback below. */
  const unwrapRecord = (rec: IdbRecord<T> | undefined): T | null => {
    if (rec === undefined) return null;
    if (typeof rec.v === "number" && "data" in rec) {
      if (rec.v >= version) return rec.data;
      return migrate(rec.data, rec.v);
    }
    // A pre-envelope record: pass the whole record (minus its key) to migrate at
    // v0 so the store owner can lift its old field into the new shape.
    return migrate(rec, 0);
  };

  return {
    async get(key) {
      if (!available()) return null;
      const db = await openDb();
      try {
        const rec = await new Promise<IdbRecord<T> | undefined>((resolve, reject) => {
          const req = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
          req.addEventListener("success", () => resolve(req.result as IdbRecord<T> | undefined));
          req.addEventListener("error", () => reject(req.error ?? new Error("indexedDB get failed")));
        });
        return unwrapRecord(rec);
      } finally {
        db.close();
      }
    },
    async set(key, value) {
      if (!available()) return;
      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          const record: IdbRecord<T> = { key, v: version, data: value };
          tx.objectStore(storeName).put(record);
          tx.addEventListener("complete", () => resolve());
          tx.addEventListener("error", () => reject(tx.error ?? new Error("indexedDB put failed")));
        });
      } finally {
        db.close();
      }
    },
    async remove(key) {
      if (!available()) return;
      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).delete(key);
          tx.addEventListener("complete", () => resolve());
          tx.addEventListener("error", () => reject(tx.error ?? new Error("indexedDB delete failed")));
        });
      } finally {
        db.close();
      }
    },
    async list() {
      if (!available()) return [];
      const db = await openDb();
      try {
        const recs = await new Promise<IdbRecord<T>[]>((resolve, reject) => {
          const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
          req.addEventListener("success", () => resolve(req.result as IdbRecord<T>[]));
          req.addEventListener("error", () => reject(req.error ?? new Error("indexedDB getAll failed")));
        });
        const out: T[] = [];
        for (const rec of recs) {
          const value = unwrapRecord(rec);
          if (value !== null) out.push(value);
        }
        return out;
      } finally {
        db.close();
      }
    },
  };
}
