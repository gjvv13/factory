/**
 * Configuratie voor een ops-room-melding via curl.
 *
 * Drie aanroepers (code-review, orkestreer-bouw, orkestreer) gebruikten
 * hetzelfde curl-POST-blok; deze module brengt dat samen (#606).
 */
export interface OpsMeldingConfig {
    readonly url: string;
    readonly token?: string;
    /** App-naam voor de meldingtekst. */
    readonly app?: string;
}
/**
 * Stuur een best-effort ops-room-melding via curl.
 *
 * - Zonder `url`: waarschuwing, geen aanroep.
 * - Met falende curl: waarschuwing, geen throw.
 */
export declare function meldOps(tekst: string, url: string | undefined, token?: string): void;
