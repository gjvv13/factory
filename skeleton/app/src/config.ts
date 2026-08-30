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
  /** Sleutels die de app verwacht in het env-bestand. */
  readonly verwachteSleutels: readonly string[];
  /** Omgevingssleutels die aanwezig zijn (naam, nooit waarde). */
  readonly presentKeys: readonly string[];
  /** Subset van presentKeys waarvan de waarde een lege string is. */
  readonly emptyKeys: readonly string[];
}

function readVersion(rootDir: string): string {
  const raw = readFileSync(path.join(rootDir, 'package.json'), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const result = z.object({ version: z.string() }).safeParse(parsed);
  return result.success ? result.data.version : '0.0.0';
}

/**
 * Sleutels die in het env-bestand van elke omgeving moeten staan.
 * Vul deze aan wanneer je een sleutel toevoegt die per omgeving moet variëren.
 * Een `.default()` in het Zod-schema betekent niet dat de default goed is voor
 * elke omgeving — `DATABASE_FILE` heeft default `data/dev.sqlite`: prima voor
 * dev, onjuist voor prod.
 */
export const VERWACHTE_SLEUTELS: readonly string[] = [];

/**
 * Sleutels die in het secrets-bestand horen (niet in git).
 * Worden alleen gecontroleerd als het secrets-bestand er is.
 */
export const GEHEIME_SLEUTELS: readonly string[] = [];

/**
 * Leest en valideert de configuratie uit de omgevingsvariabelen.
 * Faalt hard bij ongeldige waarden: een verkeerd geconfigureerde omgeving
 * mag nooit half opstarten.
 */
export function loadConfig(
  source: NodeJS.ProcessEnv = process.env,
  opties: { readonly verwachteSleutels?: readonly string[] } = {},
): Config {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Ongeldige omgevingsconfiguratie: ${details}`);
  }
  const env = parsed.data;
  const rootDir = path.resolve(env.ROOT_DIR);

  // Leg vast welke omgevingssleutels aanwezig zijn en welke leeg — alleen
  // namen, nooit waarden. Gebruikt door /admin/config om de gezondheid van
  // de configuratie te tonen zonder geheimen prijs te geven.
  const presentKeys = Object.keys(source).filter((k) => k in source);
  const emptyKeys = presentKeys.filter((k) => source[k] === '');

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
    // De override laat een test één verwachte sleutel declareren zonder de
    // productie-const aan te raken; zo is het `incomplete`-pad door de echte
    // config-bedrading te testen (#106). Zonder override: de const.
    verwachteSleutels: opties.verwachteSleutels ?? VERWACHTE_SLEUTELS,
    presentKeys,
    emptyKeys,
  };
}
