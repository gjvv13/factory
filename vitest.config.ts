import { defineConfig } from 'vitest/config';
import { coverageOptie } from './configs/coverage.js';

export default defineConfig({
  test: {
    name: 'unit',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    ...coverageOptie('unit', { include: ['src/**/*.ts'] }),
  },
});
