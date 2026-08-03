/**
 * Voegt de per-soort istanbul-maps samen tot één rapport in `coverage/combined/`
 * (json-summary + html) en geeft het gecombineerde regel-percentage terug. Istanbul telt
 * de regel-hits per bestand bij elkaar op, dus een regel die door unit én e2e geraakt
 * wordt telt als geraakt — niet dubbel. Is er geen enkele `coverage-final.json`, dan
 * undefined: verify valt dan terug op de losse cijfers.
 */
export declare function schrijfGecombineerdeDekking(repoDir: string): number | undefined;
