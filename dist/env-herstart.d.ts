import { type Omgeving } from './app-config.js';
/**
 * Verwijdert een bestaand pm2-proces en start het vers uit de ecosystem. Bewust
 * geen `pm2 restart --update-env`: dat herleest de ecosystem-env niet maar neemt de
 * env van deze CLI-aanroep over. Alleen een verse start leest de gewijzigde
 * `environments/<omgeving>.env(.secrets)` opnieuw in. `promote` en `env reload`
 * delen deze ene herstart, zodat de env-herlaad overal hetzelfde werkt.
 */
export declare function herstartOmgeving(ecosystem: string, pm2Naam: string): void;
export interface ConfigSamenvatting {
    /** De environments-map waaruit geladen is (de dev-repo, niet de clone). */
    readonly map: string;
    /** De env-bestanden die daadwerkelijk bestaan, in leesvolgorde. */
    readonly bestanden: string[];
    /** De namen van de geladen sleutels, gesorteerd — nooit de waarden. */
    readonly sleutels: string[];
    /** Sleutels die wél gezet zijn maar leeg (of alleen whitespace). */
    readonly legeSleutels: string[];
}
/**
 * Vat samen welke env-config een (her)start heeft ingelezen: uit welke map en
 * bestanden, welke sleutels, en welke daarvan leeg zijn. Bewust alléén sleutelnamen
 * en geen waarden — namen zijn geen geheim, waarden (tokens, sleutels) wel.
 */
export declare function configSamenvatting(appDir: string, omgeving: Omgeving): ConfigSamenvatting;
/**
 * Toont welke config een (her)start heeft ingelezen, zodat een gemiste env/secret
 * meteen zichtbaar is in plaats van stil weg te vallen. Print het herkomst-pad en
 * de sleutelnamen (nooit waarden) en waarschuwt bij lege waarden.
 */
export declare function toonGeladenConfig(appDir: string, omgeving: Omgeving): void;
