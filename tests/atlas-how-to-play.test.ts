import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../src/atlas/ui/how-to-play.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const guideDoc = readFileSync(new URL('../docs/nim-atlas-how-to-play.md', import.meta.url), 'utf8');
const shoot = readFileSync(new URL('../scripts/shoot-atlas.mjs', import.meta.url), 'utf8');

describe('NIM Atlas clarity pass', () => {
  it('keeps the first-use explanation to four playable moves', () => {
    expect(guide).toContain('ATLAS_HOW_TO_PLAY_STEPS');
    expect((guide.match(/number: '/g) ?? []).length).toBe(4);
    expect(guide.length).toBeLessThan(4_500);
    expect(app).toContain('openHowToPlay');
    expect(app).toContain("ghostButton('How to play'");
  });

  it('keeps the landing screen focused on the first human need', () => {
    /*
     * The test is named for the human need, so it asserts the human need.
     *
     * It used to also pin "Sface is a Nimiq Pay Mini App game", which is the
     * opposite of a human need: it is the delivery mechanism, and it sat above
     * the start button pushing Mara down the screen. The relationship is now
     * stated on the About screen, which atlas-ui.test.ts covers.
     */
    expect(app).toContain('Mara needs one safe NIM payment route. Restore it, carry the lantern, relight the harbor.');
    expect(app).toContain('Explorer: inspect, approve, confirm.');
    expect(app).toContain('Builder: repair, predict, verify.');
  });

  it('connects each move to a concrete Nimiq Pay idea', () => {
    expect(guide).toContain('NIM');
    expect(guide).toContain('Nimiq Pay');
    expect(guide).toContain('Lunas');
    expect(guide).toContain('current network record');
    expect(guide).toContain('Ask');
    expect(guide).toContain('Check');
    expect(guide).toContain('Approve');
    expect(guide).toContain('Confirm');
    expect(guide).toContain('Unlock');
  });

  it('explains Lunas before using payment evidence vocabulary', () => {
    expect(guide).toContain('Lunas are the smallest units of NIM');
    expect(guide).toContain('1 NIM = 100,000 Lunas');
    expect(guide).toContain('0.1 NIM = 10,000 Lunas');
    expect(guide).toContain('permission');
    expect(guide).toContain('current network record');
  });

  it('makes the visual proof gallery part of the product documentation', () => {
    expect(app).toContain('atlas-snapshot-grid');
    expect(guide).toContain('/atlas/screenshots/atlas-390-pay-harbor.png');
    expect(guide).toContain('/atlas/screenshots/atlas-430-payment-review.png');
    expect(css).toContain('.atlas-how-to-play');
    expect(css).toContain('.atlas-snapshot-grid');
    expect(css).toContain('min-height: 44px');
    expect(readme).toContain('## The player loop');
    expect(readme).toContain('atlas-390-pay-harbor.png');
    expect(guideDoc).toContain('# How to play NIM Atlas');
    expect(guideDoc).toContain('Ask');
    expect(guideDoc).toContain('atlas-390-payment-review.png');
  });

  it('keeps captured product snapshots available to the built app', () => {
    expect(shoot).toContain("'public', 'atlas', 'screenshots'");
  });
});
