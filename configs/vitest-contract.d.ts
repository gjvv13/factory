import type { UserConfig } from 'vitest/config';

/** Vitest-preset voor contract tests. Zie vitest-contract.js voor de inhoud. */
export declare function contractTestConfig(overrides?: Record<string, unknown>): UserConfig;
export default contractTestConfig;
