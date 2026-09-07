/**
 * Parser voor het orkestrator-runlog (#544).
 *
 * Het logbestand is platte tekst, append-only, geschreven door `logRun` in
 * `orkestrator-instellingen.ts`. Elke regel heeft het formaat:
 *
 *   <ISO> #<issue> <app> <soort> <uitkomst> <kosten> <beurten> beurten [uitsplitsing] [w:N:tool1,tool2]
 *
 * De wrijvingssuffix `[w:…]` is optioneel en verschijnt alleen bij runs met
 * geweigerde gereedschappen. Oude regels zonder suffix parsen met weigeringen=0.
 */
import type { WerkerSoort } from './orkestrator-instellingen.js';
/** Eén geparsed record uit het runlog. */
export interface RunLogRecord {
    readonly moment: Date;
    readonly issue: number;
    readonly app: string;
    readonly soort: WerkerSoort;
    readonly uitkomst: string;
    readonly kosten?: number;
    readonly beurten?: number;
    /** Aantal geweigerde gereedschappen; 0 bij oude regels. */
    readonly weigeringen: number;
    /** Welke gereedschappen geweigerd werden; [] bij oude regels. */
    readonly geweigerd: readonly string[];
}
/**
 * Parset één logregel naar een `RunLogRecord`.
 *
 * Retourneert `undefined` bij een ongeldige regel — robuust, zodat een
 * beschadigd logbestand de hele aggregatie niet omgooit.
 */
export declare function parseRunLogRegel(regel: string): RunLogRecord | undefined;
/**
 * Leest het runlog en retourneert de laatste `n` records.
 *
 * Robuust: een ontbrekend of leeg bestand retourneert []. Ongeldige regels
 * worden overgeslagen.
 */
export declare function leesRunLog(pad: string, n?: number): RunLogRecord[];
