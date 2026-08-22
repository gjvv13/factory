import { defineConfig } from 'vitest/config';
import { coverageOptie } from './configs/coverage.js';

export default defineConfig({
  test: {
    name: 'unit',
    include: ['test/**/*.test.ts'],
    // Integration tests (#293) draaien in een eigen soort met ruimere timeout;
    // contract tests hebben hun eigen config.
    exclude: ['test/integration/**', 'test/contract/**'],
    environment: 'node',
    // Zet een tijdelijke home voor elke test; zie test/setup.ts (#278).
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    ...coverageOptie('unit', { include: ['src/**/*.ts'] }),
  },
});
