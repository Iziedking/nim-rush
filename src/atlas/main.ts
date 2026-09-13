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
  app.boot();
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
