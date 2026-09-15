import { randomBytes, randomUUID } from 'node:crypto';
import { Address, PublicKey, Signature } from '@nimiq/core';

import { encodeSignedMessage } from '../attest';
import { PlayerAuth } from '../player-auth';
import type { Challenge, DeviceProof } from '../../src/net/player-auth-protocol';
import type { AtlasNetwork } from '../../shared/atlas/types';
import {
  canonicalAtlasWalletBindingMessage as sharedCanonicalAtlasWalletBindingMessage,
  type AtlasWalletBinding,
  type AtlasWalletBindingChallenge,
} from '../../shared/atlas/wallet-binding';

export type { AtlasWalletBinding, AtlasWalletBindingChallenge } from '../../shared/atlas/wallet-binding';

const WALLET_BINDING_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_DOMAIN = 'https://sface.site';
const PURPOSE = 'atlas-wallet-binding';

export interface AtlasWalletBindingProof {
  challenge: AtlasWalletBindingChallenge;
  publicKey: string;
  signature: string;
}

export interface AtlasIdentityAuditEvent {
  type: 'wallet-binding.challenge-issued' | 'wallet-binding.created' | 'wallet-binding.recovered';
  actorId: string;
  seasonId: string;
  address: string;
  at: number;
  reason?: string;
}

export interface AtlasIdentitySnapshot {
  version: 1;
  challenges: AtlasWalletBindingChallenge[];
  bindings: AtlasWalletBinding[];
  audit: AtlasIdentityAuditEvent[];
}

export interface AtlasIdentityService {
  issueWalletChallenge(input: { actorId: string; seasonId: string; address: string; network: AtlasNetwork; now?: number }): AtlasWalletBindingChallenge;
  bindWallet(input: AtlasWalletBindingProof, now?: number): Promise<AtlasWalletBinding>;
  issueRecoveryChallenge(input: { actorId: string; bodyDigest: string; now?: number }): Challenge;
  recoverWallet(input: { actorId: string; seasonId: string; address: string; network: AtlasNetwork; reason: string; bodyDigest: string; proof: DeviceProof; now?: number }): Promise<AtlasWalletBinding>;
  getBinding(actorId: string, seasonId: string): AtlasWalletBinding | null;
  audit(): AtlasIdentityAuditEvent[];
  serialise(): AtlasIdentitySnapshot;
  restore(raw: unknown): void;
}

export class AtlasIdentityError extends Error {
  constructor(readonly code: 'invalid' | 'expired' | 'conflict', message: string) {
    super(message);
    this.name = 'AtlasIdentityError';
  }
}

export const canonicalAtlasWalletBindingMessage = sharedCanonicalAtlasWalletBindingMessage;

export function verifyAtlasWalletSignature(input: AtlasWalletBindingProof, now = Date.now(), expectedDomain = DEFAULT_DOMAIN): { address: string } | null {
  try {
    const challenge = input.challenge;
    if (challenge.domain !== expectedDomain || challenge.purpose !== PURPOSE) return null;
    if (!['testalbatross', 'mainalbatross'].includes(challenge.network)) return null;
    if (!Number.isSafeInteger(challenge.issuedAt) || !Number.isSafeInteger(challenge.expiresAt) || now >= challenge.expiresAt || challenge.expiresAt <= challenge.issuedAt) return null;
    const address = Address.fromUserFriendlyAddress(challenge.address).toUserFriendlyAddress();
    const publicKey = PublicKey.fromHex(input.publicKey);
    const signature = Signature.fromHex(input.signature);
    if (publicKey.toAddress().toUserFriendlyAddress() !== address) return null;
    return publicKey.verify(signature, encodeSignedMessage(canonicalAtlasWalletBindingMessage({ ...challenge, address })) ) ? { address } : null;
  } catch {
    return null;
  }
}

export function createAtlasIdentityService(options: { auth: PlayerAuth; now?: () => number; domain?: string } ): AtlasIdentityService {
  const now = options.now ?? Date.now;
  const domain = options.domain ?? DEFAULT_DOMAIN;
  const challenges = new Map<string, AtlasWalletBindingChallenge>();
  const bindings = new Map<string, AtlasWalletBinding>();
  const audit: AtlasIdentityAuditEvent[] = [];
  return {
    issueWalletChallenge(input) {
      if (!options.auth.hasCredential(input.actorId)) throw new AtlasIdentityError('invalid', 'Atlas actor credential is not registered.');
      const issuedAt = input.now ?? now();
      const address = Address.fromUserFriendlyAddress(input.address).toUserFriendlyAddress();
      const challenge: AtlasWalletBindingChallenge = { id: randomUUID(), domain, purpose: PURPOSE, actorId: input.actorId, seasonId: input.seasonId, address, network: input.network, nonce: randomBytes(16).toString('hex'), issuedAt, expiresAt: issuedAt + WALLET_BINDING_TTL_MS };
      challenges.set(challenge.id, challenge);
      audit.push({ type: 'wallet-binding.challenge-issued', actorId: input.actorId, seasonId: input.seasonId, address, at: issuedAt });
      return structuredClone(challenge);
    },
    async bindWallet(input, current = now()) {
      const held = challenges.get(input.challenge.id);
      if (!held || JSON.stringify(held) !== JSON.stringify(input.challenge)) throw new AtlasIdentityError('invalid', 'Atlas wallet challenge is invalid, unknown, or altered.');
      challenges.delete(input.challenge.id);
      if (current >= held.expiresAt) throw new AtlasIdentityError('expired', 'Atlas wallet challenge has expired.');
      const verified = verifyAtlasWalletSignature({ ...input, challenge: held }, current, domain);
      if (!verified) throw new AtlasIdentityError('invalid', 'Atlas wallet signature is invalid.');
      const actorKey = `${held.seasonId}:${held.actorId}`;
      const walletKey = `${held.seasonId}:${verified.address}`;
      const existing = bindings.get(actorKey);
      if (existing && (existing.address !== verified.address || existing.publicKey !== input.publicKey)) throw new AtlasIdentityError('conflict', 'Actor is already bound to another wallet.');
      const walletOwner = [...bindings.values()].find((binding) => `${binding.seasonId}:${binding.address}` === walletKey && binding.actorId !== held.actorId);
      if (walletOwner) throw new AtlasIdentityError('conflict', 'Wallet is already bound to another actor in this season.');
      const binding: AtlasWalletBinding = { actorId: held.actorId, seasonId: held.seasonId, address: verified.address, network: held.network, publicKey: input.publicKey, boundAt: current };
      bindings.set(actorKey, binding);
      audit.push({ type: 'wallet-binding.created', actorId: binding.actorId, seasonId: binding.seasonId, address: binding.address, at: current });
      return structuredClone(binding);
    },
    issueRecoveryChallenge(input) {
      if (!/^[a-f0-9]{64}$/.test(input.bodyDigest)) throw new AtlasIdentityError('invalid', 'Atlas recovery body digest is invalid.');
      const result = options.auth.issueChallenge({ playerId: input.actorId, action: 'atlas.wallet.recover', bodyDigest: input.bodyDigest, now: input.now ?? now() });
      if (!result.ok) throw new AtlasIdentityError('invalid', 'Atlas recovery actor is not authorized.');
      return structuredClone(result.value);
    },
    async recoverWallet(input) {
      if (!/^[a-f0-9]{64}$/.test(input.bodyDigest) || input.reason.trim().length < 8) throw new AtlasIdentityError('invalid', 'Atlas recovery request is invalid.');
      const verified = await options.auth.verify({ proof: input.proof, action: 'atlas.wallet.recover', bodyDigest: input.bodyDigest, now: input.now ?? now() });
      if (!verified.ok || verified.value.playerId !== input.actorId) throw new AtlasIdentityError('invalid', 'Atlas recovery challenge is invalid.');
      const actorKey = `${input.seasonId}:${input.actorId}`;
      const existing = bindings.get(actorKey);
      if (!existing) throw new AtlasIdentityError('invalid', 'Atlas wallet binding does not exist.');
      const address = Address.fromUserFriendlyAddress(input.address).toUserFriendlyAddress();
      // A device proof cannot authorize a different wallet or network. Keep
      // recovery scoped to the existing signed binding; rotation needs a new
      // wallet-signature protocol rather than reusing the old public key.
      if (address !== existing.address || input.network !== existing.network
        || PublicKey.fromHex(existing.publicKey).toAddress().toUserFriendlyAddress() !== address) {
        throw new AtlasIdentityError('invalid', 'Recovery requires the same wallet and network. A different wallet requires its own wallet signature.');
      }
      const owner = [...bindings.values()].find((binding) => binding.seasonId === input.seasonId && binding.address === address && binding.actorId !== input.actorId);
      if (owner) throw new AtlasIdentityError('conflict', 'Wallet is already bound to another actor in this season.');
      const binding: AtlasWalletBinding = { ...existing, address, network: input.network, boundAt: input.now ?? now() };
      bindings.set(actorKey, binding);
      audit.push({ type: 'wallet-binding.recovered', actorId: input.actorId, seasonId: input.seasonId, address, at: binding.boundAt, reason: input.reason.slice(0, 160) });
      return structuredClone(binding);
    },
    getBinding(actorId, seasonId) {
      const binding = bindings.get(`${seasonId}:${actorId}`);
      return binding ? structuredClone(binding) : null;
    },
    audit() {
      return structuredClone(audit);
    },
    serialise() {
      return { version: 1, challenges: [...challenges.values()], bindings: [...bindings.values()], audit: [...audit] };
    },
    restore(raw) {
      if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) throw new AtlasIdentityError('invalid', 'Atlas identity snapshot is unsupported.');
      challenges.clear();
      bindings.clear();
      audit.length = 0;
      for (const challenge of (raw as AtlasIdentitySnapshot).challenges) if (challenge?.id && challenge.actorId && challenge.seasonId) challenges.set(challenge.id, structuredClone(challenge));
      for (const binding of (raw as AtlasIdentitySnapshot).bindings) if (binding?.actorId && binding.seasonId && binding.address) bindings.set(`${binding.seasonId}:${binding.actorId}`, structuredClone(binding));
      for (const event of (raw as AtlasIdentitySnapshot).audit) if (event?.type && event.actorId && event.seasonId) audit.push(structuredClone(event));
    },
  };
}
