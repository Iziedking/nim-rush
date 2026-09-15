import type { BlitzInput } from '../../../shared/atlas/blitz/types';

export class BlitzInputController {
  private steer = 0;
  private drift = false;
  private boost = false;
  private brake = false;
  private steeringPointer: number | null = null;
  private readonly pressed = new Set<string>();
  private readonly cleanups: Array<() => void> = [];
  private readonly bindingCleanups: Array<() => void> = [];

  constructor(target: Window = window) {
    const keydown = (event: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyS', 'ShiftLeft', 'ShiftRight', 'Space'].includes(event.code)) event.preventDefault();
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
    const update = (event: PointerEvent) => {
      if (event.pointerId !== this.steeringPointer) return;
      const bounds = zone.getBoundingClientRect();
      this.steer = clamp(((event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5) * 2, -1, 1);
      thumb.style.transform = `translateX(${Math.round(this.steer * 42)}px)`;
    };
    const down = (event: PointerEvent) => {
      if (this.steeringPointer !== null) return;
      this.steeringPointer = event.pointerId;
      zone.setPointerCapture(event.pointerId);
      update(event);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== this.steeringPointer) return;
      this.steeringPointer = null;
      this.steer = 0;
      thumb.style.transform = 'translateX(0)';
    };
    zone.addEventListener('pointerdown', down);
    zone.addEventListener('pointermove', update);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    this.bindingCleanups.push(
      () => zone.removeEventListener('pointerdown', down),
      () => zone.removeEventListener('pointermove', update),
      () => zone.removeEventListener('pointerup', up),
      () => zone.removeEventListener('pointercancel', up),
    );
  }

  bindHold(button: HTMLElement, action: 'drift' | 'boost' | 'brake'): void {
    const set = (active: boolean) => {
      if (action === 'drift') this.drift = active;
      else if (action === 'boost') this.boost = active;
      else this.brake = active;
      button.classList.toggle('is-held', active);
    };
    const down = (event: PointerEvent) => {
      button.setPointerCapture(event.pointerId);
      set(true);
    };
    const up = () => set(false);
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
    this.bindingCleanups.push(
      () => button.removeEventListener('pointerdown', down),
      () => button.removeEventListener('pointerup', up),
      () => button.removeEventListener('pointercancel', up),
      () => button.removeEventListener('lostpointercapture', up),
    );
  }

  sample(): BlitzInput {
    return { steer: this.steer, drift: this.drift, boost: this.boost, brake: this.brake };
  }

  reset(): void {
    this.pressed.clear();
    this.steer = 0;
    this.drift = false;
    this.boost = false;
    this.brake = false;
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
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
