import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const signet = readFileSync(new URL('../public/atlas/brand/nimiq-signet.svg', import.meta.url), 'utf8');
const lockup = readFileSync(new URL('../public/atlas/brand/nimiq-logo-horizontal.svg', import.meta.url), 'utf8');
const mark = readFileSync(new URL('../src/atlas/ui/nimiq-mark.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');

/*
 * Nimiq appeared on none of the sixteen shipped screenshots, including the
 * payment review, which is the one screen where a player is being asked to
 * approve a real transfer. These assets are the official files from
 * github.com/nimiq/designs, downloaded rather than redrawn, because an
 * approximated mark shown to the Nimiq team is worse than no mark.
 */
describe('Nimiq brand presence', () => {
  it('ships the official assets rather than a redrawn approximation', () => {
    for (const [name, source] of [['signet', signet], ['lockup', lockup]] as const) {
      expect(source.slice(0, 200), `${name} is not an SVG`).toContain('<svg');
      // The official radial gradient. If these stops change, the file is no
      // longer Nimiq's artwork.
      expect(source.toLowerCase(), `${name} lost the official gradient`).toContain('#ec991c');
      expect(source.toLowerCase(), `${name} lost the official gradient`).toContain('#e9b213');
    }
  });

  it('keeps the two files referenced rather than inlined, because their ids collide', () => {
    /*
     * Both official files declare id="radial-gradient" and a .cls-1 class. Two
     * inlined copies in one document would share those, so the second one's
     * gradient would resolve to the first one's definition. Referencing them
     * through <img> keeps each in its own document.
     */
    expect(signet).toContain('id="radial-gradient"');
    expect(lockup).toContain('id="radial-gradient"');
    expect(mark, 'the mark helper inlines SVG markup').not.toContain('<svg');
    expect(app, 'the app inlines Nimiq SVG markup').not.toContain('radial-gradient');
  });

  it('defines the asset paths in exactly one place', () => {
    expect(mark).toContain('/atlas/brand/nimiq-signet.svg');
    expect(mark).toContain('/atlas/brand/nimiq-logo-horizontal.svg');
    // Everything else asks the helper, so the paths cannot drift apart.
    expect(app, 'the app hardcodes a brand asset path').not.toContain('/atlas/brand/');
  });

  it('never recolours or dims the mark', () => {
    // Nimiq's guidelines govern this artwork, and the product's own rule is
    // that magenta is the only accent. The resolution is to leave the mark in
    // its official colours and not treat it as a UI accent at all.
    const rule = sheet.slice(sheet.indexOf('.atlas-nimiq-mark'), sheet.indexOf('}', sheet.indexOf('.atlas-nimiq-mark')));
    expect(rule.length, '.atlas-nimiq-mark has no rule').toBeGreaterThan(0);
    expect(rule, 'the mark is filtered').not.toContain('filter:');
    expect(rule, 'the mark is tinted').not.toContain('background-color:');
    expect(rule).not.toMatch(/opacity:\s*0?\.[0-8]/);
  });

  it('carries an accessible name that says Nimiq', () => {
    expect(mark).toContain('alt');
    expect(mark).toContain('Nimiq');
  });

  /*
   * The arrangement changed on 2026-09-12, deliberately.
   *
   * The Nimiq signet used to lead the HUD and the title screen, which read as
   * though NIM Atlas were an official Nimiq product. It is a game that teaches
   * Nimiq. So the product's own crest leads and Nimiq is credited by name.
   *
   * That is an attribution claim, so it is tested from both sides: Nimiq must
   * still be present and named, and it must never again be the lead mark.
   */
  it("leads every surface with the product's own crest, not Nimiq's", () => {
    expect(app, 'the HUD brand does not lead with the crest').toMatch(/private createCityBrand[\s\S]{0,900}?createAtlasCrest/);
    expect(app, 'the loading splash does not lead with the crest').toMatch(/private renderLandingSplash[\s\S]{0,1200}?createAtlasCrest/);
    expect(app, 'the title screen does not lead with the crest').toMatch(/private renderWelcome[\s\S]{0,2000}?createAtlasCrest/);
  });

  it('never puts the Nimiq mark back in front of the crest', () => {
    // The HUD brand button is the one that appears on every play screen. A
    // signet there is what created the impression in the first place.
    const brand = app.slice(app.indexOf('private createCityBrand'));
    const body = brand.slice(0, brand.indexOf('  private ', 40));
    expect(body, 'the HUD brand leads with Nimiq again').not.toContain('createNimiqMark');
  });

  it('still credits Nimiq by name where the crest leads', () => {
    /*
     * Sliced to the next method, like the title screen below. The credit sits
     * at the foot of the splash now rather than beside the crest at its head:
     * the splash is the first screen anybody ever sees, and a centred "POWERED
     * BY NIMIQ" above the heading made it read as a Nimiq loading page.
     */
    const splashFrom = app.indexOf('private renderLandingSplash');
    const splashBody = app.slice(splashFrom, app.indexOf('  private ', splashFrom + 40));
    expect(splashBody, 'the loading splash drops the Nimiq credit').toContain('createNimiqPoweredBy');
    /*
     * Sliced to the next method rather than a fixed character window. The
     * credit now sits at the foot of the panel instead of beside the crest at
     * the head, because a centred "POWERED BY NIMIQ" above the headline read
     * as the product's own title. It is still in renderWelcome, which is what
     * this test is for; the old 2200-character window only ever asserted that
     * it appeared *early*.
     */
    const welcomeFrom = app.indexOf('private renderWelcome');
    const welcomeBody = app.slice(welcomeFrom, app.indexOf('  private ', welcomeFrom + 40));
    expect(welcomeBody, 'the title screen drops the Nimiq credit').toContain('createNimiqPoweredBy');
    const helper = readFileSync(new URL('../src/atlas/ui/atlas-mark.ts', import.meta.url), 'utf8');
    expect(helper, 'the credit does not use the official mark').toContain("createNimiqMark('lockup'");
    expect(helper, 'the credit is not labelled').toContain('Powered by');
  });

  it('keeps Nimiq on both payment surfaces, where it matters most', () => {
    /*
     * There are two payment surfaces. createCityPaymentReview is the panel
     * over the 3D city; renderLantern is the full screen. Both list NETWORK
     * through networkValueCell, which carries the signet, because a player
     * approving a real transfer should see whose network it is.
     */
    // Sliced to the next method rather than a fixed character count: these
    // bodies are thousands of characters and a window that happened to fit
    // once would fail the next time either grew.
    for (const surface of ['private createCityPaymentReview', 'private renderLantern']) {
      const from = app.indexOf(surface);
      const body = app.slice(from, app.indexOf('  private ', from + 40));
      expect(body, `${surface} lost the network row`).toContain('networkValueCell');
    }
    expect(app, 'the network row lost the signet').toMatch(/private networkValueCell[\s\S]{0,400}?createNimiqMark\('signet'/);
  });
});
