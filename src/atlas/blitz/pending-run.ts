import type { BlitzTraceFrame } from '../../../shared/atlas/blitz/types';
import type { BlitzTicket } from '../../../shared/atlas/blitz/competition';

const DEFAULT_KEY = 'nim-atlas:blitz:pending-ranked-run';
const MAX_SERIALISED_BYTES = 256_000;

export interface BlitzPendingSubmission {
  readonly runId: string;
  readonly ticket: BlitzTicket;
  readonly frames: readonly BlitzTraceFrame[];
  readonly traceHash: string;
  readonly claimedScore: number;
  readonly savedAt: number;
}

export interface BlitzStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BlitzPendingRunStore {
  read(): BlitzPendingSubmission | null;
  save(value: BlitzPendingSubmission): boolean;
  clear(): void;
}

export function createBlitzPendingRunStore(storage: BlitzStorage | null, key = DEFAULT_KEY): BlitzPendingRunStore {
  return {
    read() {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        if (!raw || raw.length > MAX_SERIALISED_BYTES) return null;
        const parsed: unknown = JSON.parse(raw);
        return isPendingSubmission(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    save(value) {
      if (!storage || !isPendingSubmission(value)) return false;
      try {
        const serialised = JSON.stringify(value);
        if (serialised.length > MAX_SERIALISED_BYTES) return false;
        storage.setItem(key, serialised);
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try { storage?.removeItem(key); } catch { /* Storage is optional. */ }
    },
  };
}

function isPendingSubmission(value: unknown): value is BlitzPendingSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return /^[a-zA-Z0-9:_-]{1,128}$/.test(String(candidate.runId))
    && isTicket(candidate.ticket)
    && Array.isArray(candidate.frames)
    && candidate.frames.length <= 3_000
    && candidate.frames.every(isFrame)
    && /^[a-f0-9]{64}$/.test(String(candidate.traceHash))
    && Number.isSafeInteger(candidate.claimedScore)
    && Number(candidate.claimedScore) >= 0
    && Number.isSafeInteger(candidate.savedAt)
    && Number(candidate.savedAt) >= 0;
}

function isTicket(value: unknown): value is BlitzTicket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ticket = value as Record<string, unknown>;
  return /^[a-zA-Z0-9_-]{1,128}$/.test(String(ticket.id))
    && typeof ticket.actorId === 'string'
    && typeof ticket.walletAddress === 'string'
    && /^[A-Za-z0-9_]{3,18}$/.test(String(ticket.username))
    && ['lagos', 'london', 'dubai'].includes(String(ticket.cityId))
    && typeof ticket.seasonId === 'string'
    && typeof ticket.challengeId === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(String(ticket.challengeDate))
    && typeof ticket.rulesetVersion === 'string'
    && typeof ticket.seed === 'string'
    && Number.isSafeInteger(ticket.issuedAt)
    && Number.isSafeInteger(ticket.expiresAt);
}

function isFrame(value: unknown): value is BlitzTraceFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const frame = value as Record<string, unknown>;
  const input = frame.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const controls = input as Record<string, unknown>;
  return Number.isSafeInteger(frame.tick)
    && Number(frame.tick) >= 0
    && typeof controls.steer === 'number'
    && Number.isFinite(controls.steer)
    && typeof controls.drift === 'boolean'
    && typeof controls.boost === 'boolean'
    && (controls.brake === undefined || typeof controls.brake === 'boolean')
    && (controls.relayChoice === undefined || controls.relayChoice === 'left' || controls.relayChoice === 'right');
}
