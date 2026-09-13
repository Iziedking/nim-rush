/*
 * What the world does when you get something right.
 *
 * The city had a full audio vocabulary for its story beats — route-refused,
 * route-evidence, route-repaired, route-complete — wired at six call sites, and
 * *nothing* visual at all: no flash, no punch, no shake, no particle anywhere
 * in src/atlas. Succeeding at the thing the whole game is about produced a line
 * of text and a sound. That is most of what a playtester means by "dull": the
 * world does not react to them.
 *
 * This is the reaction layer. It is deliberately screen-space and DOM-based
 * rather than part of the three.js scene: it costs no draw calls, it works
 * identically on the 2D district screens and over the 3D city, and it cannot
 * break the renderer on a device whose WebGL context is already marginal.
 */

export type AtlasJuiceKind = 'refused' | 'evidence' | 'repaired' | 'complete';

export interface AtlasJuiceController {
  /** Flash the world in the colour of what just happened. */
  flash(kind: AtlasJuiceKind): void;
  /** Pop one element, for the thing that actually changed. */
  punch(target: Element | null): void;
  /** Detach the overlay. Safe to call twice. */
  destroy(): void;
}

export interface AtlasJuiceOptions {
  readonly host: HTMLElement;
  /**
   * Honoured, not ignored.
   *
   * Reduced motion still gets the flash, because a colour change carries the
   * information, and loses the shake and the scale punch, which carry only the
   * feel. Dropping both would make the game less legible for the people who
   * asked for less movement, not more comfortable.
   */
  readonly reducedMotion?: boolean;
  readonly documentRef?: Document;
}

/* Longest animation in the sheet, plus a margin. Used to retire the class. */
const FLASH_MS = 620;

export function createAtlasJuice(options: AtlasJuiceOptions): AtlasJuiceController {
  const doc = options.documentRef ?? options.host.ownerDocument;
  const overlay = doc.createElement('div');
  overlay.className = 'atlas-juice';
  overlay.setAttribute('aria-hidden', 'true');
  options.host.append(overlay);

  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let punchTimer: ReturnType<typeof setTimeout> | null = null;
  let punched: Element | null = null;
  let destroyed = false;

  return {
    flash(kind) {
      if (destroyed) return;
      /*
       * Clearing the attribute and forcing a reflow before setting it again is
       * what lets the same beat fire twice in a row. Without the reflow the
       * browser coalesces both writes and the second flash never plays, which
       * is exactly the case that matters: a player retrying a refused step.
       */
      delete overlay.dataset.kind;
      void overlay.offsetWidth;
      overlay.dataset.kind = kind;
      overlay.dataset.motion = options.reducedMotion ? 'reduced' : 'full';
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        delete overlay.dataset.kind;
        flashTimer = null;
      }, FLASH_MS);
    },

    punch(target) {
      if (destroyed || !target || options.reducedMotion) return;
      // One element at a time: a second punch retires the first rather than
      // leaving a class behind on an element nobody is looking at any more.
      if (punched && punched !== target) punched.classList.remove('atlas-punch');
      if (punchTimer) clearTimeout(punchTimer);
      target.classList.remove('atlas-punch');
      void (target as HTMLElement).offsetWidth;
      target.classList.add('atlas-punch');
      punched = target;
      punchTimer = setTimeout(() => {
        target.classList.remove('atlas-punch');
        punched = null;
        punchTimer = null;
      }, FLASH_MS);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (flashTimer) clearTimeout(flashTimer);
      if (punchTimer) clearTimeout(punchTimer);
      punched?.classList.remove('atlas-punch');
      punched = null;
      overlay.remove();
    },
  };
}

/**
 * Which reaction a route action earns.
 *
 * Kept beside the controller rather than at the call site so the mapping from
 * story beat to feeling is stated once, next to the colours it implies.
 */
export function atlasJuiceForRoute(action: string, refusal: boolean): AtlasJuiceKind {
  if (refusal) return 'refused';
  if (action === 'match-evidence') return 'evidence';
  if (action === 'install') return 'repaired';
  if (action === 'teach-back') return 'complete';
  return 'evidence';
}
