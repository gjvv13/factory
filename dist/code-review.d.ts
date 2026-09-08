import { type ReviewVerdict } from './werker.js';
/**
 * Of `claude` op het pad beschikbaar is. Draait via de testbare `run`, zodat
 * tests dit kunnen stubben zonder de echte CLI nodig te hebben. Vangt zowel
 * een niet-nul exitcode als een startfout (commando niet gevonden) op.
 */
export declare function claudeBeschikbaar(): boolean;
/**
 * Geeft de diff ten opzichte van `origin/main` terug, of undefined als die leeg is.
 * Controleert de ref eerst: een ontbrekende `origin/main` is een reden om de gate
 * niet te laten draaien, niet om halverwege te crashen.
 */
export declare function leesDiff(repoDir: string): string | undefined;
/**
 * Discriminant die de uitkomst van de review-gate onderscheidt (#586).
 *
 * Elke uitkomst heeft een eigen waarde, zodat "kon niet reviewen" en "niets
 * gevonden" nooit dezelfde tak zijn — de storing die dit type voorkomt.
 */
export type ReviewReden = 'uit' | 'geen-diff' | 'niet-beschikbaar' | 'geen-verdict' | 'schoon' | 'bevindingen';
/** Configuratie voor de ops-room-melding bij gate-falen (#586). */
export interface OpsMeldingConfig {
    readonly url: string;
    readonly token?: string;
    /** App-naam voor de meldingtekst. */
    readonly app?: string;
}
export interface ReviewGateResultaat {
    /** Of de gate de inlevering laat doorgaan. */
    readonly doorgaan: boolean;
    /** Discriminant: waarom dit resultaat (#586). */
    readonly reden: ReviewReden;
    /** Het verdict als de review slaagde; undefined bij een crash of skip. */
    readonly verdict?: ReviewVerdict;
    /** Eventuele waarschuwing of fout voor de gebruiker. */
    readonly melding?: string;
}
/**
 * Parset de ruwe stdout van `claude -p --output-format json` naar een ReviewVerdict.
 *
 * De `claude`-CLI levert een JSON-envelop met o.a. `structured_output`. Het verdict
 * zit daarin. Is de envelop niet leesbaar, het model-antwoord niet bruikbaar, of het
 * schema ongeldig, dan is het resultaat `undefined` — de gate degradeert graceful.
 */
export declare function parseReviewUitvoer(stdout: string): ReviewVerdict | undefined;
/**
 * Bouwt het PR-comment op uit een review-verdict. Hetzelfde format als
 * `maakReviewComment` in `orkestreer-bouw.ts`, maar met het onderschrift
 * "Code-review gate" zodat het naast een eventuele bouw-werker-review herkenbaar is.
 */
export declare function maakGateComment(verdict: ReviewVerdict): string;
export type CodeReviewInstelling = 'uit' | 'waarschuw' | 'blokkeer';
export declare function draaiCodeReview(instelling: CodeReviewInstelling, repoDir: string, opsMelding?: OpsMeldingConfig): ReviewGateResultaat;
