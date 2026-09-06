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
export interface ReviewGateResultaat {
    /** Of de gate de inlevering laat doorgaan. */
    readonly doorgaan: boolean;
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
/**
 * Draait de AI-code-review-gate op de huidige branch.
 *
 * Stappen:
 * 1. Pre-flight: controleer of `claude` op het pad staat en of de diff niet leeg is.
 * 2. Draai `claude -p` met het review-prompt en `--json-schema`.
 * 3. Parse het verdict en beslis op basis van de instelling (waarschuw/blokkeer).
 *
 * Bij elke onvoorziene fout (claude niet beschikbaar, crash, timeout) degradeert de
 * gate graceful: waarschuwen en doorgaan. Alleen een geldig verdict met bevindingen
 * kan een blokkade opleveren, en dat uitsluitend bij `blokkeer`.
 */
export declare function draaiCodeReview(instelling: CodeReviewInstelling, repoDir: string): ReviewGateResultaat;
