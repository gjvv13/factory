import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BASISLIJN_BESTAND } from '../dekking-basislijn.js';
import { GebruikersFout, git, kop, ok, pakketbeheerder, run, runMetHerhaling, uitvoerVan, waarschuwing, } from '../shell.js';
import { verify } from './verify.js';
const SOORTEN = ['patch', 'minor', 'major'];
function leesVersie(repoDir) {
    const inhoud = JSON.parse(readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
    const versie = typeof inhoud === 'object' && inhoud !== null && 'version' in inhoud
        ? inhoud.version
        : undefined;
    if (typeof versie !== 'string' || versie === '') {
        throw new GebruikersFout('Kon de versie niet uit package.json lezen.');
    }
    return versie;
}
/**
 * Een release is een git-tag waarvan bewezen is dat de poort groen was.
 * Promoveren gebeurt altijd op zo'n tag, nooit op een branch.
 */
export function release(soortArgument) {
    const soort = (soortArgument ?? 'patch');
    if (!SOORTEN.includes(soort)) {
        throw new GebruikersFout(`Gebruik: factory release [${SOORTEN.join('|')}]`);
    }
    const repoDir = process.cwd();
    const branch = uitvoerVan('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoDir);
    if (branch !== 'main') {
        throw new GebruikersFout(`Releasen gaat alleen vanaf main (je staat op '${branch ?? '?'}').`);
    }
    const vies = uitvoerVan('git', ['status', '--porcelain'], repoDir);
    if (vies !== '') {
        git(['status', '--short'], repoDir);
        throw new GebruikersFout('Werkmap is niet schoon. Commit of stash je wijzigingen eerst.');
    }
    kop('Kwaliteitspoort voor de release');
    verify({ cwd: repoDir });
    kop(`Versie verhogen (${soort})`);
    const { commando, basisArgumenten } = pakketbeheerder();
    run(commando, [...basisArgumenten, 'version', soort, '--no-git-tag-version'], { cwd: repoDir });
    const versie = leesVersie(repoDir);
    const tag = `v${versie}`;
    if (uitvoerVan('git', ['tag', '--list', tag], repoDir) === tag) {
        throw new GebruikersFout(`Tag ${tag} bestaat al.`);
    }
    git(['add', 'package.json'], repoDir);
    // De volledige verify hierboven kan de dekkings-basislijn hebben verhoogd; neem die mee in
    // het release-commit zodat de tag de bijgewerkte lat bevat. Normaal is-ie al eerder gecommit.
    if (existsSync(path.join(repoDir, BASISLIJN_BESTAND))) {
        git(['add', BASISLIJN_BESTAND], repoDir);
    }
    git(['commit', '-q', '-m', `release: ${tag}`], repoDir);
    git(['tag', '-a', tag, '-m', `Release ${tag}`], repoDir);
    ok(`Release ${tag} aangemaakt`);
    if (uitvoerVan('git', ['remote', 'get-url', 'origin'], repoDir) !== undefined) {
        kop('Naar origin pushen');
        // Push gaat naar GitHub (ssh/https) en is daarmee gevoelig voor de tijdelijke
        // DNS-blip op de mini; herhaal alleen die klasse fout met backoff (zie #99).
        runMetHerhaling('git', ['push', '-q', 'origin', 'main'], { cwd: repoDir }, { wat: 'push van main naar origin' });
        runMetHerhaling('git', ['push', '-q', 'origin', tag], { cwd: repoDir }, { wat: `push van ${tag} naar origin` });
        ok(`main en ${tag} gepusht`);
    }
    else {
        waarschuwing("Geen remote 'origin'; alleen lokaal getagd.");
    }
    process.stdout.write(`\nPromoveren met:\n  factory promote acc ${tag}\n  factory promote prod ${tag}\n`);
}
//# sourceMappingURL=release.js.map