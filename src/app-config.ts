import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { GebruikersFout } from './shell.js';

export const OMGEVINGEN = ['dev', 'acc', 'prod'] as const;
export type Omgeving = (typeof OMGEVINGEN)[number];

const appConfigSchema = z.object({
  naam: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'gebruik kleine letters, cijfers en streepjes'),
  poorten: z.object({
    dev: z.number().int().min(1).max(65535),
    acc: z.number().int().min(1).max(65535),
    prod: z.number().int().min(1).max(65535),
  }),
  envRoot: z.string().min(1),
  backlog: z.string().min(1),
});

export type AppConfigBestand = z.infer<typeof appConfigSchema>;

export interface AppConfig extends AppConfigBestand {
  /** Map van de applicatie zelf (waar factory.json staat). */
  readonly appDir: string;
  /** Absoluut pad naar de map met de acc- en prod-clones. */
  readonly envRootPad: string;
  /** Absoluut pad naar de backlogmap van deze applicatie. */
  readonly backlogPad: string;
}

export const APP_CONFIG_BESTAND = 'factory.json';

function absoluut(basis: string, pad: string): string {
  const uitgevouwen = pad.startsWith('~') ? path.join(os.homedir(), pad.slice(1)) : pad;
  return path.resolve(basis, uitgevouwen);
}

/** Zoekt factory.json vanaf een map omhoog, zodat de CLI ook in submappen werkt. */
export function zoekAppDir(start: string = process.cwd()): string | undefined {
  let huidig = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(huidig, APP_CONFIG_BESTAND))) {
      return huidig;
    }
    const ouder = path.dirname(huidig);
    if (ouder === huidig) {
      return undefined;
    }
    huidig = ouder;
  }
}

export function leesAppConfig(appDir: string): AppConfig {
  const bestand = path.join(appDir, APP_CONFIG_BESTAND);
  const parsed = appConfigSchema.safeParse(JSON.parse(readFileSync(bestand, 'utf8')));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new GebruikersFout(`${bestand} is ongeldig: ${details}`);
  }
  const config = parsed.data;
  return {
    ...config,
    appDir,
    envRootPad: absoluut(appDir, config.envRoot),
    backlogPad: absoluut(appDir, config.backlog),
  };
}

/**
 * De configuratie van de applicatie waarin de CLI draait.
 * Commando's die per applicatie werken (promote, env, flag) hebben dit nodig.
 */
export function vereisAppConfig(): AppConfig {
  const appDir = zoekAppDir();
  if (appDir === undefined) {
    throw new GebruikersFout(
      `Geen ${APP_CONFIG_BESTAND} gevonden. Dit commando hoort in een applicatiemap te draaien.`,
    );
  }
  return leesAppConfig(appDir);
}

/** Werkmap van een omgeving: dev is de repo zelf, acc en prod zijn losse clones. */
export function werkmapVan(config: AppConfig, omgeving: Omgeving): string {
  return omgeving === 'dev' ? config.appDir : path.join(config.envRootPad, omgeving);
}

export function pm2NaamVan(config: AppConfig, omgeving: Omgeving): string {
  return `${config.naam}-${omgeving}`;
}

function leesEnvBestand(bestand: string): Record<string, string> {
  if (!existsSync(bestand)) {
    return {};
  }
  const resultaat: Record<string, string> = {};
  for (const regel of readFileSync(bestand, 'utf8').split('\n')) {
    const getrimd = regel.trim();
    if (getrimd === '' || getrimd.startsWith('#')) {
      continue;
    }
    const scheiding = getrimd.indexOf('=');
    if (scheiding === -1) {
      continue;
    }
    // Splitsen op de eerste `=`: waarden mogen zelf een `=` of spaties bevatten.
    resultaat[getrimd.slice(0, scheiding)] = getrimd.slice(scheiding + 1);
  }
  return resultaat;
}

/**
 * Leest de omgevingswaarden zoals de pm2-ecosystem dat doet: eerst `<omgeving>.env`,
 * dan `<omgeving>.secrets.env` eroverheen. Zo draaien migrate en seed met dezelfde
 * `DATABASE_FILE` (en de rest) als de draaiende omgeving, in plaats van terug te
 * vallen op de standaardwaarden uit de config.
 */
export function leesOmgevingsWaarden(appDir: string, omgeving: Omgeving): Record<string, string> {
  const map = path.join(appDir, 'environments');
  return {
    ...leesEnvBestand(path.join(map, `${omgeving}.env`)),
    ...leesEnvBestand(path.join(map, `${omgeving}.secrets.env`)),
  };
}

export function isOmgeving(waarde: string | undefined): waarde is Omgeving {
  return waarde !== undefined && (OMGEVINGEN as readonly string[]).includes(waarde);
}

export function vereisOmgeving(waarde: string | undefined): Omgeving {
  if (!isOmgeving(waarde)) {
    throw new GebruikersFout(`Geef een omgeving op: ${OMGEVINGEN.join(', ')}`);
  }
  return waarde;
}
