import { PrivateKey, PublicKey, Signature } from '@nimiq/core';
import { describe, expect, it } from 'vitest';

import { PlayerAuth } from '../server/player-auth';
import { createAtlasIdentityService, canonicalAtlasWalletBindingMessage } from '../server/atlas/identity';
import { createAtlasTicketService } from '../server/atlas/tickets';
import { createAtlasSubmissionService, type AtlasSubmissionInput } from '../server/atlas/submissions';
import { encodeSignedMessage } from '../server/attest';
import { ATLAS_CORE_FIXTURE } from '../shared/atlas/world';
import { hashAtlasActions, replayAtlasActions } from '../shared/atlas/replay';
import { getOrCreateCredential, MemoryPlayerCredentialStore, signChallenge } from '../src/net/player-credential';
import type { AtlasAction } from '../shared/atlas/state';

describe('NIM Atlas competitive boundary', () => {
  it('binds a P-256 actor to one exact-purpose wallet challenge', async () => {
    const setup = await createSetup();
    const challenge = setup.identity.issueWalletChallenge({ actorId: setup.actorId, seasonId: 'season-1', address: setup.walletAddress, network: 'testalbatross' });
    const signature = Signature.create(setup.walletPrivate, setup.walletPublic, encodeSignedMessage(canonicalAtlasWalletBindingMessage(challenge))).toHex();

    await expect(setup.identity.bindWallet({ challenge, publicKey: setup.walletPublic.toHex(), signature })).resolves.toMatchObject({ actorId: setup.actorId, seasonId: 'season-1', address: setup.walletAddress });
    await expect(setup.identity.bindWallet({ challenge, publicKey: setup.walletPublic.toHex(), signature })).rejects.toThrow(/challenge|used/i);
  });

  it('rejects wallet substitution, wrong purpose, expiry, and actor-wallet conflicts', async () => {
    const setup = await createSetup();
    const challenge = setup.identity.issueWalletChallenge({ actorId: setup.actorId, seasonId: 'season-1', address: setup.walletAddress, network: 'testalbatross' });
    const altered = { ...challenge, purpose: 'payment' } as unknown as typeof challenge;
    const signature = Signature.create(setup.walletPrivate, setup.walletPublic, encodeSignedMessage(canonicalAtlasWalletBindingMessage(challenge))).toHex();
    await expect(setup.identity.bindWallet({ challenge: altered, publicKey: setup.walletPublic.toHex(), signature })).rejects.toThrow(/invalid|purpose/i);
    await expect(setup.identity.bindWallet({ challenge, publicKey: PublicKey.derive(PrivateKey.generate()).toHex(), signature }, 10_000)).rejects.toThrow(/expired|invalid/i);
  });

  it('keeps one actor and one wallet per season', async () => {
    const setup = await createSetup();
    await setup.bindWallet();
    const replacementPrivate = PrivateKey.generate();
    const replacementPublic = PublicKey.derive(replacementPrivate);
    const replacementAddress = replacementPublic.toAddress().toUserFriendlyAddress();
    const challenge = setup.identity.issueWalletChallenge({ actorId: setup.actorId, seasonId: 'season-1', address: replacementAddress, network: 'testalbatross' });
    const signature = Signature.create(replacementPrivate, replacementPublic, encodeSignedMessage(canonicalAtlasWalletBindingMessage(challenge))).toHex();
    await expect(setup.identity.bindWallet({ challenge, publicKey: replacementPublic.toHex(), signature })).rejects.toThrow(/another wallet|conflict/i);
  });

  it('refuses a device-only recovery that substitutes an unsigned wallet', async () => {
    const setup = await createSetup();
    await setup.bindWallet();
    const replacementPrivate = PrivateKey.generate();
    const replacementAddress = PublicKey.derive(replacementPrivate).toAddress().toUserFriendlyAddress();
    const bodyDigest = 'd'.repeat(64);
    const challenge = setup.identity.issueRecoveryChallenge({ actorId: setup.actorId, bodyDigest });
    const signature = await signChallenge(setup.actorCredential.pair, challenge);
    await expect(setup.identity.recoverWallet({ actorId: setup.actorId, seasonId: 'season-1', address: replacementAddress, network: 'testalbatross', reason: 'local fixture recovery', bodyDigest, proof: { challengeId: challenge.id, publicKeyJwk: setup.actorCredential.publicKeyJwk, signature } })).rejects.toThrow(/wallet.*signature|same wallet/i);
    expect(setup.identity.getBinding(setup.actorId, 'season-1')?.address).toBe(setup.walletAddress);
  });

  it('allows audited recovery of the same cryptographically bound wallet', async () => {
    const setup = await createSetup();
    await setup.bindWallet();
    const bodyDigest = 'e'.repeat(64);
    const challenge = setup.identity.issueRecoveryChallenge({ actorId: setup.actorId, bodyDigest });
    const signature = await signChallenge(setup.actorCredential.pair, challenge);
    await expect(setup.identity.recoverWallet({ actorId: setup.actorId, seasonId: 'season-1', address: setup.walletAddress, network: 'testalbatross', reason: 'restore current wallet', bodyDigest, proof: { challengeId: challenge.id, publicKeyJwk: setup.actorCredential.publicKeyJwk, signature } })).resolves.toMatchObject({ address: setup.walletAddress, publicKey: setup.walletPublic.toHex() });
    expect(setup.identity.audit().at(-1)).toMatchObject({ type: 'wallet-binding.recovered', actorId: setup.actorId });
  });

  it('pins a one-time ticket and verifies the replay on the server', async () => {
    const setup = await createSetup();
    await setup.bindWallet();
    const ticket = await setup.tickets.issue({ actorId: setup.actorId, walletAddress: setup.walletAddress, network: 'testalbatross', role: 'explorer', seasonId: 'season-1', challengeId: 'expedition-1', seed: 'seed-1', campaignHash: 'a'.repeat(64), curriculumHash: 'b'.repeat(64), rulesetHash: 'c'.repeat(64) });
    const actions: AtlasAction[] = [{ moveX: 0, moveY: 0, tool: 'none', interact: false }];
    const valid = await createSubmission(setup, ticket.ticketId, actions);
    await expect(setup.submissions.submit(valid)).resolves.toMatchObject({ status: 'verified', prizeEligible: true, score: 0, mastery: { total: 2_500 } });
    await expect(setup.submissions.submit(valid)).resolves.toMatchObject({ status: 'verified', duplicate: true });
  });

  it('rejects replay forgery, ticket theft, wrong origin, and Assisted submissions', async () => {
    const setup = await createSetup();
    await setup.bindWallet();
    const ticket = await setup.tickets.issue({ actorId: setup.actorId, walletAddress: setup.walletAddress, network: 'testalbatross', role: 'explorer', seasonId: 'season-1', challengeId: 'expedition-1', seed: 'seed-1', campaignHash: 'a'.repeat(64), curriculumHash: 'b'.repeat(64), rulesetHash: 'c'.repeat(64) });
    const actions: AtlasAction[] = [{ moveX: 0, moveY: 0, tool: 'none', interact: false }];
    const valid = await createSubmission(setup, ticket.ticketId, actions);
    await expect(setup.submissions.submit({ ...valid, claimedSnapshot: { ...valid.claimedSnapshot, tick: 99 } })).rejects.toThrow(/replay|snapshot/i);
    await expect(setup.submissions.submit({ ...valid, replayHash: 'd'.repeat(64), runId: 'hash-mutation' })).rejects.toThrow(/replay hash/i);
    await expect(setup.submissions.submit({ ...valid, actorId: 'stolen-actor', runId: 'stolen-run' })).rejects.toThrow(/ticket|actor/i);
    await expect(setup.submissions.submit({ ...valid, origin: 'https://evil.example', runId: 'wrong-origin' })).rejects.toThrow(/origin/i);
    await expect(setup.submissions.submit({ ...valid, network: 'mainalbatross', runId: 'wrong-network' })).rejects.toThrow(/mainnet|network/i);
    await expect(setup.submissions.submit({ ...valid, assistance: 'purchased-hint', runId: 'assisted-run' })).rejects.toThrow(/assisted/i);
  });

  it('restores an awaiting run and reconciles it after interruption', async () => {
    const setup = await createSetup();
    await setup.bindWallet();
    const ticket = await setup.tickets.issue({ actorId: setup.actorId, walletAddress: setup.walletAddress, network: 'testalbatross', role: 'explorer', seasonId: 'season-1', challengeId: 'expedition-1', seed: 'seed-1', campaignHash: 'a'.repeat(64), curriculumHash: 'b'.repeat(64), rulesetHash: 'c'.repeat(64) });
    const valid = await createSubmission(setup, ticket.ticketId, [{ moveX: 0, moveY: 0, tool: 'none', interact: false }]);
    await setup.submissions.stage(valid);
    const snapshot = setup.submissions.serialise();
    expect(snapshot.pending).toHaveLength(1);
    const restored = createAtlasSubmissionService({ tickets: setup.tickets, expectedOrigin: 'https://local.sface.test', mission: ATLAS_CORE_FIXTURE, now: () => 1_000 });
    restored.restore(snapshot);
    await expect(restored.reconcileAwaiting()).resolves.toMatchObject([{ runId: valid.runId, status: 'verified' }]);
  });

  it('accepts one effect under one hundred concurrent duplicate submissions', async () => {
    const setup = await createSetup();
    await setup.bindWallet();
    const ticket = await setup.tickets.issue({ actorId: setup.actorId, walletAddress: setup.walletAddress, network: 'testalbatross', role: 'explorer', seasonId: 'season-1', challengeId: 'expedition-1', seed: 'seed-1', campaignHash: 'a'.repeat(64), curriculumHash: 'b'.repeat(64), rulesetHash: 'c'.repeat(64) });
    const valid = await createSubmission(setup, ticket.ticketId, [{ moveX: 0, moveY: 0, tool: 'none', interact: false }]);
    const results = await Promise.all(Array.from({ length: 100 }, () => setup.submissions.submit(valid)));
    expect(results.filter((result) => result.status === 'verified')).toHaveLength(100);
    expect(new Set(results.map((result) => result.runId))).toEqual(new Set([valid.runId]));
    expect(setup.submissions.serialise().runs).toHaveLength(1);
    expect(setup.submissions.serialise().pending).toHaveLength(0);
  });
});

async function createSetup() {
  const actorAuth = new PlayerAuth();
  const credential = await getOrCreateCredential(new MemoryPlayerCredentialStore());
  const registered = await actorAuth.register({ publicKeyJwk: credential.publicKeyJwk, now: 1_000 });
  if (!registered.ok) throw new Error('Actor fixture did not register.');
  const walletPrivate = PrivateKey.generate();
  const walletPublic = PublicKey.derive(walletPrivate);
  const walletAddress = walletPublic.toAddress().toUserFriendlyAddress();
  const identity = createAtlasIdentityService({ auth: actorAuth, now: () => 1_000, domain: 'https://local.sface.test' });
  const tickets = createAtlasTicketService({ identity, now: () => 1_000 });
  const submissions = createAtlasSubmissionService({ tickets, expectedOrigin: 'https://local.sface.test', mission: ATLAS_CORE_FIXTURE, now: () => 1_000 });
  const setup = { actorId: registered.value.playerId, actorCredential: credential, walletPrivate, walletPublic, walletAddress, identity, tickets, submissions, bindWallet: async () => {
    const challenge = identity.issueWalletChallenge({ actorId: registered.value.playerId, seasonId: 'season-1', address: walletAddress, network: 'testalbatross' });
    const signature = Signature.create(walletPrivate, walletPublic, encodeSignedMessage(canonicalAtlasWalletBindingMessage(challenge))).toHex();
    await identity.bindWallet({ challenge, publicKey: walletPublic.toHex(), signature });
  } };
  return setup;
}

async function createSubmission(setup: Awaited<ReturnType<typeof createSetup>>, ticketId: string, actions: AtlasAction[]): Promise<AtlasSubmissionInput> {
  return {
    runId: `run-${ticketId}`,
    ticketId,
    actorId: setup.actorId,
    walletAddress: setup.walletAddress,
    network: 'testalbatross',
    role: 'explorer',
    seasonId: 'season-1',
    challengeId: 'expedition-1',
    origin: 'https://local.sface.test',
    campaignHash: 'a'.repeat(64),
    curriculumHash: 'b'.repeat(64),
    rulesetHash: 'c'.repeat(64),
    assistance: 'none',
    actions,
    claimedSnapshot: replayAtlasActions(ATLAS_CORE_FIXTURE, actions),
    replayHash: await hashAtlasActions(actions),
  };
}
