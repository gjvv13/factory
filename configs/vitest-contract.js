import { coverageOptie } from './coverage.js';

/**
 * Vitest-preset voor contract tests. Pact start per test een mockserver op,
 * dus bestanden draaien niet parallel: dat zou poortconflicten geven.
 *
 *   import { contractTestConfig } from 'factory/vitest-contract';
 *   export default contractTestConfig();
 *
 * @param {object} [overrides] Extra Vitest-opties die over de preset heen gaan.
 */
export function contractTestConfig(overrides = {}) {
  return {
    test: {
      name: 'contract',
      include: ['app/test/contract/**/*.test.ts'],
      environment: 'node',
      fileParallelism: false,
      testTimeout: 30_000,
      ...coverageOptie('contract'),
      ...overrides,
    },
  };
}

export default contractTestConfig;
