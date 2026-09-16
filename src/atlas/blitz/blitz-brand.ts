import { createNimiqMark } from '../ui/nimiq-mark';

const RUSH_LOGO_SVG = `
<svg viewBox="0 0 520 210" role="img" aria-labelledby="rush-logo-title rush-logo-desc" xmlns="http://www.w3.org/2000/svg">
  <title id="rush-logo-title">NIM RUSH</title>
  <desc id="rush-logo-desc">A downhill rider cutting across a ridgeline.</desc>
  <path class="blitz-logo-skyline" d="M14 145 104 83l42 27 74-68 69 55 60-35 157 83" />
  <path class="blitz-logo-sun" d="M405 35 418 65l31 13-31 13-13 31-13-31-31-13 31-13Z" />
  <path class="blitz-logo-wheel" d="M132 139a25 25 0 1 0 50 0 25 25 0 0 0-50 0Zm198 0a25 25 0 1 0 50 0 25 25 0 0 0-50 0Z" />
  <path class="blitz-logo-bike" d="m151 139 42-53 37 53 100 0m-100 0 33-53 29 53m-62-53 31-18m-31 18h-26m93 0 22-23h27" />
  <path class="blitz-logo-rider" d="m224 60 28 13 21 26m-49-39 18-26 29 6 10 23m-49-3-21 29" />
  <path class="blitz-logo-badge" d="M22 170h476" />
  <text class="blitz-logo-wordmark" x="20" y="39">NIM RUSH</text>
  <text class="blitz-logo-subtitle" x="23" y="196">RIDE THE RIDGE</text>
</svg>`;

export type RushLogoVariant = 'hero' | 'compact';

export function createRushLogo(variant: RushLogoVariant = 'hero'): HTMLElement {
  const logo = document.createElement('div');
  logo.className = `blitz-rush-logo blitz-rush-logo-${variant}`;
  logo.setAttribute('aria-label', 'NIM RUSH, ride the ridge');
  logo.innerHTML = RUSH_LOGO_SVG;
  return logo;
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
