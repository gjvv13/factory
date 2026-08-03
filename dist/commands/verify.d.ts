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
export interface VerifyOpties {
    /** Slaat de e2e-tests over: handig tijdens ontwikkelen. */
    readonly snel?: boolean;
    /** Alleen de snelle stappen, voor de pre-commit hook. */
    readonly preCommit?: boolean;
}
export declare function verify(opties?: VerifyOpties): void;
