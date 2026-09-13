import { AtlasApp } from './app/atlas-app';
import { BlitzApp } from './blitz/blitz-app';
import { trackViewport } from '../core/viewport';
import './blitz/blitz.css';
import './ui/route-rescue.css';

const ui = document.querySelector<HTMLElement>('#ui');
const canvas = document.querySelector<HTMLCanvasElement>('#stage');

if (ui && canvas) {
  trackViewport();
  const searchParams = new URLSearchParams(window.location.search);
  const app = searchParams.get('atlas') === 'legacy'
    ? new AtlasApp(ui, canvas)
    : new BlitzApp(ui, canvas);
  const booted = app.boot();
  if (import.meta.env.DEV && app instanceof BlitzApp) {
    (window as unknown as { blitzDebug?: BlitzApp }).blitzDebug = app;
    const previewCity = searchParams.get('blitz-city');
    if (previewCity === 'lagos' || previewCity === 'london' || previewCity === 'dubai') {
      void Promise.resolve(booted).then(() => app.debugStartCity(previewCity));
    }
  }
  /*
   * Screenshot capture hook, off unless asked for.
   *
   * scripts/shoot-atlas.mjs needs the lantern screen, which is several
   * gameplay steps into the city. Gating on a query parameter keeps this out of
   * the way of every real session while giving the tool a supported entry
   * instead of a simulated walk.
   */
  if (searchParams.has('capture') && app instanceof AtlasApp) {
    (window as unknown as { atlasCapture?: AtlasApp }).atlasCapture = app;
  }
}
