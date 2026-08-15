import { coverageOptie, LAAG_INCLUDE } from './coverage.js';

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
      // Contract dekt de clients: de adapters die met externe diensten praten.
      ...coverageOptie('contract', { include: LAAG_INCLUDE.contract }),
      ...overrides,
    },
  };
}

export default contractTestConfig;
