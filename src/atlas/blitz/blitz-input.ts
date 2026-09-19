import type { BlitzInput } from '../../../shared/atlas/blitz/types';

export class BlitzInputController {
  private steer = 0;
  private drift = false;
  private boost = false;
  private brake = false;
  private tuck = false;
  private steeringPointer: number | null = null;
  private readonly pressed = new Set<string>();
  private readonly cleanups: Array<() => void> = [];
  private readonly bindingCleanups: Array<() => void> = [];
  private readonly latchTargets = new Map<string, HTMLElement>();

  constructor(target: Window = window) {
    const keydown = (event: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyS', 'KeyW', 'ShiftLeft', 'ShiftRight', 'Space'].includes(event.code)) event.preventDefault();
      this.pressed.add(event.code);
      this.readKeyboard();
    };
    const keyup = (event: KeyboardEvent) => {
      this.pressed.delete(event.code);
      this.readKeyboard();
    };
    const blur = () => this.reset();
    target.addEventListener('keydown', keydown, { passive: false });
    target.addEventListener('keyup', keyup);
    target.addEventListener('blur', blur);
    this.cleanups.push(() => target.removeEventListener('keydown', keydown), () => target.removeEventListener('keyup', keyup), () => target.removeEventListener('blur', blur));
  }

  bindSteering(zone: HTMLElement, thumb: HTMLElement): void {
    /*
     * A stick that centres wherever the thumb lands, not a slider.
     *
     * Steer used to be read as the absolute x of the finger inside a 200px
     * card, while the thumb graphic only ever moved 42px - so the affordance
     * and the mapping disagreed, and a rider had to find the middle of a
     * control they could not see under their own hand before they could go
     * straight. Measuring from where the finger landed means the middle is
     * always under the thumb, which is how every stick on a phone works.
     */
    let originX = 0;
    let travel = 48;
    const update = (event: PointerEvent) => {
      if (event.pointerId !== this.steeringPointer) return;
      const raw = clamp((event.clientX - originX) / travel, -1, 1);
      /*
       * Quantised to three decimals, here, before the simulation ever sees it.
       *
       * A full double costs thirteen characters in every one of a run's 3,600
       * trace frames, which is most of the reason a finished run was too large
       * to save or send. Rounding at the boundary keeps the number the sim
       * consumes and the number the server replays byte-identical; rounding
       * later would make two different runs hash the same.
       */
      this.steer = Math.round(raw * 1_000) / 1_000;
      thumb.style.transform = `translateX(${Math.round(this.steer * travel)}px)`;
    };
    const down = (event: PointerEvent) => {
      // Before anything else: iOS will otherwise start its own long-press,
      // selection and callout handling on a control that is meant to be held.
      event.preventDefault();
      if (this.steeringPointer !== null) return;
      this.steeringPointer = event.pointerId;
      // Full lock is a third of the pad either way, so a thumb reaches it
      // without lifting, and the stick recentres on every fresh press.
      travel = Math.max(34, Math.round(zone.getBoundingClientRect().width * 0.33));
      originX = event.clientX;
      update(event);
      /*
       * Capture is a nicety, and it is attempted last on purpose. WebKit throws
       * NotFoundError when the pointer id is already gone, and this used to run
       * first: the exception escaped the listener and the steering was never
       * armed at all. The same pattern, for the same reason, is at
       * src/atlas/app/atlas-app.ts:2531.
       */
      try { zone.setPointerCapture?.(event.pointerId); } catch { /* the window listeners below cover it */ }
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== this.steeringPointer) return;
      this.steeringPointer = null;
      this.steer = 0;
      thumb.style.transform = 'translateX(0)';
    };
    zone.addEventListener('pointerdown', down);
    /*
     * Move and release are watched on the window, not the element.
     *
     * Without capture - which WebKit can refuse or drop - a finger that slid
     * off the card left the steer frozen at its last value and the bike turning
     * by itself. Listening wider also makes the pad behave the way a thumb
     * expects: the steer keeps tracking when the finger wanders past the edge.
     */
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    /*
     * And a last resort, on touch: when no finger is left on the glass, the
     * steering is not being held, whatever the pointer bookkeeping believes.
     *
     * The pointerup handler can only release a pointer id it recognises, so a
     * release that arrives without one - which happens on real hardware when a
     * gesture is taken over, and in automation - left the steer frozen at its
     * last value and the bike turning on its own for the rest of the run. A
     * run that keeps steering after the rider let go is the clearest possible
     * version of "the game is playing itself".
     */
    const allFingersUp = (event: TouchEvent) => {
      if (event.touches.length > 0 || this.steeringPointer === null) return;
      this.steeringPointer = null;
      this.steer = 0;
      thumb.style.transform = 'translateX(0)';
    };
    window.addEventListener('touchend', allFingersUp);
    window.addEventListener('touchcancel', allFingersUp);
    this.bindingCleanups.push(
      () => zone.removeEventListener('pointerdown', down),
      () => window.removeEventListener('pointermove', update),
      () => window.removeEventListener('pointerup', up),
      () => window.removeEventListener('pointercancel', up),
      () => window.removeEventListener('touchend', allFingersUp),
      () => window.removeEventListener('touchcancel', allFingersUp),
    );
  }

  bindHold(button: HTMLElement, action: 'drift' | 'boost' | 'brake' | 'tuck'): void {
    const set = (active: boolean) => {
      if (action === 'drift') this.drift = active;
      else if (action === 'boost') this.boost = active;
      else if (action === 'tuck') this.tuck = active;
      else this.brake = active;
      button.classList.toggle('is-held', active);
    };
    let holdPointer: number | null = null;
    const down = (event: PointerEvent) => {
      event.preventDefault();
      if (holdPointer !== null) return;
      holdPointer = event.pointerId;
      /*
       * The state is set before capture is attempted, and this is the whole bug
       * that made DRIFT and TUCK dead on iPhone. setPointerCapture threw
       * NotFoundError inside WebKit, the exception escaped this listener, and
       * set(true) never ran - so the simulation never saw the hold. Tuck is
       * worth twenty seconds over a run and it did nothing, all session.
       */
      set(true);
      try { button.setPointerCapture?.(event.pointerId); } catch { /* the window listeners below cover it */ }
    };
    const up = (event?: PointerEvent) => {
      if (event && holdPointer !== null && event.pointerId !== holdPointer) return;
      holdPointer = null;
      set(false);
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    /*
     * No lostpointercapture handler. WebKit drops capture while a finger is
     * still down, and releasing the control on that signal is how a held BOOST
     * quietly turned itself off mid-run. The window listeners are the honest
     * release: they fire when the finger actually lifts, wherever it is.
     */
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.bindingCleanups.push(
      () => button.removeEventListener('pointerdown', down),
      () => button.removeEventListener('pointerup', up),
      () => button.removeEventListener('pointercancel', up),
      () => window.removeEventListener('pointerup', up),
      () => window.removeEventListener('pointercancel', up),
    );
  }

  /**
   * A control you tap on and tap off, rather than hold.
   *
   * Boost is the case this exists for. Holding it means a thumb parked on the
   * bottom-right of the screen for as long as the tank lasts, while the other
   * thumb is steering - which is why it was the only control anybody could
   * reliably use, and why holding it long enough made iOS offer to copy the
   * word off the button. A tap lights it; a tap, or an empty tank, puts it out.
   */
  bindLatch(button: HTMLElement, action: 'drift' | 'boost' | 'brake' | 'tuck'): void {
    const fire = (event: PointerEvent) => {
      event.preventDefault();
      this.setLatch(action, !this.readAction(action), button);
    };
    button.addEventListener('pointerdown', fire);
    this.latchTargets.set(action, button);
    this.bindingCleanups.push(() => {
      button.removeEventListener('pointerdown', fire);
      this.latchTargets.delete(action);
    });
  }

  /**
   * A control that fires once and lets go by itself.
   *
   * Drift spends a gearbox and buys a fixed window; there is nothing to hold,
   * because the simulation ends the slide on its own schedule. Holding it only
   * ever meant the rider was still pressing a button that had stopped doing
   * anything.
   */
  bindPulse(button: HTMLElement, action: 'drift' | 'boost' | 'brake' | 'tuck', durationMs: number): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = (event: PointerEvent) => {
      event.preventDefault();
      if (timer !== null) return;
      this.setLatch(action, true, button);
      timer = setTimeout(() => { timer = null; this.setLatch(action, false, button); }, durationMs);
    };
    button.addEventListener('pointerdown', fire);
    this.bindingCleanups.push(() => {
      button.removeEventListener('pointerdown', fire);
      if (timer !== null) { clearTimeout(timer); timer = null; }
      this.setLatch(action, false, button);
    });
  }

  /** Put a latched control out from outside - an empty tank, or a new run. */
  setLatch(action: 'drift' | 'boost' | 'brake' | 'tuck', active: boolean, target?: HTMLElement): void {
    if (action === 'drift') this.drift = active;
    else if (action === 'boost') this.boost = active;
    else if (action === 'tuck') this.tuck = active;
    else this.brake = active;
    (target ?? this.latchTargets.get(action))?.classList.toggle('is-held', active);
  }

  private readAction(action: 'drift' | 'boost' | 'brake' | 'tuck'): boolean {
    if (action === 'drift') return this.drift;
    if (action === 'boost') return this.boost;
    if (action === 'tuck') return this.tuck;
    return this.brake;
  }

  /*
   * The one place a gesture becomes a lane.
   *
   * `this.steer` is what the thumb did: right of where the finger landed is
   * positive, which is also what the thumb on the stick draws. The simulation
   * does not steer in screen space, it steers in LANE space, and a lane is
   * measured from the centre line along (cos h, -sin h) - which is the rider's
   * LEFT. Positive steer therefore moved the bike to the left of the screen,
   * and two riders reported it on the first morning the game was public:
   * "sliding to the right takes me left and vice versa".
   *
   * Negating here, at the boundary, is the whole fix. The simulation keeps its
   * lane convention, so no rule changes, no ruleset bump, and every run already
   * on today's board still replays to the score it was given. The renderer is
   * handed this same value, so the bike leans and the fork turns exactly as
   * they did relative to the screen.
   */
  sample(): BlitzInput {
    // `|| 0` because negating zero gives -0, and a centred stick must report
    // the same zero every frame rather than one that depends on a sign bit.
    return { steer: -this.steer || 0, drift: this.drift, boost: this.boost, brake: this.brake, tuck: this.tuck };
  }

  reset(): void {
    this.pressed.clear();
    this.steer = 0;
    this.drift = false;
    this.boost = false;
    this.brake = false;
    this.tuck = false;
    this.steeringPointer = null;
  }

  clearBindings(): void {
    for (const cleanup of this.bindingCleanups.splice(0)) cleanup();
    this.reset();
  }

  destroy(): void {
    this.clearBindings();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.reset();
  }

  private readKeyboard(): void {
    const left = this.pressed.has('ArrowLeft') || this.pressed.has('KeyA');
    const right = this.pressed.has('ArrowRight') || this.pressed.has('KeyD');
    this.steer = left === right ? 0 : left ? -1 : 1;
    this.drift = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight');
    this.boost = this.pressed.has('Space');
    this.brake = this.pressed.has('ArrowDown') || this.pressed.has('KeyS');
    this.tuck = this.pressed.has('ArrowUp') || this.pressed.has('KeyW');
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
