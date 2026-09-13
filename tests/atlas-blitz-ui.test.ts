import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/atlas/blitz/blitz-app.ts', import.meta.url), 'utf8');
const input = readFileSync(new URL('../src/atlas/blitz/blitz-input.ts', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/atlas/render/three/blitz-renderer.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/atlas/blitz/blitz.css', import.meta.url), 'utf8');

describe('Beacon Blitz public arcade experience', () => {
  it('makes Blitz the default and keeps the earlier Atlas behind an explicit legacy route', () => {
    expect(main).toContain("searchParams.get('atlas') === 'legacy'");
    expect(main).toContain('new BlitzApp(ui, canvas)');
    expect(main).toContain('new AtlasApp(ui, canvas)');
  });

  it('launches Lagos from one dominant action and keeps the run HUD lean', () => {
    expect(app).toContain('Ride Lagos');
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

  it('offers touch and keyboard steering, drift, boost and two relay choices', () => {
    expect(input).toContain("'ArrowLeft'");
    expect(input).toContain("'ArrowRight'");
    expect(input).toContain("'ShiftLeft'");
    expect(input).toContain("'Space'");
    expect(app).toContain('blitz-steer-zone');
    expect(app).toContain('blitz-drift');
    expect(app).toContain('blitz-boost');
    expect(app).toContain('chooseRelay(\'left\')');
    expect(app).toContain('chooseRelay(\'right\')');
  });

  it('renders an actual bike, human rider, city landmarks and readable relay gates', () => {
    expect(renderer).toContain('createBikeAndRider');
    expect(renderer).toContain('createHumanRider');
    expect(renderer).toContain('createCityLandmarks');
    expect(renderer).toContain('createRelayGate');
    expect(renderer).toContain('atlas-blitz-bike');
    expect(renderer).toContain('atlas-blitz-rider-face');
    expect(renderer).toContain('motionStreaks');
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
    expect(renderer).toContain('createDubaiPalm');
    expect(renderer).toContain("city.id === 'london' ? 0.3");
  });

  it('keeps the next city ahead of optional wallet setup on the result screen', () => {
    expect(app.indexOf("screen.append(reveal)")).toBeGreaterThan(-1);
    expect(app.indexOf("screen.append(reveal)")).toBeLessThan(app.indexOf("screen.append(competition)"));
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
