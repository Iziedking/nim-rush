import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/atlas/blitz/blitz-app.ts', import.meta.url), 'utf8');
const input = readFileSync(new URL('../src/atlas/blitz/blitz-input.ts', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/atlas/render/three/blitz-renderer.ts', import.meta.url), 'utf8');
const bike = readFileSync(new URL('../src/atlas/render/three/rush-bike.ts', import.meta.url), 'utf8');
const course = readFileSync(new URL('../src/atlas/render/three/rush-course.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/atlas/blitz/blitz.css', import.meta.url), 'utf8');

describe('Beacon Blitz public arcade experience', () => {
  it('makes Blitz the default and keeps the earlier Atlas behind an explicit legacy route', () => {
    expect(main).toContain("searchParams.get('atlas') === 'legacy'");
    expect(main).toContain('new BlitzApp(ui, canvas)');
    expect(main).toContain('new AtlasApp(ui, canvas)');
  });

  it('launches Lagos from one dominant action and keeps the run HUD lean', () => {
    expect(app).toContain('Ride now');
    expect(app).toContain('Find your line. Ride the ridge. Prove your run.');
    expect(app).toContain("'NIM RUSH'");
    /*
     * check / approve / confirm used to be taught in a brief block on this
     * screen, which is the opposite of "one dominant action": it put a label,
     * a sentence and three cards between a new player and the only button that
     * matters. The opening teaches it now, one idea per screen, so the
     * assertion follows it there.
     */
    const onboarding = readFileSync(new URL('../src/atlas/blitz/blitz-onboarding.ts', import.meta.url), 'utf8');
    expect(onboarding).toContain('THE JOB');
    expect(onboarding).toContain('THE RIDE');
    expect(onboarding).toContain('THE CHECKS');
    expect(app).toContain('renderOnboarding');
    expect(app).toContain('blitzOnboardingSeen');
    // The landing says what it costs to try, before anything is asked for.
    expect(app).toContain('No wallet needed to play');
    expect(app).toContain('Verify identity / ride ranked');
    expect(app).toContain('prepareRankedStart');
    expect(app).toContain('issueRankedTicket');
    expect(app).toContain('wallet signs identity, not a payment');
    expect(app).toContain("this.setAudioScene(this.paused ? 'paused' : 'riding')");
    expect(app).not.toContain('this.audio.playTheme()');
    expect(app).toContain('setBikeSpeed');
    expect(app).toContain("playWorldCue('bike-boost')");
    expect(app).toContain("playWorldCue('route-complete')");
    expect(app).toContain("data-blitz-screen', 'intro'");
    expect(app).toContain("data-blitz-screen', 'run'");
    expect(app).toContain('blitz-timer');
    expect(app).toContain('blitz-score');
    expect(app).toContain('RANKED RUNS STAY LIVE / KEEP RIDING');
    expect(app).toContain('NOT VERIFIED / THIS RANKED RUN LEFT THE SCREEN.');
    expect(app).toContain('blitz-boost-meter');
    expect(app).not.toContain('Passport');
    expect(app).not.toContain('Knowledge Book');
  });

  it('offers touch and keyboard steering, drift, boost and persistent mission contracts', () => {
    expect(input).toContain("'ArrowLeft'");
    expect(input).toContain("'ArrowRight'");
    expect(input).toContain("'ArrowDown'");
    expect(input).toContain("'KeyS'");
    expect(input).toContain("'ShiftLeft'");
    expect(input).toContain("'Space'");
    expect(app).toContain('blitz-steer-zone');
    expect(app).toContain('blitz-drift');
    expect(app).toContain('blitz-brake');
    expect(app).toContain('blitz-boost');
    expect(app).toContain('blitz-mission-hud');
    expect(app).toContain('Physical mission contracts');
    expect(app).toContain('blitz-pause-overlay');
    expect(app).toContain('Restart run');
  });

  it('renders an actual bike, human rider, city landmarks and readable relay gates', () => {
    expect(renderer).toContain('new RushBike()');
    expect(course).toContain('createRushCourse');
    expect(renderer).toContain('createCityLandmarks');
    expect(renderer).toContain('createRelayGate');
    expect(bike).toContain('nim-rush-mountain-bike');
    expect(bike).toContain('courseGroundLift');
    expect(bike).toContain('this.compressionSpeed');
    expect(bike).toContain('this.limbs.instanceMatrix.needsUpdate');
    expect(bike).toContain('this.particles');
    expect(renderer).toContain('speedLookahead');
    expect(renderer).toContain('buildBlitzRoadRibbon');
    expect(renderer).toContain('createRouteDistricts');
    expect(renderer).toContain('createCityCrowd');
    expect(renderer).toContain('updateCityCrowd');
    expect(renderer).toContain('InstancedMesh');
    expect(renderer).toContain('addStreetFrontage');
    expect(renderer).toContain('createStreetLife');
    expect(renderer).toContain('createRoadHazard');
    expect(renderer).toContain('createLagosMarketStall');
    expect(renderer).toContain('createLondonKiosk');
    expect(renderer).toContain('createFeaturedCitizens');
    expect(renderer).toContain('FeaturedCitizen');
    expect(renderer).toContain('MeshPhysicalMaterial');
    expect(renderer).toContain('ACESFilmicToneMapping');
    expect(renderer).toContain('PCFShadowMap');
    expect(renderer).toContain('createRoadsideDetails');
    expect(renderer).toContain('featured-citizen-${index + 1}');
    expect(renderer).toContain('createDubaiPalm');
    expect(renderer).toContain("city.id === 'london' ? 0.3");
  });

  it('keeps same-course rematch ahead of wallet setup and optional circuits', () => {
    expect(app.indexOf("button('Ride again'")).toBeGreaterThan(-1);
    expect(app.indexOf("button('Ride again'")).toBeLessThan(app.indexOf("screen.append(competition)"));
    expect(app).toContain('best:${state.rulesetVersion}:${state.cityId}');
    expect(css).toContain('.blitz-pool[hidden] { display: none; }');
    expect(app).toContain('BlitzFrameGovernor');
    expect(app).toContain('if (!this.state) this.renderer.renderPreview(this.cityId)');
  });

  it('keeps every mobile action at least 52px and honours reduced motion', () => {
    expect(css).toMatch(/\.blitz-control[^}]+min-height:\s*56px/s);
    expect(css).toMatch(/\.blitz-pause[^}]+pointer-events:\s*auto/s);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(app).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
  });
});

/*
 * The opening.
 *
 * Beacon Blitz used to start on a wall of panels over a live city at full
 * brightness, and a player who had never seen it could not tell what the game
 * was, let alone what to press.
 */
describe('the Beacon Blitz opening', () => {
  const onboarding = readFileSync(new URL('../src/atlas/blitz/blitz-onboarding.ts', import.meta.url), 'utf8');

  it('is three beats, in the order a person needs them', () => {
    const order = ['THE JOB', 'THE RIDE', 'THE CHECKS'].map((kicker) => onboarding.indexOf(kicker));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order]).toEqual([...order].sort((a, b) => a - b));
  });

  it('draws its own pictures rather than shipping generated art', () => {
    // Authored geometry, in the game's own flat-shape language. Every beat is
    // an inline SVG in this module; nothing loads an image.
    expect(onboarding).not.toMatch(/<img|\.png|\.jpg|\.jpeg|\.webp/);
    expect((onboarding.match(/<svg /g) ?? []).length).toBe(3);
  });

  it('can always be left, and is only shown once', () => {
    expect(app).toContain("button('Skip'");
    expect(app).toContain('markBlitzOnboardingSeen');
    expect(onboarding).toContain('nim-atlas:blitz:onboarded:v1');
  });

  /*
   * A storage read that throws must cost a returning player three taps at
   * most, never trap them in an introduction they have already read.
   */
  it('treats unreadable storage as already seen', () => {
    expect(onboarding).toMatch(/blitzOnboardingSeen[\s\S]{0,320}catch[\s\S]{0,60}return true/);
  });

  it('ends by riding, not by returning to the menu', () => {
    expect(app).toMatch(/finishOnboarding\(true\)/);
    expect(app).toMatch(/finishOnboarding\(ride = false\)[\s\S]{0,220}startRun\('lagos'\)/);
  });

  it('every beat carries a described picture for a screen reader', () => {
    expect((onboarding.match(/role="img"/g) ?? []).length).toBe(3);
    expect((onboarding.match(/aria-label="[^"]{12,}"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

/*
 * The day's pool, on the screen where a rider has just earned a place in it.
 *
 * This panel used to read the daily standing and say "split between N
 * qualified riders, X each", which described an equal split. The day pays its
 * top three, so that sentence became a false statement to a rider the moment
 * the allocator landed.
 */
describe('what the result screen says about the pool', () => {
  it('reads the prize table rather than the equal-split standing', () => {
    expect(app).toContain('getBlitzPrizes');
    expect(app).not.toContain('getDailyStanding');
  });

  it('no longer claims the pool is split between every qualified rider', () => {
    expect(app).not.toMatch(/Split between \$\{?standing/);
    expect(app).not.toContain('each at the close of the day');
  });

  it('names the top-three split from the server, never a hardcoded one', () => {
    // The split is an open product decision. The client renders whatever the
    // server allocated with, so changing it stays a one-line server edit.
    expect(app).toContain('table.splitBps.map(bpsLabel)');
    expect(app).not.toMatch(/50\s*\/\s*30\s*\/\s*20/);
  });

  /*
   * The distinction that matters most: a pool the server could not read is an
   * unknown, and showing an unknown as "no pool today" is a claim about the
   * treasury that nothing supports.
   */
  it('shows nothing at all when the pool state is unknown', () => {
    expect(app).toMatch(/state === 'unavailable'\)\s*return/);
  });

  it('still says the board counts when no pool is funded', () => {
    expect(app).toContain('No sponsored pool today');
    expect(app).toContain('The board still counts');
  });

  it('says first place is open rather than inventing a leader', () => {
    expect(app).toContain('No rider has posted a verified run yet today');
  });

  it('never calls an allocation paid before it is reconciled', () => {
    expect(app).toContain('Nothing is paid until the day closes and the transfer is reconciled on chain');
  });
});
