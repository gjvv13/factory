import { defineConfig } from 'vitest/config';

/**
 * Tests die met opzet een echt subproces starten (npm pack, node, bash) en daarom
 * niet in de snelle unit-run thuishoren (#293). Onder machinebelasting liepen die
 * spawns in hun timeout en maakten de hele verify flaky rood.
 *
 * De timeout is ruimer dan de unit-default (30 s i.p.v. 5 s), zodat een zware machine
 * niet meteen rood kleurt — deze tests zijn per definitie trager.
 */
export default defineConfig({
  test: {
    name: 'integration',
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    restoreMocks: true,
  },
});
