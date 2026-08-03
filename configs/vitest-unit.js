import { coverageOptie } from './coverage.js';

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
      ...coverageOptie('unit', {
        include: ['app/src/core/**/*.ts', 'app/src/flags/**/*.ts', 'app/src/config.ts'],
      }),
      ...overrides,
    },
  };
}

export default unitTestConfig;
