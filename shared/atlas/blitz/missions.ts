import type { BlitzMissionDefinition } from './types';

export const BLITZ_MISSION_POOL: readonly BlitzMissionDefinition[] = [
  { id: 'peer-health', label: 'PEER PICK', prompt: 'Which relay is healthier?', left: '18 ms / stable', right: '240 ms / dropping', correctChoice: 'left', explanation: 'A stable low-latency peer keeps messages moving reliably.' },
  { id: 'finality', label: 'FINALITY FLASH', prompt: 'The block is final. Ride?', left: 'Wait forever', right: 'Commit the route', correctChoice: 'right', explanation: 'Finality means the confirmed result will not be reversed.' },
  { id: 'recovery', label: 'KEY CHECK', prompt: 'Where does the recovery phrase go?', left: 'Private and offline', right: 'Public cloud note', correctChoice: 'left', explanation: 'A recovery phrase controls the wallet and must stay private.' },
  { id: 'address', label: 'ADDRESS SCAN', prompt: 'Recipient changed one character.', left: 'Send anyway', right: 'Stop and verify', correctChoice: 'right', explanation: 'Always verify the full recipient before approving a payment.' },
  { id: 'payment-link', label: 'PAYMENT LINK', prompt: 'A request asks for more than shown.', left: 'Reject it', right: 'Approve fast', correctChoice: 'left', explanation: 'The amount and recipient must match what you intended to pay.' },
  { id: 'light-client', label: 'LIGHT ROUTE', prompt: 'Need a fast mobile check?', left: 'Trust any screenshot', right: 'Verify with the network', correctChoice: 'right', explanation: 'A light client checks network truth without downloading everything.' },
  { id: 'fees', label: 'FEE LANE', prompt: 'Two valid routes. Which is efficient?', left: 'Same result, lower fee', right: 'Same result, higher fee', correctChoice: 'left', explanation: 'Efficient payments preserve value without weakening verification.' },
  { id: 'signature', label: 'SIGNATURE GATE', prompt: 'What proves this approval is yours?', left: 'A private signature', right: 'A profile picture', correctChoice: 'left', explanation: 'A valid signature proves control without revealing the private key.' },
];

export function selectBlitzMissions(seed: string): readonly BlitzMissionDefinition[] {
  let state = seedHash(seed) || 0x9e3779b9;
  const candidates = [...BLITZ_MISSION_POOL];
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    state = xorshift(state);
    const swap = state % (index + 1);
    [candidates[index], candidates[swap]] = [candidates[swap]!, candidates[index]!];
  }
  return candidates.slice(0, 3).map((mission) => ({ ...mission }));
}

function seedHash(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function xorshift(value: number): number {
  let next = value >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}
