import { existsSync } from 'node:fs';
import path from 'node:path';
import { GebruikersFout, git, kop, ok, uitvoerVan, waarschuwing } from '../shell.js';
/**
 * Een eigen werkmap per slice, zodat twee sessies elkaar niet in de weg zitten (#118).
 *
 * De botsing tussen parallelle sessies zit niet in branches maar in de gedeelde
 * werkmap: één `.git`, één HEAD, één `git status`. Een worktree geeft elke sessie zijn
 * eigen map achter dezelfde `.git`, en dan verdwijnt de hele "werkt er al iemand
 * hier?"-vraag. Op 2026-08-19 ging dat twee keer mis in één dag — een wijziging die
 * werd teruggedraaid, en andermans werk dat in een vreemde staging opdook.
 */
/** Waar de worktree voor een issue komt te staan: náást de repo, nooit erin. */
export function werkplekPad(repoWortel, issue) {
    // Erin zou betekenen dat de hoofdmap hem in `git status` ziet — precies het
    // gedeelde-werkmap-probleem dat we wegnemen. De repo-naam zit in het pad zodat
    // meerdere repos naast elkaar passen.
    const naam = path.basename(repoWortel);
    return path.join(path.dirname(repoWortel), `${naam}-wt`, String(issue));
}
/**
 * De hoofdwerkmap van de repo, ook als je al ín een worktree staat.
 *
 * Zonder dit stapelt het zich op: draai je `werkplek` vanuit `factory-wt/128`, dan
 * wordt de nieuwe map `factory-wt/128-wt/999`. `--git-common-dir` wijst altijd naar de
 * `.git` van de hoofdkloon, in een worktree én daarbuiten.
 */
export function repoWortelVan(cwd) {
    const gitDir = uitvoerVan('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
    return gitDir === undefined || gitDir === '' ? cwd : path.dirname(gitDir);
}
/** De branch die bij een issue hoort; `-1` blijft staan zodat #128 de koppeling herkent. */
export function branchVan(issue) {
    return `slice/${String(issue)}-1`;
}
/** Of de branch lokaal al bestaat. `worktree remove` laat hem namelijk staan. */
function branchBestaat(repoDir, branch) {
    // `rev-parse --verify` print de sha; lege uitvoer betekent dat de branch er niet is.
    const sha = uitvoerVan('git', ['rev-parse', '-q', '--verify', `refs/heads/${branch}`], repoDir);
    return sha !== undefined && sha !== '';
}
/** Het pad van de worktree waar deze branch al is uitgecheckt, of undefined. */
function elders(repoDir, branch) {
    const lijst = uitvoerVan('git', ['worktree', 'list', '--porcelain'], repoDir) ?? '';
    let huidigPad;
    for (const regel of lijst.split('\n')) {
        if (regel.startsWith('worktree ')) {
            huidigPad = regel.slice('worktree '.length).trim();
        }
        else if (regel.trim() === `branch refs/heads/${branch}`) {
            return huidigPad;
        }
    }
    return undefined;
}
/**
 * Maakt (of hervindt) de werkplek voor een issue en print het pad. Idempotent: een
 * hervatte sessie krijgt dezelfde map terug in plaats van een fout.
 */
export function werkplek(issueArgument, opties = {}) {
    const issue = Number.parseInt(issueArgument ?? '', 10);
    if (!Number.isSafeInteger(issue) || issue <= 0) {
        throw new GebruikersFout('Gebruik: factory werkplek <issuenummer> [--op]');
    }
    const repoDir = process.cwd();
    const pad = werkplekPad(repoWortelVan(repoDir), issue);
    const branch = branchVan(issue);
    if (opties.op === true) {
        ruimOp(repoDir, pad);
        return;
    }
    if (existsSync(pad)) {
        ok(`werkplek bestaat al: ${pad}`);
        process.stdout.write(`${pad}\n`);
        return;
    }
    const bestaand = elders(repoDir, branch);
    if (bestaand !== undefined) {
        throw new GebruikersFout(`${branch} is al uitgecheckt in ${bestaand}. Werk daar verder, of ruim die werkplek eerst op.`);
    }
    kop(`Werkplek voor #${String(issue)}`);
    // Vers ophalen: een worktree van een verouderde main levert een branch die pas bij
    // het inleveren conflicteert, en dat is het duurste moment om erachter te komen.
    git(['fetch', '-q', 'origin'], repoDir);
    // `worktree remove` haalt de map weg maar laat de branch staan. Bij een tweede
    // `werkplek` op hetzelfde issue bestaat de branch dus al, en dan is `-b` een harde
    // git-fout ("a branch named … already exists"). Hervat 'm in plaats daarvan: er kan
    // werk in zitten dat je juist terug wilt.
    if (branchBestaat(repoDir, branch)) {
        git(['worktree', 'add', '-q', pad, branch], repoDir);
        ok(`${pad} op bestaande branch ${branch}`);
    }
    else {
        git(['worktree', 'add', '-q', '-b', branch, pad, 'origin/main'], repoDir);
        ok(`${pad} op ${branch} (van origin/main)`);
    }
    process.stdout.write(`${pad}\n`);
}
/** Haalt de werkplek weg; laat hem staan als er nog ongecommit werk in zit. */
function ruimOp(repoDir, pad) {
    if (!existsSync(pad)) {
        ok(`werkplek ${pad} bestaat niet (meer)`);
        return;
    }
    // Zonder --force weigert git bij vuil werk, en dat is precies wat we willen: liever
    // een map te veel dan werk kwijt.
    const uitkomst = git(['worktree', 'remove', pad], repoDir, {
        capture: true,
        toleranter: true,
    });
    if (uitkomst.code !== 0) {
        // Geef de reden van git door in plaats van er één te verzinnen: vuil werk is de
        // meest voorkomende oorzaak, maar niet de enige (je kunt bijvoorbeeld niet de
        // worktree verwijderen waar je zelf in staat).
        const reden = uitkomst.stderr.trim();
        waarschuwing(`werkplek ${pad} blijft staan${reden === '' ? '' : ` — ${reden}`}\n` +
            `  Ruim hem zelf op met: git worktree remove --force ${pad}`);
        return;
    }
    ok(`werkplek ${pad} opgeruimd`);
}
//# sourceMappingURL=werkplek.js.map