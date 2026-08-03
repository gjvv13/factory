/**
 * Vitest-preset voor end-to-end tests tegen een echt gestarte applicatie.
 * Eén instantie met één database, dus niet parallel: de tests delen die en
 * zetten de testdata per test terug.
 *
 *   import { e2eTestConfig } from 'factory/vitest-e2e';
 *   export default e2eTestConfig();
 *
 * @param {object} [overrides] Extra Vitest-opties die over de preset heen gaan.
 */
export function e2eTestConfig(overrides = {}) {
  return {
    test: {
      name: 'e2e',
      include: ['app/test/e2e/**/*.test.ts'],
      environment: 'node',
      fileParallelism: false,
      globalSetup: ['app/test/e2e/global-setup.ts'],
      testTimeout: 30_000,
      hookTimeout: 60_000,
      // Geen vitest-coverage voor e2e: die zou het testproces meten (~0%), terwijl de
      // app als apart proces draait. De e2e-dekking komt van de geïnstrumenteerde
      // server, die de global-setup via c8 naar coverage/e2e/ schrijft (factory/e2e-coverage).
      ...overrides,
    },
  };
}

export default e2eTestConfig;
