export interface OpruimOpties {
    /** Toont wat er zou gebeuren zonder iets te wijzigen. */
    readonly dry?: boolean;
}
/**
 * Ruimt gemergede branches op: lokaal en op de remote. Wat niet in `origin/main`
 * zit blijft staan — dat is de enige harde regel. `main` en de huidige branch
 * worden nooit aangeraakt, en een branch die in een worktree is uitgecheckt wordt
 * overgeslagen met een leesbare melding in plaats van een kale git-fout.
 */
export declare function opruimen(opties?: OpruimOpties): void;
