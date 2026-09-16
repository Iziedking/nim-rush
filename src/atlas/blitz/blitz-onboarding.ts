/*
 * The first ninety seconds before the first ninety seconds.
 *
 * Beacon Blitz opened straight onto a wall of panels and one pink button: a
 * title, a tagline, a three-verb brief, a stat strip, a collapsed leaderboard
 * and a note, all at once, over a live 3D city at full brightness. A player who
 * has never seen it cannot tell what the game *is*, let alone what to press.
 *
 * So the first run is three beats, in the order a person actually needs them:
 * what you are doing, how you move, and what the decisions are. Each is one
 * sentence and one picture. It is skippable, it is shown once, and it is
 * deliberately not a tutorial that blocks play - the ride teaches the rest.
 *
 * Every illustration here is authored geometry: hand-written SVG in the same
 * flat-shape language as the game itself. Nothing is generated.
 */

export type BlitzOnboardingBeatId = 'job' | 'controls' | 'supplies' | 'checks';

export interface BlitzOnboardingBeat {
  readonly id: BlitzOnboardingBeatId;
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  /** Inline SVG, drawn by hand. See the note above. */
  readonly art: string;
}

const INK = '#f7f9ff';
const SIGNAL = '#ff477e';
const CYAN = '#4cc9f0';
const GOLD = '#ffd166';
const ROAD = '#141a30';
const DIM = '#5b6490';

/*
 * A payment leaving a hand and arriving somewhere it can no longer be undone.
 * The road is the same dark band with a dashed spine the game draws, so the
 * picture and the thing it describes look like each other.
 */
const JOB_ART = `
<svg viewBox="0 0 320 170" role="img" aria-label="A route from a stuck payment to a lit beacon" focusable="false">
  <path d="M6 150 C 90 150, 92 54, 168 48 S 268 40, 312 26" fill="none" stroke="${ROAD}" stroke-width="30" stroke-linecap="round"/>
  <path d="M6 150 C 90 150, 92 54, 168 48 S 268 40, 312 26" fill="none" stroke="${DIM}" stroke-width="2" stroke-linecap="round" stroke-dasharray="9 13" opacity=".85"/>
  <g transform="translate(34 138)">
    <!--
      A coin, and it took two tries to stop being something else. A filled
      circle with a bar through it reads as "no entry"; concentric rings read
      as a bullseye. A disc with a rim and a bevel highlight is just a coin,
      and at 34 px anything more becomes noise.
    -->
    <circle r="17" fill="${SIGNAL}"/>
    <circle r="17" fill="none" stroke="${INK}" stroke-width="3"/>
    <path d="M-9 -6 A 11 11 0 0 1 6 -9" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>
  </g>
  <g transform="translate(276 34)">
    <path d="M-13 4 L13 4 L9 -12 L-9 -12 Z" fill="${GOLD}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <rect x="-4" y="-7" width="8" height="8" rx="2" fill="${ROAD}"/>
    <path d="M0 -18 L0 -25" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M-24 14 L24 14" stroke="${GOLD}" stroke-width="3" stroke-linecap="round" opacity=".5"/>
  </g>
  <g transform="translate(150 66)">
    <circle cx="-13" cy="12" r="8" fill="none" stroke="${INK}" stroke-width="3"/>
    <circle cx="14" cy="10" r="8" fill="none" stroke="${INK}" stroke-width="3"/>
    <path d="M-13 12 L-3 -2 L12 -2 L14 10" fill="none" stroke="${CYAN}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="4" cy="-12" r="6" fill="${INK}"/>
  </g>
</svg>`;

/*
 * The three things a thumb does, drawn as the three things a thumb does. Steer
 * is the slider that is really on screen, drift is the arc it leaves, boost is
 * the stack of chevrons behind the bike.
 */
/*
 * The supplies.
 *
 * Two silhouettes on a strip of road, in their lanes, because the lesson is
 * that they have to be gone to and not that they exist. Drawn at the
 * proportions the 3D objects use - a bottle that is tall and narrow, a gear
 * that is round and wide - so the first one a rider sees on the road is one
 * they have already been told about.
 */
const SUPPLIES_ART = `
<svg viewBox="0 0 320 170" role="img" aria-label="Nitro bottles and gearboxes lying in the lanes" focusable="false">
  <path d="M40 160 L108 18 L212 18 L280 160 Z" fill="${ROAD}" opacity=".9"/>
  <path d="M40 160 L108 18" stroke="${INK}" stroke-width="2" opacity=".55" fill="none"/>
  <path d="M280 160 L212 18" stroke="${INK}" stroke-width="2" opacity=".55" fill="none"/>
  <g stroke="${DIM}" stroke-width="3" stroke-linecap="round" opacity=".5">
    <path d="M160 26 L160 44"/><path d="M160 62 L160 88"/><path d="M160 112 L160 150"/>
  </g>
  <!-- A nitro bottle in the left lane: tank, shoulder, neck, lit band. -->
  <g transform="translate(96 84)">
    <ellipse cx="0" cy="46" rx="22" ry="7" fill="${CYAN}" opacity=".3"/>
    <path d="M-13 34 L-13 2 Q-13 -6 -6 -10 L-6 -22 L6 -22 L6 -10 Q13 -6 13 2 L13 34 Z" fill="${CYAN}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <rect x="-14" y="12" width="28" height="7" rx="3" fill="${INK}" opacity=".55"/>
    <rect x="-7" y="-30" width="14" height="9" rx="3" fill="${INK}"/>
  </g>
  <!-- A gearbox in the right lane: a toothed disc, flat on. -->
  <g transform="translate(216 96)">
    <ellipse cx="0" cy="38" rx="24" ry="7" fill="${GOLD}" opacity=".3"/>
    <g fill="${GOLD}" stroke="${INK}" stroke-width="2.5">
      <rect x="-4" y="-30" width="8" height="10" rx="2"/><rect x="-4" y="20" width="8" height="10" rx="2"/>
      <rect x="-30" y="-4" width="10" height="8" rx="2"/><rect x="20" y="-4" width="10" height="8" rx="2"/>
      <rect x="-24" y="-24" width="9" height="9" rx="2" transform="rotate(45 -19.5 -19.5)"/>
      <rect x="15" y="15" width="9" height="9" rx="2" transform="rotate(45 19.5 19.5)"/>
      <rect x="15" y="-24" width="9" height="9" rx="2" transform="rotate(-45 19.5 -19.5)"/>
      <rect x="-24" y="15" width="9" height="9" rx="2" transform="rotate(-45 -19.5 19.5)"/>
    </g>
    <circle cx="0" cy="0" r="22" fill="${GOLD}" stroke="${INK}" stroke-width="3"/>
    <circle cx="0" cy="0" r="8" fill="${ROAD}" stroke="${INK}" stroke-width="3"/>
  </g>
  <g fill="${DIM}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" font-weight="700" letter-spacing="2" text-anchor="middle">
    <text x="96" y="164">NITRO</text>
    <text x="216" y="164">GEARBOX</text>
  </g>
</svg>`;

const CONTROLS_ART = `
<svg viewBox="0 0 320 170" role="img" aria-label="Steer, drift and boost" focusable="false">
  <g transform="translate(12 30)">
    <rect width="92" height="110" rx="16" fill="${ROAD}" stroke="${INK}" stroke-width="2" opacity=".9"/>
    <rect x="16" y="52" width="60" height="7" rx="3.5" fill="${DIM}"/>
    <circle cx="34" cy="55.5" r="15" fill="${CYAN}"/>
    <circle cx="34" cy="55.5" r="15" fill="none" stroke="${INK}" stroke-width="3"/>
    <path d="M62 44 L72 55.5 L62 67" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".5"/>
  </g>
  <g transform="translate(114 30)">
    <rect width="92" height="110" rx="16" fill="${ROAD}" stroke="${INK}" stroke-width="2" opacity=".9"/>
    <path d="M18 88 C 30 56, 54 40, 78 34" fill="none" stroke="${SIGNAL}" stroke-width="5" stroke-linecap="round"/>
    <path d="M26 92 C 38 62, 60 47, 82 42" fill="none" stroke="${SIGNAL}" stroke-width="3" stroke-linecap="round" opacity=".45"/>
    <circle cx="20" cy="86" r="9" fill="none" stroke="${INK}" stroke-width="3"/>
    <circle cx="44" cy="62" r="6" fill="${INK}" opacity=".75"/>
  </g>
  <g transform="translate(216 30)">
    <rect width="92" height="110" rx="16" fill="${ROAD}" stroke="${INK}" stroke-width="2" opacity=".9"/>
    <path d="M24 78 L44 55 L24 32" fill="none" stroke="${GOLD}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M44 78 L64 55 L44 32" fill="none" stroke="${GOLD}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/>
    <path d="M18 96 L74 96" stroke="${GOLD}" stroke-width="5" stroke-linecap="round"/>
    <path d="M28 96 L74 96" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity=".35"/>
  </g>
  <!-- Named, because three glyphs alone leave the player matching pictures to
       a sentence. The labels say which card is which. -->
  <g fill="${DIM}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" font-weight="700" letter-spacing="2" text-anchor="middle">
    <text x="58" y="158">STEER</text>
    <text x="160" y="158">DRIFT</text>
    <text x="262" y="158">BOOST</text>
  </g>
</svg>`;

/*
 * The road forks and both ways are open. One keeps the payment alive. This is
 * the whole game in one picture, which is why it is the beat that comes last
 * and the only one that shows a wrong answer.
 */
const CHECKS_ART = `
<svg viewBox="0 0 320 170" role="img" aria-label="A relay gate forking the road into a safe route and a wrong one" focusable="false">
  <path d="M160 168 L160 104" stroke="${ROAD}" stroke-width="46" stroke-linecap="butt"/>
  <path d="M160 108 C 150 78, 108 60, 58 50" fill="none" stroke="${ROAD}" stroke-width="34" stroke-linecap="round"/>
  <path d="M160 108 C 170 78, 212 60, 262 50" fill="none" stroke="${ROAD}" stroke-width="34" stroke-linecap="round"/>
  <path d="M160 168 L160 112" stroke="${DIM}" stroke-width="3" stroke-dasharray="10 12" opacity=".8"/>
  <g>
    <path d="M160 108 C 150 78, 108 60, 58 50" fill="none" stroke="${CYAN}" stroke-width="4" stroke-linecap="round" opacity=".95"/>
    <rect x="18" y="24" width="80" height="30" rx="9" fill="${ROAD}" stroke="${CYAN}" stroke-width="3"/>
    <path d="M36 39 L45 48 L62 30" fill="none" stroke="${CYAN}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g opacity=".62">
    <rect x="222" y="24" width="80" height="30" rx="9" fill="${ROAD}" stroke="${DIM}" stroke-width="3"/>
    <path d="M247 32 L277 48 M277 32 L247 48" stroke="${SIGNAL}" stroke-width="5" stroke-linecap="round"/>
  </g>
  <g transform="translate(160 132)">
    <circle cx="-11" cy="10" r="7" fill="none" stroke="${INK}" stroke-width="3"/>
    <circle cx="12" cy="10" r="7" fill="none" stroke="${INK}" stroke-width="3"/>
    <path d="M-11 10 L-2 -3 L10 -3 L12 10" fill="none" stroke="${GOLD}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="3" cy="-12" r="5.5" fill="${INK}"/>
  </g>
</svg>`;

export const BLITZ_ONBOARDING_BEATS: readonly BlitzOnboardingBeat[] = [
  {
    id: 'job',
    kicker: 'THE JOB',
    title: 'A payment is stuck.',
    body: 'You are the route it takes. Ride it across the city and get it somewhere it cannot be undone.',
    art: JOB_ART,
  },
  {
    id: 'controls',
    kicker: 'THE RIDE',
    title: 'Steer. Drift. Boost.',
    body: 'Drag to steer. A gearbox buys one slide, and a slide earns nitro back. Spend the nitro on the straights.',
    art: CONTROLS_ART,
  },
  {
    id: 'supplies',
    kicker: 'THE SUPPLIES',
    title: 'Fuel is on the road.',
    body: 'Nitro bottles and gearboxes lie in the lanes. Nothing refills on its own, so the line you take is the speed you finish with.',
    art: SUPPLIES_ART,
  },
  {
    id: 'checks',
    kicker: 'THE CHECKS',
    title: 'Three calls, at speed.',
    body: 'The road forks and both ways are open. One keeps the payment alive. You do not get to slow down.',
    art: CHECKS_ART,
  },
];

const SEEN_KEY = 'nim-atlas:blitz:onboarded:v1';

/**
 * Whether this device has been shown the opening.
 *
 * Fails toward *not* showing it again: a storage read that throws should cost
 * a returning player three taps at most, and never trap them in an
 * introduction they have already read.
 */
export function blitzOnboardingSeen(storage: Pick<Storage, 'getItem'> | null): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markBlitzOnboardingSeen(storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(SEEN_KEY, '1');
  } catch {
    // A player who cannot be remembered still gets to play.
  }
}
