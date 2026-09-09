import { defineConfig } from 'vitest/config';
import { pactVerifyConfig } from '@gjvv13/factory/vitest-pact-verify';

export default defineConfig(pactVerifyConfig());
