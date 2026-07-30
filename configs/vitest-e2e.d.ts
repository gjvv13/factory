import type { UserConfig } from 'vitest/config';

/** Vitest-preset voor end-to-end tests. Zie vitest-e2e.js voor de inhoud. */
export declare function e2eTestConfig(overrides?: Record<string, unknown>): UserConfig;
export default e2eTestConfig;
