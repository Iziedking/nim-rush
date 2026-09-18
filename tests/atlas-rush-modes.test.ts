import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BLITZ_BASE_LOADOUT, blitzLoadoutFor } from '../shared/atlas/blitz/rider';
import { getBlitzDailyChallenge } from '../shared/atlas/blitz/daily';

const app = readFileSync(new URL('../src/atlas/blitz/blitz-app.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/atlas/blitz/blitz.css', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../docs/how-nim-rush-works.md', import.meta.url), 'utf8');

/*
 * Two modes, and which one counts.
 *
 * Free run is open to anyone with no wallet and never takes a place on the
 * board. The daily challenge is free to enter, needs a wallet for identity
 * only, and is the one that ranks. The failure this guards against is a rider
 * spending ninety seconds on a run and only then discovering it was not the
 * one that counted - so the landing has to say which is which before either
 * one is ridden.
 */
describe('free run and daily challenge', () => {
  /*
   * Nimiq is the way in.
   *
   * Nothing is playable without a wallet, so the panel behind that decision is
   * one action and no alternatives. A second path would make the wallet look
   * optional, which is the thing that is no longer true.
   */
  it('leads with connecting Nimiq, and offers nothing else until it is done', () => {
    expect(app).toContain('Connect Nimiq wallet');
    expect(app).toContain('if (!this.connectedWallet)');
    expect(app).toContain('connectWallet');
    // The old promise is gone rather than merely unused.
    expect(app).not.toContain('No wallet needed to play');
  });

  it('offers the challenge and practice once connected, challenge first', () => {
    expect(app).toContain('DAILY CHALLENGE');
    expect(app).toContain('Free run');
    expect(app.indexOf("node('span', 'blitz-mode-label', 'DAILY CHALLENGE')")).toBeLessThan(app.indexOf("'blitz-again blitz-free-run'"));
    expect(css).toContain('.blitz-mode-label');
  });

  it('asks for a signature and never for a payment', () => {
    expect(app).toContain('Signs your identity. Never a payment.');
    // An entry fee would make the pool a wager rather than a skill contest.
    expect(rules).toContain('no entry fee into a prize pool');
  });

  /*
   * Over-explanation is the thing being removed, so the test has to hold the
   * line: the panel states the prize, and the rules document states how it is
   * divided and when it settles.
   */
  it('keeps the arithmetic off the panel and in the rules', () => {
    expect(app).not.toMatch(/Paid to the top three/);
    expect(rules).toContain('50% / 30% / 20%');
    expect(app).toContain('blitz-open-rules');
  });

  it('reads the rules in the app rather than navigating away from it', () => {
    /*
     * Rules used to be an anchor to /docs/how-nim-rush-works.md. That file is
     * not deployed, so production's single-page fallback answered it with
     * index.html and a 200 - the app reloaded and the rider was dropped back on
     * the start screen having read nothing. It only ever worked in dev, where
     * Vite serves the repository root.
     */
    // The path still appears in the comment explaining this; what must not
    // come back is anything that navigates to it.
    expect(app).not.toMatch(/rules\.href\s*=/);
    expect(app).not.toContain('blitz-rules-link');
    expect(app).toContain("data-blitz-screen', 'rules'");
    expect(app).toContain('createBlitzRulesBody');
  });

  /*
   * The pool is the reason to come back, so it belongs on the screen a rider
   * decides from. It used to appear only after a run had already been ridden.
   */
  it('shows the day pool on the landing, not only after a run', () => {
    const landing = app.slice(app.indexOf('private renderIntro'), app.indexOf('private renderRunScreen'));
    expect(landing).toContain('this.presentDayPool(pool)');
    expect(landing).toContain("node('section', 'blitz-pool')");
  });

  /*
   * And the rule underneath all of it: the ranked mode is the one that ranks,
   * so it is the one that must be equal for everybody.
   */
  it('rides every ranked run on the same equipment whatever the rider has earned', () => {
    expect(blitzLoadoutFor({ careerScore: 500_000, ranked: true })).toEqual(BLITZ_BASE_LOADOUT);
    expect(app).toContain('ranked: Boolean(rankedTicket)');
  });
});

/*
 * A private lobby has to be one race, not several.
 *
 * A free run seeds itself from the current minute. That is right for practice
 * and wrong for a lobby: two friends tapping Ride a minute apart were riding
 * different courses and comparing scores that had nothing in common. The seat
 * list looked like a race and the racing was never connected to it.
 *
 * The day's challenge seed is the same string for everyone, all day, so every
 * seat gets the same corners in the same order.
 */
describe('everybody in a lobby rides one course', () => {
  it('hands the lobby the day-stable seed, not a per-minute one', () => {
    // The ride action passes an explicit seed rather than falling through to
    // the minute-based one a solo practice run uses.
    expect(app).toContain('onRide: () => void this.startRun(\'lagos\', null, {');
    expect(app).toContain('seed: getBlitzDailyChallenge({ now: Date.now(), cityId: \'lagos\', seasonId: BLITZ_SEASON }).seed,');
    expect(app).toContain('const seed = rankedTicket?.seed ?? options.seed ??');
  });

  it('keeps the same seed for two riders an hour apart on the same day', () => {
    const morning = getBlitzDailyChallenge({ now: Date.parse('2026-09-17T06:00:00Z'), cityId: 'lagos', seasonId: 'cycle-2' });
    const evening = getBlitzDailyChallenge({ now: Date.parse('2026-09-17T21:30:00Z'), cityId: 'lagos', seasonId: 'cycle-2' });
    expect(morning.seed).toBe(evening.seed);
    // And a different day is a different hill, which is the point of a daily.
    const tomorrow = getBlitzDailyChallenge({ now: Date.parse('2026-09-18T06:00:00Z'), cityId: 'lagos', seasonId: 'cycle-2' });
    expect(tomorrow.seed).not.toBe(morning.seed);
  });
});
