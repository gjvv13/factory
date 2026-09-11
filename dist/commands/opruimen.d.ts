export interface OpruimOpties {
    /** Toont wat er zou gebeuren zonder iets te wijzigen. */
    readonly dry?: boolean;
    /** Expliciet repo-pad; zonder dit valt `opruimen` terug op `process.cwd()`. */
    readonly repoPad?: string;
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
/**
 * Vraagt de PR-state van een branch op via `gh pr view`. Geeft 'MERGED', 'CLOSED',
 * 'OPEN', of `undefined` als de opvraging faalt (netwerk, rate-limit, geen PR).
 *
 * Bij squash-merge is de branch-tip per definitie nooit een ancestor van `main`,
 * waardoor `isGemerged` altijd `false` geeft. De PR-state is bij slice-branches
 * daarom de bron van waarheid (#633).
 */
export declare function prStaatVan(branch: string, cwd: string): string | undefined;
