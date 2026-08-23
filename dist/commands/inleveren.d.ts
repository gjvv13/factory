export interface InleverenOpties {
    /** Titel voor de PR; zonder dit vult gh de titel uit de commits (`--fill`). */
    readonly titel?: string;
    /**
     * Levert in zonder auto-merge: de PR wordt geopend en blijft staan tot iemand hem
     * merget (#183). Voor een onbemande bouw-werker: die mag code voorstellen, niet
     * landen. Op een app met de lokale wachtrij betekent het dat het `wachtrij`-label
     * niet gezet wordt, want dat label ís de opdracht om te mergen.
     */
    readonly geenAutomerge?: boolean;
    /** De repo waarin ingeleverd wordt; de bouw-werker (#183) levert in vanuit een worktree. */
    readonly cwd?: string;
}
/**
 * Parseert de JSON-uitvoer van `gh pr view --json url,state` tot url + state.
 * Een lege string (geen PR voor deze branch) geeft undefined.
 */
export declare function parsePrView(json: string): {
    url: string;
    state: string;
} | undefined;
/**
 * Levert de huidige slice-branch in: lockfile in lijn brengen, de poort draaien,
 * de branch pushen, een PR naar main openen en die in de merge-queue zetten. De
 * queue integreert branches daarna serieel en conflictvrij naar main, dus de sessie
 * kan meteen aan de volgende slice beginnen.
 */
export declare function inleveren(opties?: InleverenOpties): void;
