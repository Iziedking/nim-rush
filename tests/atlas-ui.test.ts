import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('NIM Atlas public first district UI', () => {
  it('makes Atlas the public entry without deleting internal Relay source', () => {
    expect(index).toContain('/src/atlas/main.ts');
    expect(index).toContain('/src/atlas/atlas.css');
    expect(index).not.toContain('/src/relay/main.ts');
    expect(index).toContain('Explore the network. Build what survives.');
  });

  it('ships semantic controls and required portrait accessibility policies', () => {
    const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const toolkit = readFileSync(new URL('../src/atlas/ui/atlas-toolkit.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
    expect(app).toContain("document.createElement('button')");
    expect(app).toContain("setAttribute('aria-label'");
    expect(toolkit).toContain("setAttribute('aria-live'");
    expect(main).not.toMatch(/shooter|fire weapon|kill/i);
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (max-width: 320px)');
    expect(css).toContain('@media (min-width: 390px)');
    expect(css).toContain('@media (min-width: 430px)');
    expect(css).toContain('scrollbar-width: thin');
    // Was --atlas-orange. Tokens are named for their role now, because a token
    // named for its colour cannot tell you where it belongs.
    // The track was --atlas-paper, which is now translucent glass rather than
    // opaque paper; painting a second translucent navy over the panel read as
    // a smear. The thumb still carries the signal colour, which is the half of
    // this that was ever load-bearing.
    expect(css).toContain('scrollbar-color: var(--atlas-signal) transparent');
    expect(css).toContain('.atlas-panel::-webkit-scrollbar');
    expect(css).toContain('width: 7px');
  });

  it('makes the SFACE and NIM Atlas relationship explicit and keeps Pay central', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const manifest = readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8');
    /*
     * The relationship is stated on the About screen, not on the hero.
     *
     * "Sface is a Nimiq Pay Mini App game" was the third paragraph of the
     * landing screen, above the button. It is true and it is plumbing: it
     * describes the delivery mechanism to a player who has not yet been given
     * a reason to care about the game, and it cost height on the one screen
     * where height decides whether anybody finds the start button. What has to
     * stay true is that the relationship is stated somewhere a player can
     * reach, which is what this now asserts.
     */
    const about = readFileSync(new URL('../src/ui/about.ts', import.meta.url), 'utf8');
    expect(about, 'the Sface / Nimiq Pay relationship is stated nowhere').toContain('Nimiq Pay Mini App game');
    expect(about).toContain('Sface');
    /*
     * Asserted as a relationship, not as one sentence.
     *
     * The product was renamed from "Sface: NIM Atlas" to "NIM Atlas" on
     * 2026-09-12, with Sface credited as the maker in the description, so that
     * the name matches the crest. Pinning the old wording made a deliberate
     * rename look like a regression. What has to stay true is that the
     * manifest names the game, names its maker, and says it is a Nimiq Pay
     * Mini App.
     */
    const parsed = JSON.parse(manifest) as { name: string; description: string };
    expect(parsed.name).toBe('NIM Atlas');
    expect(parsed.description, 'the maker is not credited').toContain('Sface');
    expect(parsed.description, 'Nimiq Pay is not named').toContain('Nimiq Pay');
    expect(app).toContain('PRACTICE MODE / PLAYABLE WITHOUT A WALLET');
    expect(app).toContain('NIMIQ PAY IS THE LIVE PAYMENT GATE');
  });

  it('keeps the mission loop visible so a first-time player knows what they are doing', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const prologue = readFileSync(new URL('../shared/atlas/prologue.ts', import.meta.url), 'utf8');
    expect(app).toContain('Meet Mara');
    expect(prologue).toContain("id: 'explorer'");
    expect(prologue).toContain("id: 'builder'");
    expect(app).toContain('Pay Harbor');
    expect(app).toContain('PRACTICE MODE / PLAYABLE WITHOUT A WALLET');
    expect(app).toContain('NIMIQ PAY IS THE LIVE PAYMENT GATE');
    expect(app).toContain('Review payment request');
    expect(app).toContain('Simulate verified confirmation');
    expect(app).toContain('YOU ARE HERE');
    expect(app).toContain('Builder Trial 1 of 6');
  });

  it('opens the first mission as a rescue action instead of a textbook question', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const routeUi = readFileSync(new URL('../src/atlas/ui/route-rescue.ts', import.meta.url), 'utf8');
    expect(app).toContain('HELP THE PARCEL FIND ITS HOME');
    expect(app).toContain('routeObjective');
    expect(routeUi).toContain('The Wrong House');
    expect(routeUi).toContain('SCAN DESTINATION / Beacon Lantern Shop');
    expect(routeUi).toContain('ASSEMBLE AND SEND PARCEL');
    expect(routeUi).toContain('PLACE THE FIRST BEACON THREAD');
  });

  it('turns Light Forest into a fresh-signal action loop', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const routeUi = readFileSync(new URL('../src/atlas/ui/route-rescue.ts', import.meta.url), 'utf8');
    expect(app).toContain('FRESH VIEW / LIGHT FOREST');
    expect(routeUi).toContain('READ PROVIDER STATUS');
    expect(routeUi).toContain('FOLLOW THE FRESH TRAIL');
    expect(routeUi).toContain('CHASE THE STALE TRAIL');
  });

  it('turns Pay Harbor into a duplicate-request investigation', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const routeUi = readFileSync(new URL('../src/atlas/ui/route-rescue.ts', import.meta.url), 'utf8');
    expect(app).toContain('DUPLICATE REQUEST / PAY HARBOR');
    expect(routeUi).toContain('COMPARE THE TWO LANTERN REQUESTS');
    expect(routeUi).toContain('REJECT THE DUPLICATE');
    expect(routeUi).toContain('ACCEPT THE EXACT REQUEST');
  });

  it('turns Albatross Causeway into a receipt-clock mission', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const routeUi = readFileSync(new URL('../src/atlas/ui/route-rescue.ts', import.meta.url), 'utf8');
    expect(app).toContain('RECEIPT CLOCK / ALBATROSS CAUSEWAY');
    expect(routeUi).toContain('ADVANCE THE RECEIPT CLOCK');
    expect(routeUi).toContain('TRUST THE EARLY RECEIPT');
    expect(routeUi).toContain('RELEASE THE MEDICINE');
  });

  it('turns Validator Peaks into a consensus mission', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const routeUi = readFileSync(new URL('../src/atlas/ui/route-rescue.ts', import.meta.url), 'utf8');
    expect(app).toContain('CONSENSUS SIGNAL / VALIDATOR PEAKS');
    expect(routeUi).toContain('CHECK THE NEXT VALIDATOR');
    expect(routeUi).toContain('TRUST ONE VALIDATOR');
    expect(routeUi).toContain('REOPEN THE SHARED ROUTE');
  });

  it('turns Builder City into a server-verification mission', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const routeUi = readFileSync(new URL('../src/atlas/ui/route-rescue.ts', import.meta.url), 'utf8');
    expect(app).toContain('SERVER VERIFICATION / BUILDER CITY');
    expect(routeUi).toContain('INSPECT THE BROWSER CLAIM');
    expect(routeUi).toContain('TRUST THE GREEN BADGE');
    expect(routeUi).toContain('UNLOCK THE KIOSK');
  });

  it('turns Beacon Core into a six-seal finale', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const routeUi = readFileSync(new URL('../src/atlas/ui/route-rescue.ts', import.meta.url), 'utf8');
    expect(app).toContain('SIX SEALS / BEACON CORE');
    expect(routeUi).toContain('CONNECT THE NEXT BEACON SEAL');
    expect(routeUi).toContain('RUSH THE BEACON');
    expect(routeUi).toContain('RESTORE THE BEACON CORE');
  });

  it('uses the living 3D city as the landing backdrop and keeps onboarding to one clear run', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const landingStart = app.indexOf('private renderWelcome');
    const landingEnd = app.indexOf('private renderLandingSplash');
    const landing = app.slice(landingStart, landingEnd);
    expect(app).toContain("private cityLoadState: 'loading' | 'ready' | 'unavailable' = 'loading';");
    expect(app).toContain('Start 60-second run');
    /*
     * The landing states what the player will do, in the world's own terms.
     *
     * This used to pin "Learn how Nimiq works by walking through a living
     * city", which opened the game by announcing homework and put the sponsor
     * in the first line a player reads. The promise is the same; it is now
     * made as a hook rather than as a syllabus.
     */
    expect(app).toContain('The Beacon didn’t break.');
    expect(app).toContain('from a person who needs help to a promise that actually arrives');
    expect(app).toContain('Entering Beacon Commons.');
    expect(app).toContain('CITY');
    expect(app).toContain('PLAYER');
    expect(app).toContain('PEOPLE');
    expect(landing).not.toContain('drawHarbor');
    expect(landing).toContain('More ways to learn in the city');
  });

  it('ships a mirrored Builder repair board with predictions and an explicit local-only wallet boundary', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    expect(app).toContain('BUILDER REPAIR / PAYMENT PATH');
    expect(app).toContain('Predict each observation before running the repair');
    expect(app).toContain('Provider ready');
    expect(app).toContain('SIMULATED LOOKUP / NO PAYMENT');
    expect(app).toContain('No arbitrary code runs here');
  });

  it('ships a Living Knowledge Book and a closed-book teach-back boundary', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const knowledge = readFileSync(new URL('../shared/atlas/knowledge.ts', import.meta.url), 'utf8');
    expect(app).toContain('LIVING KNOWLEDGE BOOK');
    expect(app).toContain('ASK / CHECK / APPROVE / CONFIRM / UNLOCK');
    expect(app).toContain('BOOK CLOSED / TEACH-BACK');
    expect(app).toContain('FREE CORE / NO PRIZE ADVANTAGE');
    expect(knowledge).toContain("availability: 'free-core'");
  });

  it('exposes a daily applied puzzle without fabricating reward or leaderboard outcomes', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    expect(app).toContain('DAILY ATLAS PUZZLE');
    expect(app).toContain('LEARN / SOLVE / VERIFY');
    /*
     * This used to assert the literal 'Reward share appears only after server
     * verification'. The screen said exactly that and then never called the
     * server, so the assertion pinned a promise the product could not keep.
     * What matters is that the verification is real, so that is what is checked.
     */
    expect(app).toContain('submitDailyToServer');
    expect(app).toContain('this.api.submitDaily(');
    expect(app).toContain('this.api.getDailyStanding()');
    // A share is never quoted from a pot the treasury cannot settle.
    expect(app).toContain('rewardsEnabled');
    expect(app).toContain('No pool is funded today, so no share is owed');
    expect(app).toContain('EXPLORER LEADERBOARD');
    expect(app).toContain('BUILDER LEADERBOARD');
    expect(app).toContain('BOARD UNAVAILABLE');
  });

  it('exposes the evergreen district atlas with Explorer and Builder mirrors', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    const evergreen = readFileSync(new URL('../shared/atlas/adventures/evergreen.ts', import.meta.url), 'utf8');
    expect(app).toContain('DISTRICT ATLAS');
    expect(app).toContain('Walk the District Atlas');
    expect(evergreen).toContain('The Canopy That Waits');
    expect(app).toContain('TRANSFER / TEACH-BACK');
  });

  it('shows the Network Beacon with an honest unavailable state before server data exists', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    expect(app).toContain('NETWORK BEACON');
    expect(app).toContain('No progress is being invented locally');
    expect(app).toContain('SERVER PROJECTION');
  });

  it('shows the optional shop as locked until an owner enables a verified mainnet catalog', () => {
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    expect(app).toContain('MAINNET EXPANSIONS');
    expect(app).toContain('OWNER APPROVAL REQUIRED');
    expect(app).toContain('Purchases stay disabled');
  });

  it('ships crawler and agent discovery files for the current product', () => {
    const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
    const llms = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(llms).toContain('# NIM Atlas');
    expect(llms).toContain('Nimiq Pay Mini App game');
  });
});
