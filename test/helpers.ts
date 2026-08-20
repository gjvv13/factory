import type { ProcesUitkomst, RunOptions, Uitvoerder } from '../src/shell.js';

/** Eén opgenomen proces-aanroep: genoeg om te controleren wat een commando zou draaien. */
export interface ProcesAanroep {
  readonly commando: string;
  readonly argumenten: string[];
  readonly cwd?: string;
  /** De meegegeven omgeving, als het commando er een kreeg (bijv. een PAT voor gh). */
  readonly env?: NodeJS.ProcessEnv;
  /** De tijdsgrens, als het commando er een kreeg (#206). */
  readonly timeoutMs?: number;
}

export interface Opnemer {
  readonly uitvoerder: Uitvoerder;
  readonly aanroepen: ProcesAanroep[];
}

/**
 * Bepaalt de uitkomst van één opgenomen aanroep. Wat niet wordt teruggegeven valt
 * terug op slagen (code 0, lege uitvoer). Zo kan een test bijvoorbeeld de branch
 * `main` teruggeven of één specifiek commando laten falen.
 */
export type UitkomstBepaler = (aanroep: ProcesAanroep, index: number) => Partial<ProcesUitkomst>;

/**
 * Een proces-uitvoerder die niets uitvoert maar elke aanroep onthoudt. Zo kan een
 * test controleren welke externe commando's (git, pnpm, pm2) een functie zou
 * draaien, zonder de buitenwereld aan te raken. Standaard slaagt elke aanroep;
 * geef een bepaler mee om per aanroep een uitvoer of een fout te sturen.
 */
export function maakUitvoerderOpnemer(bepaal?: UitkomstBepaler): Opnemer {
  const aanroepen: ProcesAanroep[] = [];
  const uitvoerder: Uitvoerder = (commando, argumenten, options: RunOptions) => {
    const aanroep: ProcesAanroep = {
      commando,
      argumenten,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    };
    aanroepen.push(aanroep);
    return { code: 0, stdout: '', ...(bepaal?.(aanroep, aanroepen.length - 1) ?? {}) };
  };
  return { uitvoerder, aanroepen };
}

/**
 * Maakt de board-poort uit `src/board.ts` voorspelbaar, ongeacht wáár de test draait.
 *
 * Die poort kijkt naar `GITHUB_ACTIONS` en `PROJECT_TOKEN`, en in CI draaien de tests
 * zélf in een workflow — dan zou hij het board overslaan en falen tests die juist de
 * bord-aanroepen controleren. Lokaal zijn die variabelen niet gezet, dus zonder deze
 * helper is de uitkomst afhankelijk van de omgeving.
 *
 * Levert een functie op die de oorspronkelijke waarden terugzet.
 */
export function zetBoardOmgeving(waarden: {
  readonly inWorkflow?: boolean;
  readonly pat?: string;
}): () => void {
  const oud = { acties: process.env.GITHUB_ACTIONS, pat: process.env.PROJECT_TOKEN };
  const zetActies = (waarde: string | undefined): void => {
    if (waarde === undefined) {
      delete process.env.GITHUB_ACTIONS;
    } else {
      process.env.GITHUB_ACTIONS = waarde;
    }
  };
  const zetPat = (waarde: string | undefined): void => {
    if (waarde === undefined) {
      delete process.env.PROJECT_TOKEN;
    } else {
      process.env.PROJECT_TOKEN = waarde;
    }
  };
  zetActies(waarden.inWorkflow === true ? 'true' : undefined);
  zetPat(waarden.pat);
  return () => {
    zetActies(oud.acties);
    zetPat(oud.pat);
  };
}
