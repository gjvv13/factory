/** De vier dekkingspercentages van het gemergede rapport. */
export interface Dekkingscijfers {
    readonly lines: number;
    readonly statements: number;
    readonly functions: number;
    readonly branches: number;
}
/**
 * Voegt de per-soort istanbul-maps samen tot één rapport in `coverage/combined/`
 * (json-summary + html) en geeft de vier gecombineerde percentages terug. Istanbul telt
 * de regel-hits per bestand bij elkaar op, dus een regel die door unit én e2e geraakt
 * wordt telt als geraakt — niet dubbel. Is er geen enkele `coverage-final.json`, dan
 * undefined: verify valt dan terug op de losse cijfers.
 */
export declare function schrijfGecombineerdeDekking(repoDir: string): Dekkingscijfers | undefined;
