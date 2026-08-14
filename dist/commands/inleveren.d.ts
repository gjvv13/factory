export interface InleverenOpties {
    /** Titel voor de PR; zonder dit vult gh de titel uit de commits (`--fill`). */
    readonly titel?: string;
}
/**
 * Levert de huidige slice-branch in: lockfile in lijn brengen, de poort draaien,
 * de branch pushen, een PR naar main openen en die in de merge-queue zetten. De
 * queue integreert branches daarna serieel en conflictvrij naar main, dus de sessie
 * kan meteen aan de volgende slice beginnen.
 */
export declare function inleveren(opties?: InleverenOpties): void;
