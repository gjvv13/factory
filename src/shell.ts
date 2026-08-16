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
  /** Gevangen stderr; leeg als de uitvoer naar de terminal ging (geen capture). */
  readonly stderr: string;
}

/** Ruwe uitkomst van een proces, vóór interpretatie door run(). */
export interface ProcesUitkomst {
  readonly code: number;
  readonly stdout: string;
  /** Gevangen stderr (alleen bij capture); leeg of afwezig als niet gevangen. */
  readonly stderr?: string;
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
  return { code: resultaat.status ?? 1, stdout: resultaat.stdout, stderr: resultaat.stderr };
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
  return { code: uitkomst.code, stdout: uitkomst.stdout, stderr: uitkomst.stderr ?? '' };
}

/**
 * Herkent de signatuur van een tijdelijke DNS-storing naar een externe host — de
 * blip die af en toe `git push` (ssh) of `pnpm install` (https) laat mislukken.
 * Bewust strak op de bekende strings, zodat een échte fout (auth, non-fast-forward,
 * merge-conflict) níet als vergeeflijk telt en meteen naar boven komt.
 */
export function isDnsBlip(tekst: string): boolean {
  return /could not resolve host|nodename nor servname|temporary failure in name resolution|getaddrinfo (?:ENOTFOUND|EAI_AGAIN)/i.test(
    tekst,
  );
}

/** Een pauze in milliseconden. Injecteerbaar zodat tests niet echt wachten. */
export type Wacht = (ms: number) => void;

const echteWacht: Wacht = (ms) => {
  // Synchrone slaap: run() is synchroon (spawnSync), dus de backoff kan geen await
  // gebruiken. Atomics.wait blokkeert deze thread zonder te pollen. In een CLI is
  // even blokkeren prima; tests vervangen dit door een no-op.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

let huidigeWacht: Wacht = echteWacht;

/** Vervangt de backoff-slaap. Alleen bedoeld voor tests. */
export function stelWachtIn(wacht: Wacht): void {
  huidigeWacht = wacht;
}

/** Herstelt de echte backoff-slaap na een test. */
export function herstelWacht(): void {
  huidigeWacht = echteWacht;
}

export interface HerhaalOpties {
  /** Maximaal aantal pogingen (inclusief de eerste). Default 3. */
  readonly pogingen?: number;
  /** Basiswachttijd in ms; verdubbelt per poging (1s → 2s → 4s). Default 1000. */
  readonly backoffMs?: number;
  /** Korte omschrijving voor de waarschuwing, bijv. 'push naar origin'. */
  readonly wat?: string;
}

/**
 * Voert een commando uit en herhaalt het bij een tijdelijke DNS-storing, met
 * oplopende backoff. Alleen die klasse fout wordt herhaald: elke andere non-nul
 * uitkomst valt terug op het normale run()-gedrag (fout naar boven, tenzij
 * `toleranter`). Blijft de storing aanhouden, dan faalt de laatste poging met de
 * echte fout. De uitvoer wordt gevangen om stderr te kunnen inspecteren en bij een
 * echte fout alsnog doorgegeven, zodat de aanroeper niets aan zichtbaarheid inlevert.
 */
export function runMetHerhaling(
  commando: string,
  argumenten: string[],
  options: RunOptions = {},
  herhaal: HerhaalOpties = {},
): RunResult {
  const pogingen = herhaal.pogingen ?? 3;
  const backoffMs = herhaal.backoffMs ?? 1000;
  const wat = herhaal.wat ?? commando;

  for (let poging = 1; ; poging += 1) {
    const uitkomst = huidigeUitvoerder(commando, argumenten, { ...options, capture: true });
    if (uitkomst.startfout !== undefined) {
      throw new GebruikersFout(`Kon '${commando}' niet uitvoeren: ${uitkomst.startfout}`);
    }
    if (uitkomst.code === 0) {
      return { code: 0, stdout: uitkomst.stdout, stderr: uitkomst.stderr ?? '' };
    }

    const uitvoer = `${uitkomst.stdout}\n${uitkomst.stderr ?? ''}`;
    if (isDnsBlip(uitvoer) && poging < pogingen) {
      const wachtMs = backoffMs * 2 ** (poging - 1);
      waarschuwing(
        `${wat} faalde op een tijdelijke DNS-storing (poging ${String(poging)}/${String(pogingen)}), opnieuw over ${String(Math.round(wachtMs / 1000))}s…`,
      );
      huidigeWacht(wachtMs);
      continue;
    }

    // Geen blip, of de pogingen zijn op: terug naar het normale run()-gedrag. We
    // gaven capture geforceerd aan, dus geef de opgevangen uitvoer alsnog door zodat
    // de echte fout zichtbaar is.
    if (options.toleranter === true) {
      return { code: uitkomst.code, stdout: uitkomst.stdout, stderr: uitkomst.stderr ?? '' };
    }
    if (uitkomst.stdout !== '') process.stdout.write(uitkomst.stdout);
    if ((uitkomst.stderr ?? '') !== '') process.stderr.write(uitkomst.stderr ?? '');
    throw new GebruikersFout(
      `'${commando} ${argumenten.join(' ')}' faalde met code ${String(uitkomst.code)}`,
    );
  }
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
