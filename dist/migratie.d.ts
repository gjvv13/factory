/**
 * Of er tussen `sinds` en HEAD een nieuw migratiebestand is bijgekomen. Migraties
 * zijn append-only (drizzle schrijft een nieuw genummerd bestand onder `migrations/`),
 * dus we kijken alleen naar toegevoegde bestanden (`--diff-filter=A`).
 */
export declare function heeftNieuweMigratie(repoDir: string, sinds: string): boolean;
/** De versie uit een /health-JSON-body, of undefined als die er niet (geldig) in staat. */
export declare function versieUitHealth(body: string): string | undefined;
/**
 * Print `ja` als deze release t.o.v. de draaiende prod-versie een nieuwe migratie
 * bevat, anders `nee`. De deploy-workflow leest dit om te bepalen of prod via de
 * goedkeurings-poort moet.
 *
 * Het bereik loopt vanaf de tag die prod daadwerkelijk draait (opgehaald via
 * `/health`), niet vanaf de vorige release-tag. Zo kan een opgestapelde migratie
 * niet meeliftend op een migratie-loze release worden omzeild (#455).
 *
 * Terugval: als `/health` onbereikbaar is of `factory.json` ontbreekt (de
 * factory-repo zelf), wordt het bereik bepaald vanaf de vorige release-tag — het
 * gedrag van vóór deze fix. Een waarschuwing op stderr meldt de terugval.
 *
 * Bewust machine-leesbaar: alléén `ja`/`nee` op stdout, geen opmaak.
 */
export declare function toonMigratieStatus(repoDir?: string): Promise<void>;
