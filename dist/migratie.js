import { zoekAppDir, leesAppConfig } from './app-config.js';
import { uitvoerVan } from './shell.js';
/**
 * Of er tussen `sinds` en HEAD een nieuw migratiebestand is bijgekomen. Migraties
 * zijn append-only (drizzle schrijft een nieuw genummerd bestand onder `migrations/`),
 * dus we kijken alleen naar toegevoegde bestanden (`--diff-filter=A`).
 */
export function heeftNieuweMigratie(repoDir, sinds) {
    const uit = uitvoerVan('git', ['diff', '--name-only', '--diff-filter=A', sinds, 'HEAD', '--', 'migrations'], repoDir);
    return uit !== undefined && uit.trim() !== '';
}
/** De versie uit een /health-JSON-body, of undefined als die er niet (geldig) in staat. */
export function versieUitHealth(body) {
    try {
        const data = JSON.parse(body);
        return typeof data.version === 'string' ? data.version : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Haalt de draaiende prod-versie op via `/health` op de prod-poort uit `factory.json`.
 * Geeft de versie-tag terug (met `v`-prefix), of undefined als het niet lukt.
 */
async function draaiendeProdTag(repoDir) {
    const appDir = zoekAppDir(repoDir);
    if (appDir === undefined)
        return undefined;
    let config;
    try {
        config = leesAppConfig(appDir);
    }
    catch {
        return undefined;
    }
    const poort = config.poorten.prod;
    const url = `http://127.0.0.1:${String(poort)}/health`;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok)
            return undefined;
        const body = await response.text();
        const versie = versieUitHealth(body);
        return versie !== undefined ? `v${versie}` : undefined;
    }
    catch {
        return undefined;
    }
}
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
export async function toonMigratieStatus(repoDir = process.cwd()) {
    const prodTag = await draaiendeProdTag(repoDir);
    let bereikStart;
    if (prodTag !== undefined) {
        bereikStart = prodTag;
    }
    else {
        // Terugval: vorige release-tag, net als vóór #455.
        const tags = (uitvoerVan('git', ['tag', '--sort=-v:refname'], repoDir) ?? '')
            .split('\n')
            .filter(Boolean);
        bereikStart = tags[1];
        // Waarschuw als er wél een factory.json is (dus een app, niet de factory zelf)
        // maar /health niet bereikbaar was.
        if (zoekAppDir(repoDir) !== undefined) {
            process.stderr.write('waarschuwing: kon de draaiende prod-versie niet ophalen via /health; terugval op vorige tag.\n');
        }
    }
    const nieuw = bereikStart !== undefined && heeftNieuweMigratie(repoDir, bereikStart);
    process.stdout.write(nieuw ? 'ja\n' : 'nee\n');
}
//# sourceMappingURL=migratie.js.map