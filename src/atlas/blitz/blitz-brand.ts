import { createNimiqMark } from '../ui/nimiq-mark';

/*
 * The NIM RUSH mark.
 *
 * Drawn as mass, not as line. The previous mark was a thin single-weight
 * outline of a mountain, a bike, a rider and a four-point sparkle - four ideas
 * at one stroke weight, which at favicon size collapsed into grey fuzz, and a
 * sparkle is the first thing that makes a logo look machine-made.
 *
 * This is one idea: a rider in the tuck, inside a badge. Every stroke is heavy
 * enough to survive being drawn at sixteen pixels, the shapes read as a
 * cyclist before they read as anything else, and the badge gives the mark a
 * silhouette of its own so it is recognisable even when the rider inside is
 * too small to resolve.
 *
 * The language is enamel: a thick ink keyline around a flat colour, with a
 * hard offset shadow and no blur anywhere. That is what separates a drawn mark
 * from a rendered one.
 */

/*
 * The badge, built as three stacked plates rather than one.
 *
 * A flat sticker in front of a rendered three-dimensional world reads as a
 * sticker on a photograph - the identity and the game look like they came from
 * different places. So the badge is extruded: an ink shadow at the back, a
 * darkened amber side wall where the thickness would be, and the lit face on
 * top with a highlight along its upper edge.
 *
 * Still no blur and no gradient mesh. The depth comes from three flat shapes
 * offset from one another, which is how a painted object is drawn and how it
 * stays crisp at any size.
 */
const BADGE = `
  <rect class="blitz-logo-drop" x="20" y="28" width="168" height="168" rx="42" />
  <rect class="blitz-logo-side" x="14" y="22" width="168" height="168" rx="42" />
  <rect class="blitz-logo-plate" x="8" y="16" width="168" height="168" rx="42" />
  <path class="blitz-logo-gloss" d="M8 58C8 35 27 16 50 16h84c-34 6-58 18-76 34S14 88 8 118Z" />`;

/** Shared so the favicon and the in-app lockup cannot drift apart. */
const RIDER_PATHS = `
  <g fill="none" stroke="#14131d" stroke-linecap="round" stroke-linejoin="round">
    <!-- Wheels. Heavy rings: at small sizes these carry the whole idea. -->
    <circle cx="50" cy="124" r="22" stroke-width="11" />
    <circle cx="124" cy="124" r="22" stroke-width="11" />
    <!-- Rear triangle, down tube and top tube. -->
    <path d="M50 124 88 120 74 92 50 124M88 120 118 98M74 92h36" stroke-width="10" />
    <!-- Fork. -->
    <path d="M118 98 124 124" stroke-width="10" />
    <!-- The flat back, which is the whole attitude of the reference. -->
    <path d="M70 84 106 72" stroke-width="14" />
    <!-- Arm reaching down and forward to the bars. -->
    <path d="M106 72 118 96" stroke-width="10" />
    <!-- Driving leg. -->
    <path d="M72 88 92 108 88 120" stroke-width="12" />
    <!-- Neck, so the head reads as attached rather than floating. -->
    <path d="M106 72 116 66" stroke-width="10" />
  </g>
  <circle cx="122" cy="62" r="12" fill="#14131d" />`;

const RUSH_LOGO_SVG = `
<svg viewBox="0 0 560 208" role="img" aria-labelledby="rush-logo-title rush-logo-desc" xmlns="http://www.w3.org/2000/svg">
  <title id="rush-logo-title">NIM RUSH</title>
  <desc id="rush-logo-desc">A rider tucked low over a bike, inside a badge, beside the words NIM RUSH.</desc>
${BADGE}
  <g transform="translate(8 16) scale(1.02)">${RIDER_PATHS}</g>
  <text class="blitz-logo-wordmark blitz-logo-wordmark-drop" x="210" y="98">NIM</text>
  <text class="blitz-logo-wordmark" x="204" y="92">NIM</text>
  <text class="blitz-logo-wordmark blitz-logo-wordmark-drop" x="210" y="176">RUSH</text>
  <text class="blitz-logo-wordmark" x="204" y="170">RUSH</text>
</svg>`;

export type RushLogoVariant = 'hero' | 'compact';

export function createRushLogo(variant: RushLogoVariant = 'hero'): HTMLElement {
  const logo = document.createElement('div');
  logo.className = `blitz-rush-logo blitz-rush-logo-${variant}`;
  logo.setAttribute('aria-label', 'NIM RUSH');
  logo.innerHTML = RUSH_LOGO_SVG;
  return logo;
}

/**
 * The mark on its own.
 *
 * For the places a full lockup does not fit - a run HUD, a result header, a
 * share card - where the badge alone has to carry the identity.
 */
export function createRushMark(): HTMLElement {
  const mark = document.createElement('div');
  mark.className = 'blitz-rush-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = `
<svg viewBox="0 0 192 204" xmlns="http://www.w3.org/2000/svg" focusable="false">
  ${BADGE}
  <g transform="translate(8 16) scale(1.02)">${RIDER_PATHS}</g>
</svg>`;
  return mark;
}

export function createNimiqPoweredBy(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'blitz-powered';
  footer.setAttribute('aria-label', 'Powered by Nimiq');
  const label = document.createElement('span');
  label.textContent = 'POWERED BY';
  footer.append(label, createNimiqMark('lockup', { className: 'blitz-nimiq-lockup' }));
  return footer;
}
