import type { CoverageMap } from 'istanbul-lib-coverage';
/**
 * Parseert `git diff --unified=0`-uitvoer naar een map van relatief pad naar
 * gewijzigde (toegevoegde) regelnummers. Verwijderde bestanden (naar /dev/null)
 * worden overgeslagen — die bevatten geen toe te toetsen nieuwe regels.
 */
export declare function parseDiffRegels(diffUitvoer: string): Map<string, Set<number>>;
/** Het resultaat van de diff-dekkingsberekening. */
export interface DiffDekkingsResultaat {
    /** Percentage gedekte regels, of undefined bij een lege diff of nul meetbare regels. */
    readonly percentage: number | undefined;
    /** Totaal aantal meetbare gewijzigde regels. */
    readonly totaalRegels: number;
    /** Aantal gedekte gewijzigde regels. */
    readonly gedekteRegels: number;
    /** Per bestand (relatief pad) de ongedekte regelnummers, gesorteerd. */
    readonly ongedektPerBestand: Map<string, readonly number[]>;
}
/**
 * Kruist de diff met een istanbul CoverageMap en berekent welk percentage van de
 * gewijzigde regels gedekt is.
 *
 * - Niet-uitvoerbare regels (wel in de diff, maar niet in de coverage-map van een
 *   wél gemeten bestand) worden uitgesloten van de telling.
 * - Bestanden in de diff maar niet in de coverage-map tellen als volledig ongedekt.
 * - Een lege diff (geen gewijzigde bestanden) geeft `undefined` percentage.
 */
export declare function berekenDiffDekking(gewijzigdeRegels: Map<string, Set<number>>, coverageMap: CoverageMap, repoDir: string): DiffDekkingsResultaat;
