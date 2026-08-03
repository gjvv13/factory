import { coverageOptie } from './coverage.js';

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
      // E2e dekt de hele app: het draait de echte server. Zolang die server nog
      // niet geïnstrumenteerd is (aparte slice) blijft dit cijfer laag; de include
      // staat alvast op de volledige bron zodat het klopt zodra dat wel gebeurt.
      ...coverageOptie('e2e', { include: ['app/src/**/*.ts'] }),
      ...overrides,
    },
  };
}

export default e2eTestConfig;
