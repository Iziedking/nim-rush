import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('admin token browser handling', () => {
  it('keeps the token out of persistent browser storage and cookies', () => {
    const source = readFileSync(new URL('../src/admin.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('document.cookie');
    expect(source).not.toContain('indexedDB');
    expect(source).toContain("cache: 'no-store'");
  });

  it('uses the production API host and exposes login failures', () => {
    const source = readFileSync(new URL('../src/admin.ts', import.meta.url), 'utf8');
    expect(source).toContain("'https://api.nim-rush.xyz'");
    expect(source).toContain('Could not reach the admin API.');
    expect(source).toContain('Admin API is unavailable.');
  });
});
