/**
 * Bepaalt of de gemeten dekking onder de drempel zakt. De "totaal" is bij voorkeur het
 * gemergede cijfer (de echte gecombineerde dekking); ontbreekt dat, dan valt hij terug op
 * de hoogste losse soort — een veilige ondergrens. Zonder drempel, of zonder enige meting,
 * geven we geen oordeel.
 */
export declare function beoordeelDekking(dekkingen: readonly number[], minimum: number | undefined, gecombineerd?: number): {
    totaal: number;
    faalt: boolean;
} | undefined;
export interface AuditTelling {
    /** Aantal kwetsbaarheden op of boven het drempelniveau. */
    readonly aantal: number;
    /** Per niveau het aantal, alleen voor de niveaus die meetellen. */
    readonly perNiveau: Readonly<Record<string, number>>;
}
/**
 * Telt de kwetsbaarheden vanaf een drempelniveau uit de json-uitvoer van
 * `pnpm audit`.
 *
 * Geeft `undefined` als de uitvoer niet te lezen is. Dat betekent "de audit kon
 * niet draaien" — meestal geen netwerk (zie #99) — en dat is iets anders dan
 * "niets gevonden". De poort mag niet groen kleuren op een controle die niet
 * heeft plaatsgevonden, en ook niet omvallen op een netwerkhapering die los
 * staat van de wijziging.
 */
export declare function telKwetsbaarheden(uitvoer: string, vanaf: string): AuditTelling | undefined;
export interface VerifyOpties {
    /** Slaat de e2e-tests over: handig tijdens ontwikkelen. */
    readonly snel?: boolean;
    /** Alleen de snelle stappen, voor de pre-commit hook. */
    readonly preCommit?: boolean;
}
export declare function verify(opties?: VerifyOpties): void;
