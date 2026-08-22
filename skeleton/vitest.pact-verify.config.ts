import { defineConfig } from 'vitest/config';
import { pactVerifyConfig } from 'factory/vitest-pact-verify';

export default defineConfig(pactVerifyConfig());
