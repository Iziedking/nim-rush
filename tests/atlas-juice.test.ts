import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atlasJuiceForRoute, createAtlasJuice } from '../src/atlas/juice';

/*
 * The reaction layer.
 *
 * The city had a full audio vocabulary for its story beats — route-refused,
 * route-evidence, route-repaired, route-complete, wired at six call sites —
 * and nothing visual at all: no flash, no punch, no shake, no particle
 * anywhere in src/atlas. Succeeding at the thing the game is about produced a
 * line of text and a sound.
 *
 * Tested against a stub rather than jsdom because this repo installs no DOM
 * environment and a deadline is the wrong time to add one to the gate. The
 * stub implements exactly the five things juice.ts touches, so anything it
 * starts touching fails loudly here rather than silently passing.
 */
class StubClassList {
  private readonly names = new Set<string>();
  add(name: string): void { this.names.add(name); }
  remove(name: string): void { this.names.delete(name); }
  contains(name: string): boolean { return this.names.has(name); }
}

class StubElement {
  className = '';
  readonly classList = new StubClassList();
  readonly dataset: Record<string, string | undefined> = {};
  readonly attributes: Record<string, string> = {};
  readonly children: StubElement[] = [];
  parent: StubElement | null = null;
  /* Read by juice.ts purely to force a reflow; the value is never used. */
  readonly offsetWidth = 0;

  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  append(child: StubElement): void { child.parent = this; this.children.push(child); }
  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
}

const stubDocument = { createElement: () => new StubElement() };

function make(reducedMotion = false) {
  const host = new StubElement();
  const juice = createAtlasJuice({
    host: host as unknown as HTMLElement,
    reducedMotion,
    documentRef: stubDocument as unknown as Document,
  });
  return { host, juice, overlay: () => host.children[0]! };
}

describe('the reaction layer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('attaches one inert overlay that never eats input', () => {
    const { host, overlay } = make();
    expect(host.children).toHaveLength(1);
    expect(overlay().className).toBe('atlas-juice');
    expect(overlay().attributes['aria-hidden']).toBe('true');
    expect(overlay().dataset.kind).toBeUndefined();
  });

  it('names what happened in colour', () => {
    const { juice, overlay } = make();
    juice.flash('repaired');
    expect(overlay().dataset.kind).toBe('repaired');
  });

  it('retires the flash so the next beat starts clean', () => {
    const { juice, overlay } = make();
    juice.flash('evidence');
    vi.advanceTimersByTime(900);
    expect(overlay().dataset.kind).toBeUndefined();
  });

  /*
   * The case that matters most is a player retrying a step they were refused.
   * The second flash has to restart the clock rather than inherit the first's
   * remaining time, or a quick retry gets a stub of a reaction.
   */
  it('fires the same beat twice in a row without inheriting the first clock', () => {
    const { juice, overlay } = make();
    juice.flash('refused');
    vi.advanceTimersByTime(400);
    juice.flash('refused');
    vi.advanceTimersByTime(400);
    expect(overlay().dataset.kind).toBe('refused');
    vi.advanceTimersByTime(300);
    expect(overlay().dataset.kind).toBeUndefined();
  });

  it('pops the element that changed, then puts it back', () => {
    const { juice } = make();
    const card = new StubElement();
    juice.punch(card as unknown as Element);
    expect(card.classList.contains('atlas-punch')).toBe(true);
    vi.advanceTimersByTime(900);
    expect(card.classList.contains('atlas-punch')).toBe(false);
  });

  it('never leaves the class on an element it stopped watching', () => {
    const { juice } = make();
    const first = new StubElement();
    const second = new StubElement();
    juice.punch(first as unknown as Element);
    juice.punch(second as unknown as Element);
    expect(first.classList.contains('atlas-punch')).toBe(false);
    expect(second.classList.contains('atlas-punch')).toBe(true);
  });

  it('survives being asked to punch nothing', () => {
    const { juice } = make();
    expect(() => juice.punch(null)).not.toThrow();
  });

  /*
   * Reduced motion keeps the flash, because the colour carries the
   * information, and drops the pop, which carries only the feel. Dropping both
   * would make the game less legible for the people who asked for less
   * movement, not more comfortable.
   */
  it('keeps the colour and drops the movement under reduced motion', () => {
    const { juice, overlay } = make(true);
    const card = new StubElement();
    juice.flash('complete');
    juice.punch(card as unknown as Element);
    expect(overlay().dataset.kind).toBe('complete');
    expect(overlay().dataset.motion).toBe('reduced');
    expect(card.classList.contains('atlas-punch')).toBe(false);
  });

  it('goes quiet and cleans up when destroyed', () => {
    const { host, juice } = make();
    const card = new StubElement();
    juice.punch(card as unknown as Element);
    juice.destroy();
    expect(host.children).toHaveLength(0);
    expect(card.classList.contains('atlas-punch')).toBe(false);
  });

  it('is safe to destroy twice and to flash after destroying', () => {
    const { juice } = make();
    juice.destroy();
    expect(() => { juice.flash('repaired'); juice.punch(new StubElement() as unknown as Element); juice.destroy(); }).not.toThrow();
  });

  it('leaves no timer running after destroy', () => {
    const { juice } = make();
    juice.flash('repaired');
    juice.punch(new StubElement() as unknown as Element);
    juice.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('which reaction a beat earns', () => {
  it('maps each story beat to its own feeling', () => {
    expect(atlasJuiceForRoute('match-evidence', false)).toBe('evidence');
    expect(atlasJuiceForRoute('install', false)).toBe('repaired');
    expect(atlasJuiceForRoute('teach-back', false)).toBe('complete');
  });

  it('calls a refusal a refusal whatever the action was', () => {
    // The refusal set is long and lives at the call site; what matters here is
    // that being refused always outranks the action that earned it.
    expect(atlasJuiceForRoute('install', true)).toBe('refused');
    expect(atlasJuiceForRoute('teach-back', true)).toBe('refused');
  });

  it('still answers for an action it has never seen', () => {
    expect(atlasJuiceForRoute('some-future-action', false)).toBe('evidence');
  });
});
