export interface OpruimOpties {
    /** Toont wat er zou gebeuren zonder iets te wijzigen. */
    readonly dry?: boolean;
}
/** Eén worktree-entry uit `git worktree list --porcelain`. */
export interface WorktreeEntry {
    readonly pad: string;
    readonly branch: string | undefined;
}
/** Parse de porcelain-uitvoer van `git worktree list` naar gestructureerde entries. */
export declare function parseWorktreeList(porcelain: string): readonly WorktreeEntry[];
/** Eén open release-PR uit `gh pr list --json`. */
export interface ReleasePr {
    readonly number: number;
    readonly headRefName: string;
    readonly mergeable: string;
    readonly title: string;
}
/** Parse het JSON-antwoord van `gh pr list --json` voor release-PR's. */
export declare function parseReleasePrList(json: string): readonly ReleasePr[];
/** Vergelijk twee semver-achtige versies. Geeft <0, 0, of >0. */
export declare function vergelijkVersies(a: string, b: string): number;
/**
 * Ruimt gemergede branches op: lokaal en op de remote. Wat niet in `origin/main`
 * zit blijft staan — dat is de enige harde regel. `main` en de huidige branch
 * worden nooit aangeraakt, en een branch die in een worktree is uitgecheckt wordt
 * overgeslagen met een leesbare melding in plaats van een kale git-fout.
 *
 * Uitgebreid (#421): ruimt ook stale worktrees op (issue dicht, schoon, nul
 * commits boven main) en handelt achterhaalde release-PR's af.
 */
export declare function opruimen(opties?: OpruimOpties): void;
