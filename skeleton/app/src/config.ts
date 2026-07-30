import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const environmentSchema = z.object({
  FACTORY_ENV: z.enum(['dev', 'acc', 'prod', 'test']).default('dev'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_FILE: z.string().min(1).default('data/dev.sqlite'),
  CHANNEL: z.enum(['http', 'cli']).default('http'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  FLAG_CACHE_TTL_MS: z.coerce.number().int().min(0).default(5000),
  ROOT_DIR: z.string().min(1).default(process.cwd()),
});

export type FactoryEnvironment = z.infer<typeof environmentSchema>['FACTORY_ENV'];
export type ChannelName = z.infer<typeof environmentSchema>['CHANNEL'];

export interface Config {
  readonly environment: FactoryEnvironment;
  readonly host: string;
  readonly port: number;
  readonly databaseFile: string;
  readonly channel: ChannelName;
  readonly logLevel: z.infer<typeof environmentSchema>['LOG_LEVEL'];
  readonly flagCacheTtlMs: number;
  readonly rootDir: string;
  readonly migrationsDir: string;
  readonly fixturesDir: string;
  readonly version: string;
}

function readVersion(rootDir: string): string {
  const raw = readFileSync(path.join(rootDir, 'package.json'), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const result = z.object({ version: z.string() }).safeParse(parsed);
  return result.success ? result.data.version : '0.0.0';
}

/**
 * Leest en valideert de configuratie uit de omgevingsvariabelen.
 * Faalt hard bij ongeldige waarden: een verkeerd geconfigureerde omgeving
 * mag nooit half opstarten.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Ongeldige omgevingsconfiguratie: ${details}`);
  }
  const env = parsed.data;
  const rootDir = path.resolve(env.ROOT_DIR);

  return {
    environment: env.FACTORY_ENV,
    host: env.HOST,
    port: env.PORT,
    databaseFile:
      env.DATABASE_FILE === ':memory:' ? ':memory:' : path.resolve(rootDir, env.DATABASE_FILE),
    channel: env.CHANNEL,
    logLevel: env.LOG_LEVEL,
    flagCacheTtlMs: env.FLAG_CACHE_TTL_MS,
    rootDir,
    migrationsDir: path.join(rootDir, 'migrations'),
    fixturesDir: path.join(rootDir, 'app', 'test', 'fixtures'),
    version: readVersion(rootDir),
  };
}
