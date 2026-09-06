import path from 'node:path';
/**
 * Parseert `git diff --unified=0`-uitvoer naar een map van relatief pad naar
 * gewijzigde (toegevoegde) regelnummers. Verwijderde bestanden (naar /dev/null)
 * worden overgeslagen — die bevatten geen toe te toetsen nieuwe regels.
 */
export function parseDiffRegels(diffUitvoer) {
    const resultaat = new Map();
    let huidigBestand;
    let isVerwijderd = false;
    for (const regel of diffUitvoer.split('\n')) {
        if (regel.startsWith('+++ ')) {
            const pad = regel.slice(4);
            if (pad === '/dev/null') {
                // Pure verwijdering: geen nieuwe regels om te meten.
                isVerwijderd = true;
                huidigBestand = undefined;
            }
            else {
                isVerwijderd = false;
                // Strip de `b/`-prefix die git diff meelevert.
                huidigBestand = pad.startsWith('b/') ? pad.slice(2) : pad;
            }
            continue;
        }
        if (regel.startsWith('@@') && huidigBestand !== undefined && !isVerwijderd) {
            // Hunk-header: `@@ -oud[,n] +nieuw[,n] @@`
            const match = /@@ [^ ]+ \+(\d+)(?:,(\d+))? @@/.exec(regel);
            if (match) {
                const start = Number(match[1]);
                const count = match[2] !== undefined ? Number(match[2]) : 1;
                if (count > 0) {
                    let regels = resultaat.get(huidigBestand);
                    if (regels === undefined) {
                        regels = new Set();
                        resultaat.set(huidigBestand, regels);
                    }
                    for (let i = start; i < start + count; i++) {
                        regels.add(i);
                    }
                }
            }
        }
    }
    return resultaat;
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
export function berekenDiffDekking(gewijzigdeRegels, coverageMap, repoDir) {
    if (gewijzigdeRegels.size === 0) {
        return {
            percentage: undefined,
            totaalRegels: 0,
            gedekteRegels: 0,
            ongedektPerBestand: new Map(),
        };
    }
    let totaalRegels = 0;
    let gedekteRegels = 0;
    const ongedektPerBestand = new Map();
    const coverageBestanden = new Set(coverageMap.files());
    for (const [relatief, regels] of gewijzigdeRegels) {
        const absoluut = path.resolve(repoDir, relatief);
        if (!coverageBestanden.has(absoluut)) {
            // Bestand niet in de coverage-map: alle gewijzigde regels tellen als ongedekt.
            const gesorteerd = [...regels].sort((a, b) => a - b);
            totaalRegels += gesorteerd.length;
            ongedektPerBestand.set(relatief, gesorteerd);
            continue;
        }
        const fileCoverage = coverageMap.fileCoverageFor(absoluut);
        const lineCoverage = fileCoverage.getLineCoverage();
        const ongedekt = [];
        for (const regel of regels) {
            const hits = lineCoverage[regel];
            if (hits === undefined) {
                // Niet-uitvoerbare regel (bijv. een commentaar of type-declaratie): overslaan.
                continue;
            }
            totaalRegels++;
            if (hits > 0) {
                gedekteRegels++;
            }
            else {
                ongedekt.push(regel);
            }
        }
        if (ongedekt.length > 0) {
            ongedektPerBestand.set(relatief, ongedekt.sort((a, b) => a - b));
        }
    }
    const percentage = totaalRegels === 0 ? undefined : Math.round((gedekteRegels / totaalRegels) * 10000) / 100;
    return { percentage, totaalRegels, gedekteRegels, ongedektPerBestand };
}
//# sourceMappingURL=diff-dekking.js.map