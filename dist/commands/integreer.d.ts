/** Het label waaraan de factory-wachtrij een in te leveren PR herkent. */
export declare const WACHTRIJ_LABEL = "wachtrij";
/** Maakt het `wachtrij`-label aan als het nog niet bestaat (idempotent, faalt niet als het er al is). */
export declare function zorgVoorWachtrijLabel(repoDir: string): void;
/**
 * Werkt de factory-wachtrij af: neemt de oudste open `wachtrij`-PR, toetst hem via de
 * CI-poort en merget of koppelt terug — serieel, één tegelijk (mini-lock). Draait op
 * de mini; raakt de werkmap niet aan, alleen GitHub via `gh`.
 */
export declare function integreer(): void;
