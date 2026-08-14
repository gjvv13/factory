/**
 * Of er tussen `sinds` en HEAD een nieuw migratiebestand is bijgekomen. Migraties
 * zijn append-only (drizzle schrijft een nieuw genummerd bestand onder `migrations/`),
 * dus we kijken alleen naar toegevoegde bestanden (`--diff-filter=A`).
 */
export declare function heeftNieuweMigratie(repoDir: string, sinds: string): boolean;
/**
 * Print `ja` als deze release t.o.v. de vorige release-tag een nieuwe migratie bevat,
 * anders `nee`. De deploy-workflow leest dit om te bepalen of prod via de
 * goedkeurings-poort moet. Bewust machine-leesbaar: alléén `ja`/`nee` op stdout, geen
 * opmaak, zodat een shell-substitutie het direct kan gebruiken.
 */
export declare function toonMigratieStatus(repoDir?: string): void;
