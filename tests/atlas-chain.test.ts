import { describe, expect, it, vi } from 'vitest';

import { createAtlasChainReader } from '../server/atlas/chain';

describe('NIM Atlas canonical chain reader', () => {
  it('reads a transaction and computes confirmations from the canonical head', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'getTransactionByHash') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {
          hash: 'lookup-1', blockHeight: 41, sender: 'NQFROM', recipient: 'NQTO', value: 100_000,
          network: 'testalbatross', success: true, canonical: true,
        } }));
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: 45 } }));
    });
    const reader = createAtlasChainReader({ network: 'testalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl });

    await expect(reader.observe('lookup-1')).resolves.toEqual({
      lookup: 'lookup-1', network: 'testalbatross', sender: 'NQFROM', recipient: 'NQTO', valueLuna: 100_000,
      success: true, canonical: true, confirmations: 5, blockHeight: 41,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails over and never turns an RPC error into payment evidence', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).includes('bad')) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1 } }));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { data: {
        hash: 'lookup-2', blockHeight: 7, sender: 'NQFROM', recipient: 'NQTO', value: 100_000,
        network: 'testalbatross', success: true, canonical: true, confirmations: 3,
      } } }));
    });
    const reader = createAtlasChainReader({ network: 'testalbatross', rpcUrls: ['https://bad.rpc', 'https://good.rpc'], minConfirmations: 3, fetchImpl });

    await expect(reader.observe('lookup-2')).resolves.toMatchObject({ lookup: 'lookup-2', confirmations: 3 });
    await expect(reader.observe('bad lookup')).resolves.toBeNull();
  });
});

/*
 * Network verification. The reader used to stamp observation.network with
 * whatever the caller configured, without ever asking the RPC which chain it
 * was on. orders.reconcile() then compared evidence.network against
 * order.network, but both were copies of the same configured string, so a
 * deployment that pointed a mainnet config at a testnet RPC passed every guard
 * while settling real money on practice evidence.
 *
 * The fingerprint is the genesis block, fetched with getBlockByNumber [0,
 * false]. Its hash is network specific and constant, and the operator can
 * check the expected value against a block explorer. The hashes are supplied
 * by configuration rather than hardcoded here, because inventing a genesis
 * hash would be exactly the unverified assertion this guards against.
 */
describe('NIM Atlas chain reader network verification', () => {
  const transaction = {
    hash: 'lookup-1', blockHeight: 41, sender: 'NQFROM', recipient: 'NQTO', value: 100_000,
    success: true, canonical: true, confirmations: 9,
  };

  function readerWith(genesisHash: string | undefined, actualGenesis: string) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      calls.push(body.method);
      if (body.method === 'getBlockByNumber') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: 0, hash: actualGenesis } }));
      if (body.method === 'getTransactionByHash') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: transaction }));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: 60 } }));
    });
    const reader = createAtlasChainReader({
      network: 'mainalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl,
      expectedGenesisHash: genesisHash,
    });
    return { reader, calls, fetchImpl };
  }

  /*
   * This is the case the harness above could not see. It answered
   * getBlockByNumber for any height, so nothing noticed that the reader asked
   * for block 0 — and Albatross has no block 0. It began at the
   * Proof-of-Stake migration, so mainnet's genesis is the macro block at
   * 3456000 (nimiq/core-rs-albatross, genesis/src/genesis/main-albatross.toml).
   * Every real node answers "Block not found: 0", so verification stayed
   * `unchecked` forever and every observation was withheld. Mainnet payouts
   * could never have worked.
   */
  it('asks for the height mainnet genesis actually lives at', async () => {
    const requested: unknown[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      if (body.method === 'getBlockByNumber') {
        requested.push(body.params[0]);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: body.params[0], hash: 'main-genesis' } }));
      }
      if (body.method === 'getTransactionByHash') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: transaction }));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: 3_456_060 } }));
    });
    const reader = createAtlasChainReader({
      network: 'mainalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl,
      expectedGenesisHash: 'main-genesis',
    });
    await reader.observe('lookup-height');
    expect(requested).toContain(3_456_000);
    expect(requested, 'asked for block 0, which Albatross does not have').not.toContain(0);
    expect(reader.networkVerification()).toBe('verified');
  });

  it('lets a caller pin a different genesis height', async () => {
    const requested: unknown[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      if (body.method === 'getBlockByNumber') {
        requested.push(body.params[0]);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: body.params[0], hash: 'pinned' } }));
      }
      if (body.method === 'getTransactionByHash') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: transaction }));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: 99 } }));
    });
    const reader = createAtlasChainReader({
      network: 'mainalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl,
      expectedGenesisHash: 'pinned', genesisBlockNumber: 42,
    });
    await reader.observe('lookup-pinned');
    expect(requested).toContain(42);
  });

  it('yields no evidence when the RPC is on a different chain than configured', async () => {
    const { reader, calls } = readerWith('aaaa-main-genesis', 'bbbb-test-genesis');
    await expect(reader.observe('lookup-1')).resolves.toBeNull();
    expect(reader.networkVerification()).toBe('rejected');
    expect(calls, 'the transaction was fetched despite a failed network check').not.toContain('getTransactionByHash');
  });

  it('observes normally once the genesis hash matches', async () => {
    const { reader } = readerWith('aaaa-main-genesis', 'aaaa-main-genesis');
    await expect(reader.observe('lookup-1')).resolves.toMatchObject({ lookup: 'lookup-1', network: 'mainalbatross', confirmations: 9 });
    expect(reader.networkVerification()).toBe('verified');
  });

  it('checks genesis once rather than on every observation', async () => {
    const { reader, calls } = readerWith('aaaa-main-genesis', 'aaaa-main-genesis');
    await reader.observe('lookup-1');
    await reader.observe('lookup-1');
    await reader.observe('lookup-1');
    expect(calls.filter((method) => method === 'getBlockByNumber')).toHaveLength(1);
  });

  it('compares the genesis hash without case sensitivity', async () => {
    const { reader } = readerWith('AAAA-MAIN-GENESIS', 'aaaa-main-genesis');
    await expect(reader.observe('lookup-1')).resolves.toMatchObject({ lookup: 'lookup-1' });
  });

  it('stays unconfigured, and permissive, when no genesis hash is supplied', async () => {
    const { reader, calls } = readerWith(undefined, 'anything');
    await expect(reader.observe('lookup-1')).resolves.toMatchObject({ lookup: 'lookup-1' });
    expect(reader.networkVerification()).toBe('unconfigured');
    expect(calls).not.toContain('getBlockByNumber');
  });

  it('withholds evidence but stays retryable when the genesis fetch fails', async () => {
    let failGenesis = true;
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'getBlockByNumber') {
        if (failGenesis) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1 } }));
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: 0, hash: 'aaaa' } }));
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: transaction }));
    });
    const reader = createAtlasChainReader({
      network: 'mainalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl,
      expectedGenesisHash: 'aaaa',
    });

    // A transient RPC failure is not evidence of a wrong chain, so it must not
    // latch a rejection the way a real mismatch does.
    await expect(reader.observe('lookup-1')).resolves.toBeNull();
    expect(reader.networkVerification()).toBe('unchecked');
    failGenesis = false;
    await expect(reader.observe('lookup-1')).resolves.toMatchObject({ lookup: 'lookup-1' });
    expect(reader.networkVerification()).toBe('verified');
  });
});

/*
 * Reading the treasury's balance, so the daily pot is capped by what exists.
 *
 * Null means "unknown", never "empty": a caller that sizes a reward pot from
 * this would otherwise stop paying every time an RPC blinked.
 */
describe('the treasury balance', () => {
  const TREASURY = 'NQ21YC9EFUGGC7LN172X3877CF7AVEJB78EF';
  const ok = (result: unknown) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) }) as unknown as Response;

  it('reads a balance in Luna through the nested data envelope', async () => {
    const fetchImpl = async () => ok({ data: { address: TREASURY, balance: 3338, type: 'basic' } });
    const reader = createAtlasChainReader({ network: 'testalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl });
    expect(await reader.balanceOf(TREASURY)).toBe(3338);
  });

  it('accepts an address written with the spaces Nimiq displays', async () => {
    const fetchImpl = async () => ok({ data: { balance: 7 } });
    const reader = createAtlasChainReader({ network: 'testalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl });
    expect(await reader.balanceOf('NQ21 YC9E FUGG C7LN 172X 3877 CF7A VEJB 78EF')).toBe(7);
  });

  it('reports unknown rather than empty when every reader fails', async () => {
    const fetchImpl = async () => { throw new Error('offline'); };
    const reader = createAtlasChainReader({ network: 'testalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl });
    expect(await reader.balanceOf(TREASURY)).toBeNull();
  });

  it('refuses to read a balance off a chain it has rejected', async () => {
    const fetchImpl = async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'getBlockByNumber') return ok({ data: { hash: 'deadbeef' } });
      return ok({ data: { balance: 999 } });
    };
    const reader = createAtlasChainReader({
      network: 'mainalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 10,
      fetchImpl, expectedGenesisHash: '968f7ad96731644edd4949961ae186ae832ddbb79284db1069799d66ae5bfd06',
    });
    expect(await reader.balanceOf(TREASURY)).toBeNull();
    expect(reader.networkVerification()).toBe('rejected');
  });

  it('refuses an address that is not a Nimiq address', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return ok({ data: { balance: 1 } }); };
    const reader = createAtlasChainReader({ network: 'testalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl });
    expect(await reader.balanceOf('not-an-address')).toBeNull();
    expect(called).toBe(false);
  });
});
