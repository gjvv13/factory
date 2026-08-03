/**
 * Bepaalt of de gemeten dekking onder de drempel zakt. De "totaal" is de hoogste
 * dekking over de gemeten testsoorten: een veilige ondergrens voor de werkelijke
 * gecombineerde dekking (die alleen met een echte merge exact te bepalen is —
 * bewust uitgesteld). Zonder drempel of zonder metingen geven we geen oordeel.
 */
export declare function beoordeelDekking(dekkingen: readonly number[], minimum: number | undefined): {
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
