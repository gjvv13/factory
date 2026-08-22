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
  // Paden (relatief aan de app-map) die `factory sync --check` bewust niet als
  // drift meldt. Zonder deze sleutel in het schema zou Zod hem stil strippen.
  syncNegeer: z.array(z.string()).optional(),
  /** Optionele ondergrens (0–100) waaronder `factory verify` faalt op te weinig dekking. */
  dekkingsMinimum: z.number().min(0).max(100).optional(),
  /**
   * Gedrag van de dekkings-ratchet: de bewegende lat die de dekking vergelijkt met het
   * hoogste punt dat de app ooit haalde (vastgelegd in `dekking-basislijn.json`). `waarschuw`
   * meldt een daling geel maar laat de poort groen; `blokkeer` laat `verify` falen; `uit` zet
   * de ratchet stil. Default `waarschuw`: advies-eerst, zonder een app meteen rood te zetten.
   */
  dekkingsRatchet: z.enum(['uit', 'waarschuw', 'blokkeer']).default('waarschuw'),
  /**
   * Speling in procentpunten waarmee de ratchet rekent, tegen de kleine run-op-run-ruis van
   * v8-coverage. Een daling kleiner dan dit telt niet als regressie; pas boven deze marge
   * beweegt de basislijn omhoog. Default 0.5.
   */
  dekkingsTolerantie: z.number().min(0).max(5).default(0.5),
  /**
   * Hoe `factory inleveren` een branch integreert. `merge-queue` (default) gebruikt de
   * GitHub merge-queue (werkt op de publieke factory-repo). `lokaal` gebruikt de
   * factory-eigen wachtrij: de PR krijgt het label `wachtrij` en `factory integreer`
   * op de mini werkt die rij serieel af — voor de private apps waar de merge-queue niet
   * beschikbaar is.
   */
  integratie: z.enum(['merge-queue', 'lokaal']).default('merge-queue'),
  /**
   * Gedrag van de afhankelijkheden-audit in de volledige `factory verify`. `waarschuw`
   * (default) meldt kwetsbare pakketten geel en houdt de poort groen; `blokkeer` laat
   * verify falen; `uit` slaat de stap over. Advies-eerst, net als de dekkings-ratchet:
   * een advisory in een transitieve dev-dependency mag een release niet gijzelen
   * zolang je hem nog niet beoordeeld hebt.
   */
  audit: z.enum(['uit', 'waarschuw', 'blokkeer']).default('waarschuw'),
  /**
   * Gedrag van de config-sleuteltoets in de volledige `factory verify`. Controleert
   * per omgeving (acc, prod) of de env-bestanden de sleutels bevatten die de code
   * verwacht. `waarschuw` (default) meldt ontbrekende sleutels geel en houdt de poort
   * groen; `blokkeer` laat verify falen; `uit` slaat de stap over.
   */
  configSleutels: z.enum(['uit', 'waarschuw', 'blokkeer']).default('waarschuw'),
  /** Vanaf welke ernst de audit meetelt. Default `high`: lager is in de praktijk ruis. */
  auditNiveau: z.enum(['low', 'moderate', 'high', 'critical']).default('high'),
  /**
   * Een rooktest die `factory rooktest` na een uitrol tegen de omgeving draait: één
   * echte, **read-only** aanroep door de kern, zodat een groene deploy met een kapot
   * brein niet ongemerkt live gaat (#121). `/health` zegt "ok" ook als het hart eruit
   * ligt; deze aanroep bewijst dat de app echt antwoordt. De read-only garantie ligt bij
   * de app-auteur: kies een leesactie (geen bestelling, geen regel in een lijst).
   */
  rooktest: z
    .object({
      /** Pad op de app, bijv. `/channels/http/inbound`. */
      pad: z.string().min(1),
      /** HTTP-methode; default POST (een inbound bericht). */
      methode: z.enum(['GET', 'POST']).default('POST'),
      /** Optionele JSON-body als string, bijv. `{"from":"rooktest","text":"ping"}`. */
      body: z.string().optional(),
      /** Verwachte statuscode; default 200. */
      verwachteStatus: z.number().int().min(100).max(599).default(200),
      /** Optioneel: de antwoordtekst moet deze string bevatten (app-agnostische inhoudscheck). */
      bevat: z.string().optional(),
    })
    .optional(),
});

export type AppConfigBestand = z.infer<typeof appConfigSchema>;

export interface AppConfig extends AppConfigBestand {
  /** Map van de applicatie zelf (waar factory.json staat). */
  readonly appDir: string;
  /** Absoluut pad naar de map met de acc- en prod-clones. */
  readonly envRootPad: string;
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
