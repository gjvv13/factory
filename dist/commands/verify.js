import { readFileSync } from 'node:fs';
import path from 'node:path';
import { draaiScript, kop, ok, waarschuwing, GebruikersFout } from '../shell.js';
/**
 * De vaste volgorde van de kwaliteitspoort. Een stap die de repo niet heeft
 * wordt overgeslagen, zodat dezelfde poort werkt in de factory (die geen
 * e2e-tests heeft) en in een applicatie (die ze wel heeft).
 */
const STAPPEN = [
    { script: 'format:check', titel: 'Opmaak (prettier)', snel: true, preCommit: true },
    { script: 'lint', titel: 'Statische analyse (eslint)', snel: true, preCommit: true },
    { script: 'typecheck', titel: 'Types (tsc)', snel: true, preCommit: true },
    { script: 'test:unit', titel: 'Unit tests', snel: true, preCommit: true },
    { script: 'test:contract', titel: 'Contract tests', snel: true, preCommit: false },
    { script: 'test:e2e', titel: 'End-to-end tests', snel: false, preCommit: false },
    { script: 'build', titel: 'Build', snel: true, preCommit: false },
];
function beschikbareScripts(repoDir) {
    const bestand = path.join(repoDir, 'package.json');
    let inhoud;
    try {
        inhoud = JSON.parse(readFileSync(bestand, 'utf8'));
    }
    catch {
        throw new GebruikersFout(`Kon ${bestand} niet lezen. Draait dit in een repo?`);
    }
    const scripts = typeof inhoud === 'object' && inhoud !== null && 'scripts' in inhoud
        ? inhoud.scripts
        : undefined;
    return new Set(Object.keys(scripts ?? {}));
}
export function verify(opties = {}) {
    const repoDir = process.cwd();
    const aanwezig = beschikbareScripts(repoDir);
    const start = Date.now();
    if (opties.preCommit === true) {
        kop('pre-commit: opmaak, lint, types, unit tests');
    }
    let gedraaid = 0;
    const overgeslagen = [];
    for (const stap of STAPPEN) {
        if (!aanwezig.has(stap.script)) {
            continue;
        }
        if (opties.preCommit === true && !stap.preCommit) {
            continue;
        }
        if (opties.snel === true && !stap.snel) {
            overgeslagen.push(stap.titel);
            continue;
        }
        if (opties.preCommit !== true) {
            kop(stap.titel);
        }
        draaiScript(stap.script, repoDir);
        gedraaid += 1;
    }
    if (gedraaid === 0) {
        throw new GebruikersFout('Geen enkele poortstap gevonden in package.json (verwacht bijvoorbeeld lint of test:unit).');
    }
    for (const titel of overgeslagen) {
        waarschuwing(`${titel} overgeslagen (--snel)`);
    }
    const seconden = Math.round((Date.now() - start) / 1000);
    process.stdout.write('\n');
    ok(`Alles groen in ${String(seconden)}s`);
}
//# sourceMappingURL=verify.js.map