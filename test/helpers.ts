import type { AsyncUitvoerder, ProcesUitkomst, RunOptions, Uitvoerder } from '../src/shell.js';
import { stelAsyncUitvoerderIn, stelUitvoerderIn } from '../src/shell.js';

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

/** Async variant van `Opnemer`: de opnemer die bij `runAsync` / de werker-keten past. */
export interface AsyncOpnemer {
  readonly uitvoerder: AsyncUitvoerder;
  readonly aanroepen: ProcesAanroep[];
}

/**
 * Async variant van `maakUitvoerderOpnemer`: geeft een `AsyncUitvoerder` die elke
 * aanroep onthoudt en dezelfde `bepaal`-callback ondersteunt. Hiermee worden de
 * bestaande werker-tests async zonder hun logica te veranderen.
 */
export function maakAsyncUitvoerderOpnemer(bepaal?: UitkomstBepaler): AsyncOpnemer {
  const aanroepen: ProcesAanroep[] = [];
  const uitvoerder: AsyncUitvoerder = (commando, argumenten, options: RunOptions) => {
    const aanroep: ProcesAanroep = {
      commando,
      argumenten,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    };
    aanroepen.push(aanroep);
    return Promise.resolve({
      code: 0,
      stdout: '',
      ...(bepaal?.(aanroep, aanroepen.length - 1) ?? {}),
    });
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

/**
 * Zet zowel de sync als de async uitvoerder op dezelfde `bepaal`-callback met een
 * gedeelde `aanroepen`-lijst. De sync uitvoerder bedient `git`, `gh` en `pnpm` (die
 * nog `run()` gebruiken); de async uitvoerder bedient `claude` (die na #224
 * `runAsync()` gebruikt). Tests zien alle aanroepen in één array.
 */
export function zetBeideUitvoerdersOp(bepaal?: UitkomstBepaler): Opnemer {
  const aanroepen: ProcesAanroep[] = [];
  const maakAanroep = (
    commando: string,
    argumenten: string[],
    options: RunOptions,
  ): { aanroep: ProcesAanroep; uitkomst: ProcesUitkomst } => {
    const aanroep: ProcesAanroep = {
      commando,
      argumenten,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    };
    aanroepen.push(aanroep);
    return {
      aanroep,
      uitkomst: { code: 0, stdout: '', ...(bepaal?.(aanroep, aanroepen.length - 1) ?? {}) },
    };
  };
  const uitvoerder: Uitvoerder = (commando, argumenten, options) =>
    maakAanroep(commando, argumenten, options).uitkomst;
  const asyncUitvoerder: AsyncUitvoerder = (commando, argumenten, options) =>
    Promise.resolve(maakAanroep(commando, argumenten, options).uitkomst);
  stelUitvoerderIn(uitvoerder);
  stelAsyncUitvoerderIn(asyncUitvoerder);
  return { uitvoerder, aanroepen };
}
