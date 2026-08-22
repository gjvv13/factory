/**
 * Vitest-preset voor pact provider-verificatie. De Verifier draait alle
 * interacties tegen één app-instantie, dus bestanden draaien niet parallel.
 * Geen coverage: de Verifier herhaalt HTTP-interacties die e2e al dekt.
 *
 *   import { pactVerifyConfig } from 'factory/vitest-pact-verify';
 *   export default pactVerifyConfig();
 *
 * @param {object} [overrides] Extra Vitest-opties die over de preset heen gaan.
 */
export function pactVerifyConfig(overrides = {}) {
  return {
    test: {
      name: 'pact-verify',
      include: ['app/test/pact-verify/**/*.test.ts'],
      environment: 'node',
      fileParallelism: false,
      globalSetup: ['app/test/pact-verify/global-setup.ts'],
      testTimeout: 30_000,
      hookTimeout: 60_000,
      passWithNoTests: true,
      ...overrides,
    },
  };
}

export default pactVerifyConfig;
