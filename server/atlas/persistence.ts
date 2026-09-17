import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, basename } from 'node:path';

export interface AtlasRepositorySnapshot {
  version: 1;
  updatedAt: number;
  records: Record<string, unknown>;
}

export interface AtlasPersistenceHooks {
  afterTempWrite?: () => void | Promise<void>;
  beforeRename?: () => void | Promise<void>;
}

export interface AtlasRepository {
  readonly snapshotPath: string;
  readonly lockPath: string;
  save(snapshot: AtlasRepositorySnapshot): Promise<void>;
  /**
   * Run an operation with the repository's cross-process lock held.
   *
   * The lock is a directory created with mkdir, which is atomic on every
   * filesystem this runs on, with a stale-lock recovery for a writer that died
   * holding it. Saving already takes it; this exposes it so a read-modify-write
   * can hold it across both halves.
   *
   * Without this, two processes that both read "seat 1 is free" both write
   * their own rider into it, and the second save erases the first. A promise
   * queue cannot fix that, because each process has its own queue.
   */
  transact<T>(operation: (write: (snapshot: AtlasRepositorySnapshot) => Promise<void>) => Promise<T>): Promise<T>;
  load(): Promise<{ snapshot: AtlasRepositorySnapshot | null; recoveredFromBackup: boolean }>;
  listBackups(): Promise<Array<{ name: string; sizeBytes: number; modifiedAt: number }>>;
}

export interface AtlasStateStore {
  load<T>(key: string, fallback: T): Promise<T>;
  save<T>(key: string, value: T): Promise<void>;
  /**
   * Read, decide and write as one indivisible step, across processes.
   *
   * `load` serves a cached copy, which is right for a projection that only this
   * process writes and wrong for anything another process may be changing at
   * the same moment. Inside a transaction the records are re-read from disk
   * first, so the decision is made against what is actually stored rather than
   * against what this process last saw.
   */
  transact<T>(operation: (records: {
    load<V>(key: string, fallback: V): Promise<V>;
    save<V>(key: string, value: V): void;
  }) => Promise<T>): Promise<T>;
}

/**
 * Keeps all Atlas projections inside one atomically replaced file while still
 * giving each service a narrow typed record. The store loads once, serializes
 * mutations, and writes the complete snapshot after every accepted change.
 */
export function createAtlasStateStore(repository: AtlasRepository, now: () => number = Date.now): AtlasStateStore & { initialise(): Promise<void> } {
  let records: Record<string, unknown> = {};
  let initialised = false;
  let operations: Promise<void> = Promise.resolve();

  async function initialise(): Promise<void> {
    if (initialised) return;
    const loaded = await repository.load();
    records = loaded?.snapshot?.records ?? {};
    initialised = true;
  }

  return {
    initialise,
    async load<T>(key: string, fallback: T): Promise<T> {
      await initialise();
      return structuredClone((records[key] as T | undefined) ?? fallback);
    },
    /*
     * The whole step under one lock.
     *
     * Re-reading from disk inside the lock is the part that makes this work
     * across processes: this process's cache may be several writes behind
     * another instance, and deciding from a stale cache is exactly the bug the
     * lock is here to prevent.
     */
    transact<T>(operation: (records: { load<V>(key: string, fallback: V): Promise<V>; save<V>(key: string, value: V): void }) => Promise<T>): Promise<T> {
      const run = async (): Promise<T> => repository.transact(async (write) => {
        const loaded = await repository.load();
        const fresh: Record<string, unknown> = loaded?.snapshot?.records ?? {};
        let dirty = false;
        const result = await operation({
          load: async <V,>(key: string, fallback: V) => structuredClone((fresh[key] as V | undefined) ?? fallback),
          save: <V,>(key: string, value: V) => { fresh[key] = structuredClone(value); dirty = true; },
        });
        // A transaction that only read costs no write, which matters because
        // every save rewrites the whole snapshot.
        if (dirty) await write({ version: 1, updatedAt: now(), records: fresh });
        records = fresh;
        initialised = true;
        return result;
      });
      // Chained behind this process's own writes so a transaction cannot
      // interleave with a save that is already in flight here.
      const next = operations.catch(() => undefined).then(run);
      operations = next.then(() => undefined, () => undefined);
      return next;
    },
    save<T>(key: string, value: T): Promise<void> {
      operations = operations.catch(() => undefined).then(async () => {
        await initialise();
        const candidate = { ...records, [key]: structuredClone(value) };
        await repository.save({ version: 1, updatedAt: now(), records: candidate });
        // A failed write must not leak into a later save by another service.
        records = candidate;
      });
      return operations;
    },
  };
}

export function createAtlasJsonRepository(options: {
  directory?: string;
  now?: () => number;
  lockStaleMs?: number;
  hooks?: AtlasPersistenceHooks;
} = {}): AtlasRepository {
  const directory = options.directory ?? join(process.cwd(), '.data', 'atlas');
  const snapshotPath = join(directory, 'atlas.json');
  const lockPath = `${snapshotPath}.lock`;
  /*
   * How deep this process is inside its own lock.
   *
   * A transaction takes the lock and then saves, and saving takes the lock as
   * well. Without this count the second acquire would find the directory this
   * same process created, wait for it to be released, and deadlock.
   */
  if (basename(snapshotPath) === 'sface.json') throw new Error('Atlas repository cannot use the legacy snapshot path.');
  const now = options.now ?? Date.now;
  const lockStaleMs = options.lockStaleMs ?? 30_000;
  let writes: Promise<void> = Promise.resolve();
  return {
    snapshotPath,
    lockPath,
    save(snapshot) {
      writes = writes.catch(() => undefined).then(() => saveSnapshot(snapshot));
      return writes;
    },
    async load() {
      const direct = await readValid(snapshotPath);
      if (direct) return { snapshot: direct, recoveredFromBackup: false };
      const missing = await fileMissing(snapshotPath);
      if (missing) return { snapshot: null, recoveredFromBackup: false };
      for (const backup of await listBackupsInternal()) {
        const recovered = await readValid(join(directory, backup.name));
        if (recovered) return { snapshot: recovered, recoveredFromBackup: true };
      }
      throw new Error('Atlas repository has no valid snapshot or backup.');
    },
    listBackups: listBackupsInternal,
    /*
     * The lock, for callers who have to decide something between reading and
     * writing. Seats are the reason this exists: two processes that both read
     * "seat 1 is free" would both take it, and no amount of in-process
     * sequencing can prevent that.
     */
    /*
     * The lock, for callers who decide something between reading and writing.
     * The operation is handed the writer because the lock is already held: a
     * nested save would otherwise wait for a lock its own caller owns.
     */
    transact: <T,>(operation: (write: (snapshot: AtlasRepositorySnapshot) => Promise<void>) => Promise<T>) => withLock(async () => {
      await mkdir(directory, { recursive: true });
      return operation(async (snapshot) => { assertSnapshot(snapshot); await writeSnapshot(snapshot); });
    }),
  };

  async function saveSnapshot(snapshot: AtlasRepositorySnapshot): Promise<void> {
    assertSnapshot(snapshot);
    await mkdir(directory, { recursive: true });
    await withLock(() => writeSnapshot(snapshot));
  }

  /** The write itself, with the lock assumed to be held by the caller. */
  async function writeSnapshot(snapshot: AtlasRepositorySnapshot): Promise<void> {
    {
      try {
        if (await exists(snapshotPath)) await copyFile(snapshotPath, `${snapshotPath}.${now()}.bak`);
        const temporaryPath = `${snapshotPath}.${process.pid}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporaryPath, 'w');
          try {
            await handle.writeFile(JSON.stringify(snapshot), 'utf8');
            await handle.sync();
          } finally {
            await handle.close();
          }
          await options.hooks?.afterTempWrite?.();
          await options.hooks?.beforeRename?.();
          await rename(temporaryPath, snapshotPath);
          await flushDirectory(directory);
        } finally {
          await rm(temporaryPath, { force: true }).catch(() => undefined);
        }
      } catch (error) {
        throw error;
      }
    }
  }

  /*
   * Wait long enough for a real queue.
   *
   * Forty tries five milliseconds apart gave a writer a fifth of a second to
   * get in, which is fine when nothing else is writing and not fine when seven
   * riders claim a seat at once: each write copies a backup, fsyncs a
   * temporary file and renames it, and on a loaded machine that is tens of
   * milliseconds each. The old budget expired under exactly the contention
   * this lock exists for, and reported the store as busy.
   *
   * The backoff climbs so a long queue does not spin the disk while it waits.
   */
  async function withLock<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      try {
        await mkdir(lockPath);
        try { await writeFile(join(lockPath, 'owner'), `${process.pid}\n`, 'utf8'); } catch { /* lock existence is sufficient */ }
        try { return await operation(); } finally { await rm(lockPath, { recursive: true, force: true }); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const details = await stat(lockPath);
          if (Date.now() - details.mtimeMs > lockStaleMs) await rm(lockPath, { recursive: true, force: true });
        } catch { /* another writer may have released it */ }
        await delay(Math.min(25, 4 + attempt));
      }
    }
    throw new Error('Atlas repository lock is busy.');
  }

  async function listBackupsInternal(): Promise<Array<{ name: string; sizeBytes: number; modifiedAt: number }>> {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const backups: Array<{ name: string; sizeBytes: number; modifiedAt: number }> = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.startsWith('atlas.json.') || !entry.name.endsWith('.bak')) continue;
        const details = await stat(join(directory, entry.name));
        backups.push({ name: entry.name, sizeBytes: details.size, modifiedAt: details.mtimeMs });
      }
      return backups.sort((left, right) => right.modifiedAt - left.modifiedAt);
    } catch { return []; }
  }

  async function readValid(path: string): Promise<AtlasRepositorySnapshot | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!isSnapshot(parsed)) return null;
      return structuredClone(parsed);
    } catch { return null; }
  }
}

function assertSnapshot(value: AtlasRepositorySnapshot): void {
  if (!isSnapshot(value)) throw new Error('Atlas repository snapshot is invalid.');
}

function isSnapshot(value: unknown): value is AtlasRepositorySnapshot {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as { version?: unknown }).version === 1 && Number.isSafeInteger((value as { updatedAt?: unknown }).updatedAt) && (value as { records?: unknown }).records && typeof (value as { records?: unknown }).records === 'object' && !Array.isArray((value as { records?: unknown }).records));
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function fileMissing(path: string): Promise<boolean> {
  try { await stat(path); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
}

async function flushDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(dirname(join(directory, 'child')), 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch { /* Windows does not expose directory fsync; rename remains atomic. */ }
}

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

/**
 * Give a plain load/save pair the transaction the interface requires.
 *
 * For an in-memory store - a test double, or anything that is the only writer
 * of its own data - serialising the operations in this process is the whole of
 * what a transaction has to mean, because there is no second process to race
 * with. The real file-backed store needs more, and does more: it takes the
 * repository's cross-process lock and re-reads from disk.
 *
 * This exists so a double cannot accidentally satisfy the type with a
 * transaction that does not actually isolate anything.
 */
export function withStateTransactions(store: Pick<AtlasStateStore, 'load' | 'save'>): AtlasStateStore {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    load: store.load,
    save: store.save,
    transact<T>(operation: (records: { load<V>(key: string, fallback: V): Promise<V>; save<V>(key: string, value: V): void }) => Promise<T>): Promise<T> {
      const run = async (): Promise<T> => {
        /*
         * Writes are held until the operation succeeds, so a failure part way
         * through leaves nothing half-applied.
         */
        const writes = new Map<string, unknown>();
        const result = await operation({
          load: async <V,>(key: string, fallback: V): Promise<V> => (writes.has(key) ? writes.get(key) as V : store.load(key, fallback)),
          save: <V,>(key: string, value: V): void => { writes.set(key, value); },
        });
        for (const [key, value] of writes) await store.save(key, value);
        return result;
      };
      const next = queue.catch(() => undefined).then(run);
      queue = next.then(() => undefined, () => undefined);
      return next;
    },
  };
}
