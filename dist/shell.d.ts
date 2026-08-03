import type { Readable, Writable } from 'node:stream';
export declare function kop(tekst: string): void;
export declare function ok(tekst: string): void;
export declare function waarschuwing(tekst: string): void;
export declare function fout(tekst: string): void;
/** Fout waarbij de melding al genoeg is: de CLI print hem en stopt met code 1. */
export declare class GebruikersFout extends Error {
    constructor(message: string);
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
export type Uitvoerder = (commando: string, argumenten: string[], options: RunOptions) => ProcesUitkomst;
/** Vervangt de proces-uitvoerder. Alleen bedoeld voor tests. */
export declare function stelUitvoerderIn(uitvoerder: Uitvoerder): void;
/** Herstelt de echte proces-uitvoerder na een test. */
export declare function herstelUitvoerder(): void;
/**
 * Voert een commando uit. Stdin staat standaard dicht: de pipeline is niet
 * interactief en mag nooit op invoer blijven wachten.
 */
export declare function run(commando: string, argumenten: string[], options?: RunOptions): RunResult;
export declare function git(argumenten: string[], cwd: string, options?: RunOptions): RunResult;
/** Uitvoer van een commando als getrimde tekst, of undefined als het faalt. */
export declare function uitvoerVan(commando: string, argumenten: string[], cwd?: string): string | undefined;
/**
 * De pakketbeheerder waarmee scripts gedraaid worden. pnpm komt via corepack,
 * dus in een niet-interactieve shell staat hij niet altijd los in de PATH.
 */
export declare function pakketbeheerder(): {
    commando: string;
    basisArgumenten: string[];
};
export declare function draaiScript(script: string, cwd: string, env?: NodeJS.ProcessEnv): void;
/** Of er een terminal aan stdin hangt, zodat we de gebruiker iets kunnen vragen. */
export declare function isInteractief(): boolean;
/**
 * Stelt een ja/nee-vraag en geeft true bij 'j' of 'ja' (hoofdletterongevoelig);
 * al het andere, ook enter, is nee. De streams zijn injecteerbaar zodat de vraag
 * getest kan worden zonder een echte terminal.
 */
export declare function bevestig(vraag: string, io?: {
    input?: Readable;
    output?: Writable;
}): Promise<boolean>;
/** Een draaiend proces dat we later weer stoppen. */
export interface ProcesHandle {
    kill(): void;
}
/**
 * Start een proces op de achtergrond. Injecteerbaar zodat een test niet echt een
 * proces hoeft te spawnen.
 */
export type ProcesStarter = (commando: string, argumenten: string[], options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
}) => ProcesHandle;
/** Vervangt de proces-starter. Alleen bedoeld voor tests. */
export declare function stelStarterIn(starter: ProcesStarter): void;
/** Herstelt de echte proces-starter na een test. */
export declare function herstelStarter(): void;
/** Vraagt het besturingssysteem om een vrije poort op de loopback. */
export declare function vrijePoort(): Promise<number>;
/**
 * Start een commando, wacht tot de health-URL gezond antwoordt, en stopt het
 * proces daarna weer. Geeft terug of het binnen de tijd gezond werd. Zo kan een
 * nieuwe versie gecontroleerd worden vóórdat een draaiende omgeving wordt
 * aangeraakt.
 */
export declare function isGezondNaStart(opstart: {
    commando: string;
    argumenten: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
}, healthUrl: string, seconden: number): Promise<boolean>;
/**
 * Poll een health-URL tot hij gezond antwoordt. Geeft de responstekst terug, of
 * undefined als het binnen de tijd niet lukt. Throwt niet, zodat de aanroeper zelf
 * kan beslissen wat een falende gezondheid betekent (bijv. terugrollen).
 */
export declare function wachtOpGezond(url: string, seconden: number): Promise<string | undefined>;
