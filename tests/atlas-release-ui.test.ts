import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/atlas/render/renderer.ts', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

describe('NIM Atlas release-quality UI contract', () => {
  it('boots through the extracted Atlas app module', () => {
    expect(main).toContain("from './app/atlas-app'");
  });

  it('keeps the first decision and primary adventure above secondary systems', () => {
    const welcome = app.slice(app.indexOf('private renderWelcome'), app.indexOf('private renderLandingSplash'));
    expect(welcome).toContain('atlas-home-grid');
    expect(welcome).toContain('atlas-quick-grid');
    // This previously compared two labels that no longer existed, so both sides
    // were -1 and the ordering was never actually checked. Both indexes are now
    // asserted to be real before they are compared.
    // The shared primary button now serves first-time and returning players.
    // Check its placement independently of the selected label.
    expect(welcome).toContain("'Start 60-second run'");
    expect(welcome).toContain("'Resume harbor job'");
    expect(welcome).toContain("'Harbor contracts'");
    const primaryAction = welcome.indexOf('actionButton(startLabel, startAction, startDescription)');
    const secondaryAction = welcome.indexOf("ghostButton('Open Living Knowledge Book'");
    expect(primaryAction, 'primary adventure action missing').toBeGreaterThan(-1);
    expect(secondaryAction, 'secondary knowledge action missing').toBeGreaterThan(-1);
    expect(primaryAction).toBeLessThan(secondaryAction);
    expect(welcome).not.toContain('this.renderLeaderboards()');
    expect(welcome).not.toContain('this.renderShopCatalog()');
    expect(css).toContain('.atlas-home-grid');
    expect(css).toContain('.atlas-quick-grid');
  });

  it('uses semantic role selection and gives every non-game screen a route home', () => {
    expect(app).toContain("setAttribute('aria-pressed'");
    expect(app).toContain('atlas-screen-nav');
    expect(app).toContain("actionButton('Atlas home'");
    expect(css).toContain('.atlas-screen-nav');
  });

  it('serves the actual daily rotation and does not hardcode day-one answers', () => {
    expect(app).toContain('selectDailyChallenge(new Date())');
    expect(app).toContain('dailyChallengeChoices(challenge)');
    expect(app).not.toContain('ATLAS_DAILY_CHALLENGES[0]');
    expect(app).not.toContain("['120000', '1200000', '12000000']");
  });

  it('makes district teach-back a real choice and routes Builders through their repair', () => {
    expect(app).toContain('evergreenTeachBackChoices(adventure');
    expect(app).toContain('Open provider workshop');
    expect(app).toContain('finishBuilderRepairIntoHarbor');
    expect(app).toContain('knowledgeTeachBackPrompt(stepId)');
    expect(app).not.toContain('Which principle comes next: ${stepId.toUpperCase()}?');
  });

  it('renders the harbor consequence visually instead of claiming a text-only transformation', () => {
    expect(renderer).toContain('drawHarbor');
    expect(renderer).toContain("phase === 'tower-lit'");
    expect(app).toContain('this.renderer.drawHarbor');
  });

  it('introduces the active racer and labels the retained Atlas adventure', () => {
    expect(readme).toContain('NIM RUSH');
    // The legacy Atlas adventure is still reachable in the shipped app, so the
    // README has to say how. A route nobody can find is a route nobody has.
    expect(readme).toContain('?atlas=legacy');
  });
});
