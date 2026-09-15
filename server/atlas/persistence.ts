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
  load(): Promise<{ snapshot: AtlasRepositorySnapshot | null; recoveredFromBackup: boolean }>;
  listBackups(): Promise<Array<{ name: string; sizeBytes: number; modifiedAt: number }>>;
}

export interface AtlasStateStore {
  load<T>(key: string, fallback: T): Promise<T>;
  save<T>(key: string, value: T): Promise<void>;
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
  };

  async function saveSnapshot(snapshot: AtlasRepositorySnapshot): Promise<void> {
    assertSnapshot(snapshot);
    await mkdir(directory, { recursive: true });
    await withLock(async () => {
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
    });
  }

  async function withLock(operation: () => Promise<void>): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await mkdir(lockPath);
        try { await writeFile(join(lockPath, 'owner'), `${process.pid}\n`, 'utf8'); } catch { /* lock existence is sufficient */ }
        try { await operation(); } finally { await rm(lockPath, { recursive: true, force: true }); }
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const details = await stat(lockPath);
          if (Date.now() - details.mtimeMs > lockStaleMs) await rm(lockPath, { recursive: true, force: true });
        } catch { /* another writer may have released it */ }
        await delay(5);
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
