import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const manifest = readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8');

describe('NIM Atlas mobile and offline boundary', () => {
  it('registers the Atlas shell and keeps write-capable routes out of the cache', () => {
    expect(main).toContain("from './app/atlas-app'");
    expect(app).toContain("navigator.serviceWorker.register('/service-worker.js'");
    expect(serviceWorker).toContain('nim-rush-shell-');
    expect(serviceWorker).not.toContain('sface-relay-shell-');
    expect(serviceWorker).toContain('/atlas/api');
    expect(serviceWorker).toContain("event.request.method !== 'GET'");
    expect(serviceWorker).toContain("'/atlas/manifests/'");
    expect(serviceWorker).toContain("'/atlas/characters/'");
    expect(serviceWorker).toContain("'/atlas/pay-harbor/'");
    expect(serviceWorker).toContain("'/atlas/audio/'");
    expect(serviceWorker).toContain("'/atlas/api/'");
    expect(serviceWorker).toContain("'/admin/'");
    expect(serviceWorker).toContain("'/live'");
    expect(serviceWorker).not.toContain("url.pathname.startsWith('/assets/')");
  });

  it('keeps the public app installable and accessible at portrait sizes', () => {
    expect(JSON.parse(manifest)).toMatchObject({ name: 'NIM RUSH', display: 'standalone' });
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (max-width: 320px)');
    expect(css).toContain('@media (min-width: 390px)');
    expect(css).toContain('@media (min-width: 430px)');
  });
});
