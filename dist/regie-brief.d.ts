/**
 * De regie-brief (#404): een beslis-gericht overzicht over alle apps heen.
 *
 * Pure functies, geen I/O: de brief wordt opgebouwd uit data die de aanroeper
 * levert. De vier secties — gebouwd/gemergd, wacht op akkoord, geëscaleerd,
 * vastgelopen/stil — verschijnen alleen als er iets in staat (geen ruis).
 */
import type { BacklogItem } from './board.js';
/** Eén regel uit het runlog, geparsed door de aanroeper. */
export interface RunlogEntry {
    readonly moment: string;
    readonly issue: number;
    readonly app: string;
    readonly soort: string;
    readonly uitkomst: string;
    readonly kosten?: string;
}
/** De recentste deploy-run van één app. */
export interface DeployRunStatus {
    readonly app: string;
    readonly conclusion: string;
    readonly url: string;
    readonly createdAt: string;
}
/** Escalatie-context: vraag en advies uit een orkestrator-comment. */
export interface EscalatieContext {
    readonly issue: number;
    readonly vraag: string;
    readonly advies: string;
}
/** Alles wat de brief nodig heeft om zichzelf op te bouwen. */
export interface BriefBronnen {
    readonly items: readonly BacklogItem[];
    readonly escalatieNummers: ReadonlySet<number>;
    readonly escalatieContext: readonly EscalatieContext[];
    readonly runlog: readonly RunlogEntry[];
    readonly deployRuns: readonly DeployRunStatus[];
    /** Het moment waarop de brief wordt gebouwd; bepaalt de "stil"-grens. */
    readonly nu: Date;
}
/** Items op een werkkolom zonder wijziging in deze periode tellen als "stil". */
export declare const STIL_DREMPEL_MS: number;
/**
 * Bouwt de regie-brief als markdown-tekst. Lege secties worden weggelaten;
 * als alles leeg is, levert dit een "niets te melden"-melding.
 */
export declare function bouwBrief(bronnen: BriefBronnen): string;
/**
 * Parset één regel uit het orkestrator-runlog.
 *
 * Formaat (uit `logRun`): `<ISO> #<issue> <app> <soort> <uitkomst> <kosten> <beurten> beurten [uitsplitsing]`
 */
export declare function parseRunlogRegel(regel: string): RunlogEntry | undefined;
/**
 * Parset het hele runlog en filtert op de afgelopen `urenTerug` uur.
 * Robuust: ongeldige regels worden stilletjes overgeslagen.
 */
export declare function parseRunlog(inhoud: string, nu: Date, urenTerug?: number): RunlogEntry[];
