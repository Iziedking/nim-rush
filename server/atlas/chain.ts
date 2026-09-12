export interface AtlasChainObservation {
  lookup: string;
  network: 'testalbatross' | 'mainalbatross';
  blockHeight: number | null;
  confirmations: number;
  sender: string;
  recipient: string;
  valueLuna: number;
  success: boolean;
  canonical: boolean;
  reorgDetected?: boolean;
}

/**
 * Whether the configured RPC has been proved to be on the configured network.
 *
 * - `unconfigured`: no expected genesis hash was supplied, so nothing is
 *   checked. Permitted for practice networks, refused for mainnet by
 *   shared/atlas/payment-config.ts.
 * - `unchecked`: a hash was supplied but the genesis fetch has not succeeded
 *   yet. Withholds evidence and stays retryable, because a failed RPC is not
 *   evidence of a wrong chain.
 * - `verified`: the RPC returned the expected genesis hash.
 * - `rejected`: the RPC returned a different genesis hash. Latched, and no
 *   observation is ever returned again.
 */
export type AtlasChainNetworkVerification = 'unconfigured' | 'unchecked' | 'verified' | 'rejected';

export interface AtlasChainReader {
  observe(lookup: string): Promise<AtlasChainObservation | null>;
  networkVerification(): AtlasChainNetworkVerification;
  /**
   * Spendable balance of an address in Luna, or null when it cannot be read.
   *
   * Null is "unknown", never "empty": a failed RPC or an unproved chain must
   * not be reported as a drained treasury, because a caller that sizes a
   * reward pot from this would silently stop paying on a transient outage.
   */
  balanceOf(address: string): Promise<number | null>;
}

/**
 * What a consumer that only reads evidence needs.
 *
 * The network guard is enforced inside `observe`, which fails closed and
 * returns no evidence on a wrong chain, so callers do not have to remember to
 * check `networkVerification()`. Depending on this narrower type keeps them
 * honest about that and keeps their test doubles from having to implement a
 * method they never call.
 */
export type AtlasChainObserver = Pick<AtlasChainReader, 'observe'>;

interface RpcResponse { result?: unknown; error?: unknown; }
type AtlasFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function createAtlasChainReader(options: {
  network: 'testalbatross' | 'mainalbatross';
  rpcUrls: readonly string[];
  minConfirmations: number;
  fetchImpl?: AtlasFetch;
  timeoutMs?: number;
  /**
   * Genesis block hash the configured network must report.
   *
   * Supplied by configuration and checkable against a block explorer. It is
   * deliberately not hardcoded here: a genesis hash written from memory would
   * be precisely the unverified assertion this check exists to catch.
   */
  expectedGenesisHash?: string;
  /**
   * Height of the genesis macro block. Defaults per network; override only to
   * pin a chain whose migration height differs from the shipped default.
   */
  genesisBlockNumber?: number;
}): AtlasChainReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  /*
   * Height of the genesis macro block, by network. Mainnet's comes from
   * nimiq/core-rs-albatross genesis/src/genesis/main-albatross.toml; testnet
   * keeps the historical default until its own value is confirmed the same way.
   */
  const genesisBlockNumber = options.genesisBlockNumber ?? (options.network === 'mainalbatross' ? 3_456_000 : 0);
  const timeoutMs = options.timeoutMs ?? 5_000;
  const expectedGenesisHash = options.expectedGenesisHash?.trim().toLowerCase() || undefined;
  let verification: AtlasChainNetworkVerification = expectedGenesisHash ? 'unchecked' : 'unconfigured';
  return {
    networkVerification() {
      return verification;
    },
    async observe(lookup) {
      if (!/^[A-Za-z0-9._:-]{1,256}$/.test(lookup)) return null;
      /*
       * Prove the chain before reading anything off it. observation.network
       * used to be a copy of the configured string, and orders.reconcile()
       * compared it against another copy of the same string, so a config that
       * named mainnet while pointing at a testnet RPC satisfied every guard.
       */
      if (!(await verifyNetwork())) return null;
      for (const rpcUrl of options.rpcUrls) {
        try {
          const result = record(await rpc(fetchImpl, rpcUrl, 'getTransactionByHash', [lookup], timeoutMs));
          if (!result) continue;
          const blockHeight = integer(result.blockHeight ?? result.block_height);
          const hash = stringValue(result.hash ?? result.transactionHash) ?? lookup;
          const sender = stringValue(result.sender ?? result.from);
          const recipient = stringValue(result.recipient ?? result.to);
          const valueLuna = integer(result.value ?? result.valueLuna);
          const success = booleanOrStatus(result.success, result.status);
          const canonical = booleanOrStatus(result.canonical, result.isCanonical);
          if (!sender || !recipient || valueLuna === null || success === null || canonical === null) continue;
          const declaredConfirmations = integer(result.confirmations);
          let confirmations = declaredConfirmations ?? 0;
          if (declaredConfirmations === null && blockHeight !== null) {
            const head = record(await rpc(fetchImpl, rpcUrl, 'getLatestBlock', [false], timeoutMs));
            const headHeight = integer(head?.number ?? head?.height ?? head?.blockHeight);
            if (headHeight !== null) confirmations = Math.max(0, headHeight - blockHeight + 1);
          }
          const observation: AtlasChainObservation = { lookup: hash, network: options.network, blockHeight, confirmations, sender, recipient, valueLuna, success, canonical };
          if (result.reorgDetected === true) observation.reorgDetected = true;
          return observation;
        } catch {
          // A failed RPC is not evidence of a failed payment. Try the next configured reader.
        }
      }
      return null;
    },
    async balanceOf(address) {
      const normalised = address.replace(/\s/g, '').toUpperCase();
      if (!/^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(normalised)) return null;
      // Same guard as observe(): a balance read off an unproved chain is not
      // evidence about this chain's treasury.
      if (!(await verifyNetwork())) return null;
      for (const rpcUrl of options.rpcUrls) {
        try {
          const account = record(await rpc(fetchImpl, rpcUrl, 'getAccountByAddress', [normalised], timeoutMs));
          const balance = integer(account?.balance);
          if (balance === null) continue;
          return balance;
        } catch {
          // Try the next reader; an outage is not a zero balance.
        }
      }
      return null;
    },
  };

  async function verifyNetwork(): Promise<boolean> {
    if (verification === 'unconfigured' || verification === 'verified') return true;
    if (verification === 'rejected') return false;
    for (const rpcUrl of options.rpcUrls) {
      try {
        /*
         * The genesis block is not block 0 on Albatross.
         *
         * Albatross began at the Proof-of-Stake migration rather than from an
         * empty chain, so its genesis is the macro block at that height: 3456000
         * on mainnet, per `network = "MainAlbatross"` and `block_number` in
         * nimiq/core-rs-albatross genesis/src/genesis/main-albatross.toml.
         * Asking for block 0 gets "Block not found: 0" from every node, so this
         * check could never have succeeded on mainnet and the network would have
         * stayed `unchecked` forever, withholding every observation.
         *
         * Configurable because each network has its own height, and a node that
         * has pruned that far back cannot answer at all.
         */
        const genesis = record(await rpc(fetchImpl, rpcUrl, 'getBlockByNumber', [genesisBlockNumber, false], timeoutMs));
        const hash = stringValue(genesis?.hash)?.toLowerCase();
        if (!hash) continue;
        if (hash !== expectedGenesisHash) {
          // A wrong chain is a deployment fault, not a transient one. Latch it.
          verification = 'rejected';
          return false;
        }
        verification = 'verified';
        return true;
      } catch {
        // Try the next reader. Leave the status unchecked so a transient
        // outage does not permanently disable a correctly configured node.
      }
    }
    return false;
  }
}

async function rpc(fetchImpl: AtlasFetch, url: string, method: string, params: unknown[], timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST', signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!response.ok) throw new Error('atlas_rpc_http_error');
    const payload = await response.json() as RpcResponse;
    if (payload.error !== undefined || payload.result === undefined) throw new Error('atlas_rpc_error');
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const nested = raw.data;
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : raw;
}

function stringValue(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function integer(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function booleanOrStatus(value: unknown, status: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (status === 'success') return true;
  if (status === 'failed') return false;
  return null;
}
