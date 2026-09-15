import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createBlitzRun, stepBlitzRun, BLITZ_TICK_RATE } from '../shared/atlas/blitz/core';
import { BLITZ_CITIES } from '../shared/atlas/blitz/cities';
import { hashBlitzTrace, replayBlitzTrace } from '../shared/atlas/blitz/replay';
import type { BlitzCityId, BlitzTraceFrame } from '../shared/atlas/blitz/types';
import { createAtlasBlitzService } from '../server/atlas/blitz';

// Local fixtures call the real simulation and service. No network, wallet
// provider, production repository or reward service is instantiated here.
function trace(cityId: BlitzCityId, seed: string) {
  let state = createBlitzRun({ cityId, seed });
  const frames: BlitzTraceFrame[] = [];
  while (state.phase !== 'finished' && state.phase !== 'timeout') {
    const input = { steer: 0, drift: false, boost: state.tick % 140 < 24 };
    frames.push({ tick: frames.length, input });
    state = stepBlitzRun(state, input);
  }
  assert.equal(state.phase, 'finished');
  return { frames, state };
}

const replays = [];
for (const city of BLITZ_CITIES) {
  for (const seed of ['rush-control-2026-09-15', 'rush-held-out-2026-09-15']) {
    const generated = trace(city.id, seed);
    const samples: number[] = [];
    for (let iteration = 0; iteration < 33; iteration++) {
      const start = performance.now();
      const rebuilt = replayBlitzTrace({ cityId: city.id, seed, frames: generated.frames });
      const elapsed = performance.now() - start;
      assert.deepEqual(rebuilt, generated.state);
      if (iteration >= 3) samples.push(elapsed);
    }
    samples.sort((a, b) => a - b);
    const p95Ms = samples[Math.ceil(samples.length * 0.95) - 1]!;
    assert.ok(p95Ms < 100, `Replay p95 exceeds budget for ${city.id}: ${p95Ms}`);
    replays.push({ city: city.id, seed, frames: generated.frames.length, elapsedMs: generated.state.elapsedMs, score: generated.state.score, jsonBytes: Buffer.byteLength(JSON.stringify(generated.frames)), hash: await hashBlitzTrace(generated.frames), p95Ms });
  }
}

let current = 1_000;
const service = createAtlasBlitzService({
  now: () => current,
  randomId: () => 'proof-ticket',
  identity: { getBinding: (actorId, seasonId) => ({ actorId, seasonId, address: 'fixture-wallet', network: 'testalbatross', publicKey: 'fixture', boundAt: 1_000 }) },
});
const ticket = await service.issueTicket({ actorId: 'proof-actor', walletAddress: 'fixture-wallet', username: 'ProofRider', cityId: 'lagos', seasonId: 'local-proof' });
const generated = trace(ticket.cityId, ticket.seed);
const submission = { runId: 'proof-run', ticketId: ticket.id, actorId: ticket.actorId, walletAddress: ticket.walletAddress, username: ticket.username, cityId: ticket.cityId, seasonId: ticket.seasonId, seed: ticket.seed, frames: generated.frames, traceHash: await hashBlitzTrace(generated.frames), claimedScore: generated.state.score };
await assert.rejects(service.submit(submission), /elapsed server time/);
current += Math.ceil(generated.state.tick * 1_000 / BLITZ_TICK_RATE);
await assert.rejects(service.submit({ ...submission, claimedScore: 999999 }), /score/);
const raced = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => service.submit({ ...submission, runId: `proof-${index}` })));
assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 1);
assert.equal(service.serialise().runs.length, 1);
const accepted = raced.find((result) => result.status === 'fulfilled');
assert.ok(accepted?.status === 'fulfilled');
const retry = await service.submit({ ...submission, runId: accepted.value.row.runId });
assert.equal(retry.duplicate, true);
await assert.rejects(service.submit({ ...submission, runId: accepted.value.row.runId, walletAddress: 'another-wallet' }), /ticket/);

const sources = ['shared/atlas/blitz/core.ts', 'shared/atlas/blitz/course.ts', 'shared/atlas/blitz/cities.ts', 'shared/atlas/blitz/daily.ts', 'shared/atlas/blitz/surfaces.ts', 'shared/atlas/blitz/missions.ts', 'shared/atlas/blitz/rules.ts', 'shared/atlas/blitz/replay.ts', 'server/atlas/blitz.ts', 'server/atlas/identity.ts', 'server/atlas/persistence.ts', 'scripts/prove-blitz.ts'];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (path) => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const report = {
  generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  authority: 'local in-memory service with fixture identity; real replay and submission functions',
  refusals: { instantReplay: true, forgedScore: true, concurrentTicketReuse: true, walletSubstitution: true },
  acceptedRuns: service.serialise().runs.length, exactRetryIsDuplicate: retry.duplicate,
  replayBudgetMs: 100, replays, sourceHashes,
  limitations: ['Does not establish human play or resistance to a bot that waits.', 'Does not measure device rendering, wallet approval or chain payouts.', 'Production persistence is covered separately by fault-injection tests.', 'Payload measurements are uncompressed JSON; report any budget miss without claiming compression is implemented.'],
};
if (process.argv.includes('--report')) await writeFile('docs/nim-rush-proof-2026-09-15.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
