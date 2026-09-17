import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createAtlasJsonRepository, createAtlasStateStore, type AtlasStateStore } from '../server/atlas/persistence';
import { createAtlasPayoutService } from '../server/atlas/payouts';

/*
 * The Atlas payout ledger lived in a bare Map, so a restart erased every row
 * including rows already marked 'verified'. create() refuses a duplicate id,
 * which is the guard against paying the same reward twice, but that guard is
 * only worth anything if the ledger outlives the process. Without persistence
 * a redeploy made every settled payout payable again, out of a real treasury.
 *
 * These tests use a real state store over a temp directory rather than a fake,
 * because the failure being guarded against is a restart, and a fake that
 * keeps its contents in the same process cannot reproduce one.
 */
const directories: string[] = [];

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function stateStore(): Promise<AtlasStateStore> {
  const directory = await mkdtemp(join(tmpdir(), 'sface-atlas-payouts-'));
  directories.push(directory);
  return createAtlasStateStore(createAtlasJsonRepository({ directory }));
}

const TREASURY = 'NQLOCAL_TREASURY';
const WINNER = 'NQWINNER';
const AMOUNT = 300_000_000;

function service(store: AtlasStateStore | undefined, confirmations = 3) {
  return createAtlasPayoutService({
    network: 'testalbatross',
    treasuryAddress: TREASURY,
    minConfirmations: 3,
    stateStore: store,
    chain: {
      observe: async (lookup) => ({
        lookup, network: 'testalbatross', blockHeight: 10, confirmations,
        sender: TREASURY, recipient: WINNER, valueLuna: AMOUNT, success: true, canonical: true,
      }),
    },
  });
}

describe('NIM Atlas payout ledger durability', () => {
  it('keeps a drafted payout across a restart', async () => {
    const store = await stateStore();
    await service(store).create({ id: 'payout-1', period: '2026-09-10', walletAddress: WINNER, amountLuna: AMOUNT });

    const restarted = service(store);
    await expect(restarted.list()).resolves.toMatchObject([{ id: 'payout-1', status: 'draft', amountLuna: AMOUNT }]);
  });

  it('refuses to recreate a payout that a previous process already verified', async () => {
    const store = await stateStore();
    const before = service(store);
    await before.create({ id: 'payout-2', period: '2026-09-10', walletAddress: WINNER, amountLuna: AMOUNT });
    await before.approve('payout-2');
    await before.recordSubmitted('payout-2', 'hash-verified');
    await expect(before.reconcile('payout-2')).resolves.toMatchObject({ status: 'verified' });

    // This is the whole point. A restart used to make the settled row payable
    // again, so the treasury would pay the same reward a second time.
    const after = service(store);
    await expect(after.create({ id: 'payout-2', period: '2026-09-10', walletAddress: WINNER, amountLuna: AMOUNT }))
      .rejects.toThrow(/already exists/i);
    await expect(after.list()).resolves.toMatchObject([{ id: 'payout-2', status: 'verified', transactionHash: 'hash-verified' }]);
  });

  it('keeps a submitted payout reconcilable after a restart', async () => {
    const store = await stateStore();
    const before = service(store);
    await before.create({ id: 'payout-3', period: '2026-09-10', walletAddress: WINNER, amountLuna: AMOUNT });
    await before.approve('payout-3');
    await before.recordSubmitted('payout-3', 'hash-pending');

    const after = service(store);
    await expect(after.reconcile('payout-3')).resolves.toMatchObject({ status: 'verified' });
  });

  it('rejects a duplicate transaction hash against a row loaded from disk', async () => {
    const store = await stateStore();
    const before = service(store);
    await before.create({ id: 'payout-4a', period: '2026-09-10', walletAddress: WINNER, amountLuna: AMOUNT });
    await before.approve('payout-4a');
    await before.recordSubmitted('payout-4a', 'hash-shared');

    const after = service(store);
    await after.create({ id: 'payout-4b', period: '2026-09-10', walletAddress: WINNER, amountLuna: AMOUNT });
    await after.approve('payout-4b');
    await expect(after.recordSubmitted('payout-4b', 'hash-shared')).rejects.toThrow(/duplicate/i);
  });

  it('latches hydration only after a load succeeds, so a transient read cannot blank the ledger', async () => {
    const store = await stateStore();
    await service(store).create({ id: 'payout-5', period: '2026-09-10', walletAddress: WINNER, amountLuna: AMOUNT });

    /*
     * The shape of a transient disk error on boot. server/atlas/orders.ts paid
     * for this exact bug once: it latched hydrated before awaiting the load, so
     * one failed read reported the store hydrated forever, the next write ran
     * against an empty map, and save() flattened the real ledger.
     */
    let reads = 0;
    const flaky: AtlasStateStore = {
      // A transaction on a double isolates within this process, which is all
      // there is to isolate when nothing else is writing.
      transact: (operation) => operation({ load: (key, fallback) => store.load(key, fallback), save: (key, value) => { void store.save(key, value); } }),
      async load(key, fallback) {
        reads += 1;
        if (reads === 1) throw new Error('Atlas state store read failed transiently.');
        return store.load(key, fallback);
      },
      save(key, value) { return store.save(key, value); },
    };

    const restarted = service(flaky);
    await expect(restarted.list()).rejects.toThrow(/transiently/i);
    await expect(restarted.list()).resolves.toMatchObject([{ id: 'payout-5' }]);

    await restarted.create({ id: 'payout-6', period: '2026-09-10', walletAddress: WINNER, amountLuna: AMOUNT });
    const reopened = service(store);
    const ids = (await reopened.list()).map((payout) => payout.id).sort();
    expect(ids, 'the earlier row was overwritten by an unhydrated write').toEqual(['payout-5', 'payout-6']);
  });

  it('still works entirely in memory when no state store is configured', async () => {
    const ephemeral = service(undefined);
    await ephemeral.create({ id: 'payout-7', period: '2026-09-10', walletAddress: WINNER, amountLuna: AMOUNT });
    await expect(ephemeral.list()).resolves.toHaveLength(1);
    await expect(service(undefined).list()).resolves.toHaveLength(0);
  });
});
