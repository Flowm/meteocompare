// A tiny in-memory IndexedDB stand-in for the store tests — jsdom ships no
// IndexedDB. Implements only the surface createIdbKeyedStore touches: open (with
// a one-shot upgradeneeded), a keyPath object store, and get/put/delete/getAll
// over a transaction. NOT spec-complete; test support only, but kept out of the
// *.test.ts glob so it can be shared and is still type-checked.

type EventType = "success" | "error" | "upgradeneeded" | "complete";

interface FakeRequest<T> {
  result: T;
  error: unknown;
  addEventListener(type: EventType, cb: () => void): void;
}

function makeRequest<T>(result: T): FakeRequest<T> {
  const listeners: Partial<Record<EventType, () => void>> = {};
  const req: FakeRequest<T> = {
    result,
    error: null,
    addEventListener(type, cb) {
      listeners[type] = cb;
      // Fire on the next microtask — after the caller has attached all its
      // listeners synchronously — mirroring IDB's async request completion.
      if (type === "success") queueMicrotask(() => cb());
    },
  };
  return req;
}

class FakeObjectStore {
  constructor(
    private data: Map<string, unknown>,
    private onWrite: () => void,
  ) {}

  get(key: string): FakeRequest<unknown> {
    return makeRequest<unknown>(this.data.get(key));
  }

  getAll(): FakeRequest<unknown[]> {
    return makeRequest<unknown[]>([...this.data.values()]);
  }

  put(record: { key: string }): void {
    this.data.set(record.key, record);
    this.onWrite();
  }

  delete(key: string): void {
    this.data.delete(key);
    this.onWrite();
  }
}

class FakeTransaction {
  error: unknown = null;
  private completeCb?: () => void;

  constructor(private data: Map<string, unknown>) {}

  addEventListener(type: EventType, cb: () => void): void {
    if (type === "complete") this.completeCb = cb;
  }

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.data, () => queueMicrotask(() => this.completeCb?.()));
  }
}

class FakeDatabase {
  objectStoreNames = { contains: (name: string): boolean => this.stores.has(name) };

  constructor(private stores: Map<string, Map<string, unknown>>) {}

  createObjectStore(name: string): void {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
  }

  transaction(storeName: string): FakeTransaction {
    return new FakeTransaction(this.stores.get(storeName) ?? new Map());
  }

  close(): void {
    /* no-op */
  }
}

export class FakeIDBFactory {
  private stores = new Map<string, Map<string, unknown>>();

  /** Plant records directly into a store — used to seed legacy (pre-envelope) rows. */
  seed(storeName: string, records: { key: string; value: unknown }[]): void {
    const map = this.stores.get(storeName) ?? new Map<string, unknown>();
    for (const r of records) map.set(r.key, r.value);
    this.stores.set(storeName, map);
  }

  open(): FakeRequest<FakeDatabase> {
    const db = new FakeDatabase(this.stores);
    const pending: Partial<Record<EventType, () => void>> = {};
    const req: FakeRequest<FakeDatabase> = {
      result: db,
      error: null,
      addEventListener(type, cb) {
        pending[type] = cb;
        // openDb attaches upgradeneeded then success synchronously; once success
        // is registered we know both are in place, so fire upgradeneeded then
        // success on the next microtask (order matters — the store is created in
        // upgradeneeded before the caller resolves on success).
        if (type === "success") {
          queueMicrotask(() => {
            pending.upgradeneeded?.();
            pending.success?.();
          });
        }
      },
    };
    return req;
  }
}

/** Swap the global indexedDB for a fresh fake for the duration of a test.
 *  Returns the factory (to seed legacy data) and a restore fn. */
export function installFakeIndexedDB(): { factory: FakeIDBFactory; restore: () => void } {
  const factory = new FakeIDBFactory();
  const prev = (globalThis as { indexedDB?: unknown }).indexedDB;
  (globalThis as { indexedDB?: unknown }).indexedDB = factory;
  return {
    factory,
    restore: () => {
      (globalThis as { indexedDB?: unknown }).indexedDB = prev;
    },
  };
}
