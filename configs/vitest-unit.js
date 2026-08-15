import { coverageOptie, LAAG_INCLUDE } from './coverage.js';

/**
 * Vitest-preset voor unit tests: snel, in-memory, geen netwerk.
 *
 *   import { unitTestConfig } from 'factory/vitest-unit';
 *   export default unitTestConfig();
 *
 * @param {object} [overrides] Extra Vitest-opties die over de preset heen gaan.
 */
export function unitTestConfig(overrides = {}) {
  return {
    test: {
      name: 'unit',
      include: ['app/test/unit/**/*.test.ts'],
      environment: 'node',
      restoreMocks: true,
      // Unit dekt de domeinlogica: core, feature flags en de config. Adapters
      // (clients/http/channels) en bootstrap horen bij contract/e2e, niet hier.
      ...coverageOptie('unit', { include: LAAG_INCLUDE.unit }),
      ...overrides,
    },
  };
}

export default unitTestConfig;
