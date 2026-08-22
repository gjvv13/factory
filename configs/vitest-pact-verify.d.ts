import type { UserConfig } from 'vitest/config';

/** Vitest-preset voor pact provider-verificatie. Zie vitest-pact-verify.js voor de inhoud. */
export declare function pactVerifyConfig(overrides?: Record<string, unknown>): UserConfig;
export default pactVerifyConfig;
