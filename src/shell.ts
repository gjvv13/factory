import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

export function kop(tekst: string): void {
  process.stdout.write(`\n\x1b[1m==> ${tekst}\x1b[0m\n`);
}

export function ok(tekst: string): void {
  process.stdout.write(`\x1b[32m✓ ${tekst}\x1b[0m\n`);
}

export function waarschuwing(tekst: string): void {
  process.stdout.write(`\x1b[33m! ${tekst}\x1b[0m\n`);
}

export function fout(tekst: string): void {
  process.stderr.write(`\x1b[31m✗ ${tekst}\x1b[0m\n`);
}

/** Fout waarbij de melding al genoeg is: de CLI print hem en stopt met code 1. */
export class GebruikersFout extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GebruikersFout';
  }
}

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Bij true wordt de uitvoer teruggegeven in plaats van doorgegeven aan de terminal. */
  readonly capture?: boolean;
  /** Bij true levert een niet-nul exitcode geen fout op. */
  readonly toleranter?: boolean;
}

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
}

/** Ruwe uitkomst van een proces, vóór interpretatie door run(). */
export interface ProcesUitkomst {
  readonly code: number;
  readonly stdout: string;
  /** Gezet als het proces niet gestart kon worden (commando niet gevonden e.d.). */
  readonly startfout?: string;
}

/**
 * Voert één extern proces uit. Dit is het enige punt waar de CLI de buitenwereld
 * raakt. Tests vervangen het via stelUitvoerderIn(), zodat een commando getest kan
 * worden zonder echt git, pnpm of pm2 aan te roepen.
 */
export type Uitvoerder = (
  commando: string,
  argumenten: string[],
  options: RunOptions,
) => ProcesUitkomst;

const spawnUitvoerder: Uitvoerder = (commando, argumenten, options) => {
  const resultaat = spawnSync(commando, argumenten, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    encoding: 'utf8',
  });
  if (resultaat.error !== undefined) {
    return { code: 1, stdout: '', startfout: resultaat.error.message };
  }
  return { code: resultaat.status ?? 1, stdout: resultaat.stdout };
};

let huidigeUitvoerder: Uitvoerder = spawnUitvoerder;

/** Vervangt de proces-uitvoerder. Alleen bedoeld voor tests. */
export function stelUitvoerderIn(uitvoerder: Uitvoerder): void {
  huidigeUitvoerder = uitvoerder;
}

/** Herstelt de echte proces-uitvoerder na een test. */
export function herstelUitvoerder(): void {
  huidigeUitvoerder = spawnUitvoerder;
}

/**
 * Voert een commando uit. Stdin staat standaard dicht: de pipeline is niet
 * interactief en mag nooit op invoer blijven wachten.
 */
export function run(commando: string, argumenten: string[], options: RunOptions = {}): RunResult {
  const uitkomst = huidigeUitvoerder(commando, argumenten, options);
  if (uitkomst.startfout !== undefined) {
    throw new GebruikersFout(`Kon '${commando}' niet uitvoeren: ${uitkomst.startfout}`);
  }
  if (uitkomst.code !== 0 && options.toleranter !== true) {
    throw new GebruikersFout(
      `'${commando} ${argumenten.join(' ')}' faalde met code ${String(uitkomst.code)}`,
    );
  }
  return { code: uitkomst.code, stdout: uitkomst.stdout };
}

export function git(argumenten: string[], cwd: string, options: RunOptions = {}): RunResult {
  return run('git', argumenten, { ...options, cwd });
}

/** Uitvoer van een commando als getrimde tekst, of undefined als het faalt. */
export function uitvoerVan(
  commando: string,
  argumenten: string[],
  cwd?: string,
): string | undefined {
  const resultaat = run(commando, argumenten, {
    ...(cwd === undefined ? {} : { cwd }),
    capture: true,
    toleranter: true,
  });
  return resultaat.code === 0 ? resultaat.stdout.trim() : undefined;
}

/**
 * De pakketbeheerder waarmee scripts gedraaid worden. pnpm komt via corepack,
 * dus in een niet-interactieve shell staat hij niet altijd los in de PATH.
 */
export function pakketbeheerder(): { commando: string; basisArgumenten: string[] } {
  const heeftPnpm = spawnSync('pnpm', ['--version'], { stdio: 'ignore' }).status === 0;
  return heeftPnpm
    ? { commando: 'pnpm', basisArgumenten: [] }
    : { commando: 'corepack', basisArgumenten: ['pnpm'] };
}

export function draaiScript(script: string, cwd: string, env?: NodeJS.ProcessEnv): void {
  const { commando, basisArgumenten } = pakketbeheerder();
  run(commando, [...basisArgumenten, 'run', script], {
    cwd,
    ...(env === undefined ? {} : { env }),
  });
}

/** Of er een terminal aan stdin hangt, zodat we de gebruiker iets kunnen vragen. */
export function isInteractief(): boolean {
  return process.stdin.isTTY;
}

/**
 * Stelt een ja/nee-vraag en geeft true bij 'j' of 'ja' (hoofdletterongevoelig);
 * al het andere, ook enter, is nee. De streams zijn injecteerbaar zodat de vraag
 * getest kan worden zonder een echte terminal.
 */
export async function bevestig(
  vraag: string,
  io: { input?: Readable; output?: Writable } = {},
): Promise<boolean> {
  const rl = createInterface({
    input: io.input ?? process.stdin,
    output: io.output ?? process.stdout,
  });
  try {
    const antwoord = await rl.question(`${vraag} [j/N] `);
    return /^ja?$/i.test(antwoord.trim());
  } finally {
    rl.close();
  }
}

/** Een draaiend proces dat we later weer stoppen. */
export interface ProcesHandle {
  kill(): void;
}

/**
 * Start een proces op de achtergrond. Injecteerbaar zodat een test niet echt een
 * proces hoeft te spawnen.
 */
export type ProcesStarter = (
  commando: string,
  argumenten: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ProcesHandle;

const spawnStarter: ProcesStarter = (commando, argumenten, options) => {
  const kind = spawn(commando, argumenten, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'ignore',
  });
  return {
    kill: () => {
      kind.kill();
    },
  };
};

let huidigeStarter: ProcesStarter = spawnStarter;

/** Vervangt de proces-starter. Alleen bedoeld voor tests. */
export function stelStarterIn(starter: ProcesStarter): void {
  huidigeStarter = starter;
}

/** Herstelt de echte proces-starter na een test. */
export function herstelStarter(): void {
  huidigeStarter = spawnStarter;
}

/** Vraagt het besturingssysteem om een vrije poort op de loopback. */
export function vrijePoort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const adres = server.address();
      const poort = typeof adres === 'object' && adres !== null ? adres.port : 0;
      server.close(() => {
        resolve(poort);
      });
    });
  });
}

/**
 * Start een commando, wacht tot de health-URL gezond antwoordt, en stopt het
 * proces daarna weer. Geeft terug of het binnen de tijd gezond werd. Zo kan een
 * nieuwe versie gecontroleerd worden vóórdat een draaiende omgeving wordt
 * aangeraakt.
 */
export async function isGezondNaStart(
  opstart: { commando: string; argumenten: string[]; cwd: string; env: NodeJS.ProcessEnv },
  healthUrl: string,
  seconden: number,
): Promise<boolean> {
  const proces = huidigeStarter(opstart.commando, opstart.argumenten, {
    cwd: opstart.cwd,
    env: opstart.env,
  });
  try {
    for (let poging = 0; poging < seconden; poging += 1) {
      try {
        const antwoord = await fetch(healthUrl);
        if (antwoord.ok) {
          return true;
        }
      } catch {
        // Nog niet opgekomen; volgende poging.
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  } finally {
    proces.kill();
  }
}

/**
 * Poll een health-URL tot hij gezond antwoordt. Geeft de responstekst terug, of
 * undefined als het binnen de tijd niet lukt. Throwt niet, zodat de aanroeper zelf
 * kan beslissen wat een falende gezondheid betekent (bijv. terugrollen).
 */
export async function wachtOpGezond(url: string, seconden: number): Promise<string | undefined> {
  for (let poging = 0; poging < seconden; poging += 1) {
    try {
      const antwoord = await fetch(url);
      if (antwoord.ok) {
        return await antwoord.text();
      }
    } catch {
      // Nog niet op; volgende poging.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return undefined;
}
