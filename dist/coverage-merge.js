import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
// istanbul-lib-coverage is CommonJS zonder benoemde ESM-exports: onder Node ESM komt
// alles via de default binnen (een `import * as` geeft daar undefined). De andere twee
// exporteren wél benoemd. Types apart, want verbatimModuleSyntax wist ze anders niet.
import libCoverage from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import { create as createReport } from 'istanbul-reports';
/**
 * De merge maakt van de per-soort-metingen één waarheid. Unit, contract en e2e meten
 * elk hun eigen laag (zie `configs/coverage.js` en `e2e-coverage.ts`); los onderschat
 * hun maximum de echte dekking. Door de istanbul-maps samen te voegen telt elk bestand
 * onder élke soort die het uitvoert, en komt er één gecombineerd cijfer uit dat
 * `dekkingsMinimum` tot een eerlijke gate maakt.
 */
/** De testsoorten waarvan de merge de istanbul-maps (`coverage-final.json`) samenvoegt. */
const SOORTEN = ['unit', 'contract', 'e2e'];
/**
 * Laadt de istanbul-map van een soort, of undefined als die soort niet gemeten is.
 * Een bestaand rapport wordt niet defensief weggeslikt: de poort heeft het net zelf
 * geschreven, dus een leesfout is een echt probleem dat zichtbaar hoort te worden
 * (dat ving een eerdere ESM/CJS-interopfout af die anders stil de merge oversloeg).
 */
function leesFinal(repoDir, soort) {
    const bestand = path.join(repoDir, 'coverage', soort, 'coverage-final.json');
    if (!existsSync(bestand)) {
        return undefined;
    }
    const data = JSON.parse(readFileSync(bestand, 'utf8'));
    return libCoverage.createCoverageMap(data);
}
/**
 * Voegt de per-soort istanbul-maps samen tot één rapport in `coverage/combined/`
 * (json-summary + html) en geeft de vier gecombineerde percentages terug. Istanbul telt
 * de regel-hits per bestand bij elkaar op, dus een regel die door unit én e2e geraakt
 * wordt telt als geraakt — niet dubbel. Is er geen enkele `coverage-final.json`, dan
 * undefined: verify valt dan terug op de losse cijfers.
 */
export function schrijfGecombineerdeDekking(repoDir) {
    const maps = SOORTEN.map((soort) => leesFinal(repoDir, soort)).filter((map) => map !== undefined);
    if (maps.length === 0) {
        return undefined;
    }
    const gecombineerd = libCoverage.createCoverageMap({});
    for (const map of maps) {
        gecombineerd.merge(map);
    }
    const context = createContext({
        dir: path.join(repoDir, 'coverage', 'combined'),
        coverageMap: gecombineerd,
    });
    createReport('json-summary').execute(context);
    createReport('html').execute(context);
    const samenvatting = gecombineerd.getCoverageSummary();
    return {
        lines: samenvatting.lines.pct,
        statements: samenvatting.statements.pct,
        functions: samenvatting.functions.pct,
        branches: samenvatting.branches.pct,
    };
}
//# sourceMappingURL=coverage-merge.js.map