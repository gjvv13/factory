/** Of de app-versie gelijk is aan de factory, ervan afwijkt, of overbodig is. */
export type SyncStatus = 'gelijk' | 'afwijkend' | 'overbodig';
export interface SyncVerschil {
    /** Pad relatief aan de app-map, bv. `.claude/commands/bouw.md`. */
    readonly pad: string;
    readonly status: SyncStatus;
}
/**
 * Bepaalt per bestand of de app gelijk is aan de factory, ervan afwijkt of een
 * overbodig bestand heeft — zónder iets te schrijven. Paden in `negeer` (relatief
 * aan de app-map) tellen niet mee, zodat een bewuste afwijking geen valse drift is.
 */
export declare function syncVerschillen(appDir: string, negeer?: readonly string[]): SyncVerschil[];
/**
 * Zet de bestanden die de factory aanlevert maar die in de app-repo moeten staan
 * gelijk aan de versie uit het pakket: de slash commands, de skills, de git hook
 * en de CI-workflow. Deze kunnen niet uit node_modules komen omdat Claude Code,
 * git en GitHub Actions ze op een vaste plek in de repo verwachten.
 */
export declare function syncNaarApp(appDir: string): string[];
export interface SyncOpties {
    /** Alleen controleren en bij drift met een niet-nul exit eindigen; niets schrijven. */
    readonly check?: boolean;
}
export declare function sync(opties?: SyncOpties): void;
