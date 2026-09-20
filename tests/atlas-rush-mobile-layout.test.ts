import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/atlas/blitz/blitz.css', import.meta.url), 'utf8');

describe('NIM RUSH mobile composition', () => {
  it('keeps portrait controls thumb-sized without consuming the lower third', () => {
    expect(css).toContain('@media (orientation: portrait) and (max-width: 720px)');
    expect(css).toContain('--rush-pad: clamp(108px, 32vw, 128px)');
    expect(css).toContain('--rush-spend: clamp(54px, 15vw, 60px)');
  });

  it('grounds the portrait control deck over the world instead of exposing a dead band', () => {
    expect(css).toMatch(/\.blitz-run::before[\s\S]{0,500}linear-gradient/);
    expect(css).toMatch(/\.blitz-run::before[\s\S]{0,500}pointer-events:\s*none/);
  });

  it('keeps the brand and utility controls on compact portrait phones', () => {
    expect(css).toMatch(/@media \(orientation: portrait\) and \(max-height: 620px\)[\s\S]{0,1400}\.blitz-intro-masthead\s*\{[\s\S]{0,180}display:\s*flex/);
    expect(css).toMatch(/@media \(orientation: portrait\) and \(max-height: 620px\)[\s\S]{0,1800}\.blitz-intro-utility\s*\{[\s\S]{0,180}display:\s*flex/);
  });

  it('limits the mission card to peripheral vision on portrait phones', () => {
    expect(css).toMatch(/@media \(orientation: portrait\) and \(max-width: 720px\)[\s\S]{0,1200}\.blitz-mission-hud\s*\{[\s\S]{0,240}width:\s*min\(178px, 52vw\)/);
  });

  it('keeps the mission card clear of the controls on short landscape phones', () => {
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 370px\)[\s\S]{0,1000}\.blitz-mission-hud\s*\{[\s\S]{0,220}top:\s*max\(74px,/);
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 370px\)[\s\S]{0,1000}\.blitz-mission-hud\s*\{[\s\S]{0,260}width:\s*min\(188px, 36vw\)/);
  });

  it('contains the short-height portrait command panel after legacy overrides', () => {
    expect(css).toMatch(/@media \(orientation: portrait\) and \(max-width: 720px\)[\s\S]{0,1800}\.blitz-intro\.blitz-fullscreen-page\s*\{[\s\S]{0,320}grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.blitz-intro-command\s*\{[\s\S]{0,320}min-width:\s*0;[\s\S]{0,320}box-sizing:\s*border-box/);
    expect(css).toMatch(/\.blitz-pool-place\s*\{[\s\S]{0,320}grid-template-columns:\s*2\.4rem minmax\(0, 1fr\) auto/);
  });

  it('gives the portrait masthead a real vertical rhythm on iOS-sized screens', () => {
    expect(css).toMatch(/@media \(orientation: portrait\) and \(max-width: 720px\)[\s\S]{0,2200}\.blitz-intro-masthead\s*\{[\s\S]{0,260}display:\s*flex;[\s\S]{0,260}gap:\s*14px/);
    expect(css).toMatch(/\.blitz-intro-masthead \.blitz-edition\s*\{[\s\S]{0,180}margin-top:\s*0/);
    expect(css).toMatch(/\.blitz-intro-masthead \.blitz-title\s*\{[\s\S]{0,180}line-height:\s*\.84/);
  });
});
