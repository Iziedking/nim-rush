import { defineConfig } from 'vitest/config';

/*
 * Test settings, kept out of vite.config.ts so the build config stays about
 * the build.
 *
 * The timeout is the only thing here worth explaining. Vitest defaults to five
 * seconds, which is generous for a pure function and not generous at all for
 * the handful of tests in this suite that do real work: a run simulated tick
 * by tick to the finish, or a seat claimed through a real file lock with a
 * snapshot copy, an fsync and a rename behind it. Those passed alone and then
 * failed roughly one run in four when the machine was also serving a dev
 * build - which is the worst possible behaviour for the gate that decides
 * whether a release ships, because it teaches you to re-run instead of read.
 *
 * Fifteen seconds weakens no assertion. A test that genuinely hangs still
 * fails; it just stops failing for the sole reason that the laptop was busy.
 */
export default defineConfig({
  test: {
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
