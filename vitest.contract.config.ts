import { defineConfig } from 'vitest/config';
import { coverageOptie } from './configs/coverage.js';

export default defineConfig({
  test: {
    name: 'contract',
    include: ['test/contract/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    ...coverageOptie('contract', { include: ['src/board.ts'] }),
  },
});
