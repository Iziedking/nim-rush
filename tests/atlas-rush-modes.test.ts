import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BLITZ_BASE_LOADOUT, blitzLoadoutFor } from '../shared/atlas/blitz/rider';

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
    expect(app).toContain('blitz-rules-link');
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
