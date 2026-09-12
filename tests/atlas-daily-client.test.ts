import { describe, expect, it } from 'vitest';
import { createAtlasApiClient } from '../src/atlas/api';

/*
 * The daily run's client.
 *
 * `/atlas/api/daily/*` was mounted, tested and live for weeks with no client at
 * all: the daily screen told the player "reward share appears only after server
 * verification" and then never called the server, so the reward it named could
 * not arrive. These cover the client half of that wiring.
 */
function client(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    const body = handler(String(input), init);
    return { ok: true, status: 200, json: async () => ({ ok: true, data: body }) } as unknown as Response;
  };
  return createAtlasApiClient({ baseUrl: 'https://api.test', fetchImpl });
}

describe('the daily run client', () => {
  it('reads the standing, including the treasury cap', async () => {
    const api = client(() => ({
      date: '2026-09-12', eligibleCount: 2, shareLuna: 1669, poolLuna: 3338,
      configuredPoolLuna: 10_000, treasuryLuna: 3338, rewardsEnabled: true,
    }));
    expect(await api.getDailyStanding()).toMatchObject({ poolLuna: 3338, configuredPoolLuna: 10_000, treasuryLuna: 3338 });
  });

  /*
   * The capped fields are optional on purpose. The server deployed today
   * predates them, and a client that refused its response would blank the
   * reward panel on the very deployment it has to work against.
   */
  it('accepts a standing from a server that predates the treasury cap', async () => {
    const api = client(() => ({ date: '2026-09-12', eligibleCount: 0, shareLuna: null, poolLuna: 10_000, rewardsEnabled: true }));
    const standing = await api.getDailyStanding();
    expect(standing.poolLuna).toBe(10_000);
    expect(standing.configuredPoolLuna).toBeUndefined();
  });

  it('refuses a standing that is missing what the panel renders', async () => {
    const api = client(() => ({ date: '2026-09-12', eligibleCount: 0 }));
    await expect(api.getDailyStanding()).rejects.toThrow();
  });

  it('posts a submission to the submit route', async () => {
    let seen: { url: string; body: unknown } | null = null;
    const api = client((url, init) => {
      seen = { url, body: JSON.parse(String(init?.body)) };
      return { accepted: true, eligible: true, date: '2026-09-12' };
    });
    const result = await api.submitDaily({
      actorId: 'atlas-session-aaa', walletAddress: 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456789',
      challengeId: 'daily-19', answer: 'consensus', replayComplete: true, assistance: 'none',
    });
    expect(result).toMatchObject({ accepted: true, eligible: true });
    expect(seen!.url).toBe('https://api.test/atlas/api/daily/submit');
    expect(seen!.body).toMatchObject({ challengeId: 'daily-19', assistance: 'none' });
  });

  /* A refusal is a normal answer, not an error: the player asked whether they
   * qualified and the server said no, with a reason they can act on. */
  it('returns a refusal as a value rather than throwing', async () => {
    const api = client(() => ({ accepted: false, eligible: false, reason: 'payment_unverified', retryable: true, date: '2026-09-12' }));
    const result = await api.submitDaily({
      actorId: 'atlas-session-aaa', walletAddress: 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456789',
      challengeId: 'daily-05', answer: '100000', replayComplete: true, assistance: 'none',
    });
    expect(result).toMatchObject({ accepted: false, reason: 'payment_unverified', retryable: true });
  });

  it('reads what the day owes a wallet', async () => {
    const api = client(() => ({ status: 'pending-close', amountLuna: 1669 }));
    expect(await api.getDailyObligation({ actorId: 'atlas-session-aaa', walletAddress: 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456789', challengeId: 'daily-19' }))
      .toMatchObject({ status: 'pending-close', amountLuna: 1669 });
  });

  it('refuses an obligation with a status it does not understand', async () => {
    const api = client(() => ({ status: 'paid-already', amountLuna: 1 }));
    await expect(api.getDailyObligation({ actorId: 'a', walletAddress: 'b', challengeId: 'daily-19' })).rejects.toThrow();
  });
});
