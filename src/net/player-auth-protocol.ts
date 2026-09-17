export type AuthAction =
  | 'player.register'
  | 'profile.merge'
  | 'chat.say'
  | 'chat.edit'
  | 'tips.report'
  | 'tips.seen'
  | 'clan.join'
  | 'clan.decide'
  | 'contest.create'
  | 'contest.join'
  | 'contest.settle'
  | 'challenge.create'
  | 'challenge.accept'
  | 'challenge.settle'
  | 'signals.unlock'
  | 'score.post'
  | 'score.sign'
  | 'score.anchor'
  | 'ghost.post'
  | 'atlas.wallet.challenge'
  | 'atlas.wallet.bind'
  | 'atlas.ticket.issue'
  | 'atlas.run.submit'
  | 'atlas.wallet.recover';

export interface MergeClaim {
  from: string;
  into: string;
  network: string;
}

export interface Challenge {
  id: string;
  action: AuthAction;
  playerId: string;
  bodyDigest: string;
  nonce: string;
  expiresAt: number;
}

export interface PublicKeyJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
  key_ops?: string[];
  ext?: boolean;
}

export interface DeviceProof {
  challengeId: string;
  publicKeyJwk: PublicKeyJwk;
  signature: string;
}

const encoder = new TextEncoder();

function requireText(name: string, value: string): string {
  if (value.length === 0) throw new Error(`${name} must not be empty.`);
  return value;
}

function encodeFields(fields: ReadonlyArray<readonly [string, string]>): Uint8Array {
  const parts = fields.map(([name, value]) => {
    const label = encoder.encode(requireText('field name', name));
    const body = encoder.encode(requireText(name, value));
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint32(0, label.byteLength);
    view.setUint32(4, body.byteLength);
    return { label, body, header };
  });
  const length = parts.reduce(
    (total, part) => total + part.header.byteLength + part.label.byteLength + part.body.byteLength,
    0,
  );
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part.header, offset);
    offset += part.header.byteLength;
    out.set(part.label, offset);
    offset += part.label.byteLength;
    out.set(part.body, offset);
    offset += part.body.byteLength;
  }
  return out;
}

export function encodeMergeClaim(claim: MergeClaim): Uint8Array {
  return encodeFields([
    ['protocol', 'sface.player-auth.v1'],
    ['action', 'profile.merge'],
    ['from', claim.from],
    ['into', claim.into],
    ['network', claim.network],
  ]);
}

export function encodeChallenge(challenge: Challenge): Uint8Array {
  if (!Number.isFinite(challenge.expiresAt)) throw new Error('expiresAt must be finite.');
  return encodeFields([
    ['protocol', 'sface.player-auth.v1'],
    ['id', challenge.id],
    ['action', challenge.action],
    ['playerId', challenge.playerId],
    ['bodyDigest', challenge.bodyDigest],
    ['nonce', challenge.nonce],
    ['expiresAt', String(challenge.expiresAt)],
  ]);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function mergeBodyDigest(claim: MergeClaim): Promise<string> {
  return sha256Hex(encodeMergeClaim(claim));
}

export function publicKeyId(jwk: PublicKeyJwk): Promise<string> {
  return sha256Hex(
    encoder.encode(`kty:${jwk.kty}\ncrv:${jwk.crv}\nx:${jwk.x}\ny:${jwk.y}`),
  );
}

/*
 * A digest both ends can agree on, including the fields that are not there.
 *
 * Key order is sorted so the two sides cannot disagree about it. The part that
 * was missing is `undefined`: this rendered it literally, producing
 * `"challengeId":undefined`, which is not even JSON. The request itself goes
 * over the wire through JSON.stringify, which drops an undefined property
 * entirely, so the server received a body without the key, hashed a body
 * without the key, and disagreed with the signature every time.
 *
 * It only bit requests carrying an optional field that happened to be unset,
 * which is why a lobby - three required fields, no optionals - signed and
 * verified perfectly while every ranked run refused. The rider saw "submission
 * was rejected" and no leaderboard, and nothing in the type system had an
 * opinion, because `challengeId?: string` being undefined is exactly correct.
 *
 * So the rule here is now the same rule JSON.stringify uses: an undefined
 * property is absent, and an undefined array element is null.
 */
function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

export function bodyDigest(value: unknown): Promise<string> {
  return sha256Hex(encoder.encode(stableJson(value)));
}
