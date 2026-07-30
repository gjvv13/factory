import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './app/src/db/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: './data/dev.sqlite',
  },
});
