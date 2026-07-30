import { describe, expect, it } from 'vitest';
import type { Clock } from '../../src/core/clock.js';
import { openDatabase, runMigrations } from '../../src/db/client.js';
import { createFlagService } from '../../src/flags/flag-service.js';
import { loadConfig } from '../../src/config.js';

function movableClock(startIso: string): Clock & { advance(ms: number): void } {
  let current = new Date(startIso).getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}

function createService(cacheTtlMs: number) {
  const config = loadConfig({ FACTORY_ENV: 'test', DATABASE_FILE: ':memory:' });
  const handle = openDatabase(':memory:');
  runMigrations(handle.db, config.migrationsDir);
  const clock = movableClock('2026-01-15T10:00:00.000Z');
  return { flags: createFlagService(handle.db, clock, cacheTtlMs), clock, handle };
}

describe('flag-service', () => {
  it('geeft false voor een onbekende flag', () => {
    const { flags, handle } = createService(0);
    expect(flags.isEnabled('bestaat-niet')).toBe(false);
    handle.close();
  });

  it('slaat een flag op en leest hem terug', () => {
    const { flags, handle } = createService(0);
    flags.set('nieuw-ding', true, 'Beschrijving');
    expect(flags.isEnabled('nieuw-ding')).toBe(true);
    expect(flags.list()).toEqual([
      expect.objectContaining({ key: 'nieuw-ding', enabled: true, description: 'Beschrijving' }),
    ]);
    handle.close();
  });

  it('behoudt de beschrijving als die bij een wijziging niet wordt meegegeven', () => {
    const { flags, handle } = createService(0);
    flags.set('ding', true, 'Oorspronkelijk');
    flags.set('ding', false);
    expect(flags.list()[0]?.description).toBe('Oorspronkelijk');
    handle.close();
  });

  it('cachet binnen de TTL en verlopen de cache daarna', () => {
    const { flags, clock, handle } = createService(5000);
    flags.set('ding', true);
    expect(flags.isEnabled('ding')).toBe(true);

    // Buiten de service om wijzigen: de cache mag dit binnen de TTL niet zien.
    const other = createFlagService(handle.db, clock, 0);
    other.set('ding', false);
    expect(flags.isEnabled('ding')).toBe(true);

    clock.advance(5001);
    expect(flags.isEnabled('ding')).toBe(false);
    handle.close();
  });

  it('leegt de cache direct bij invalidate', () => {
    const { flags, clock, handle } = createService(60_000);
    flags.set('ding', true);
    createFlagService(handle.db, clock, 0).set('ding', false);
    flags.invalidate();
    expect(flags.isEnabled('ding')).toBe(false);
    handle.close();
  });
});
