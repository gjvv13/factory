import { kop, ok, run, uitvoerVan, waarschuwing } from '../shell.js';
/**
 * Ruimt gemergede branches op: lokaal en op de remote. Wat niet in `origin/main`
 * zit blijft staan — dat is de enige harde regel. `main` en de huidige branch
 * worden nooit aangeraakt, en een branch die in een worktree is uitgecheckt wordt
 * overgeslagen met een leesbare melding in plaats van een kale git-fout.
 */
export function opruimen(opties = {}) {
    const dry = opties.dry === true;
    const cwd = process.cwd();
    // --- Eerst prunen, dan pas oordelen: zonder een verse `origin/main` vergelijk
    //     je tegen een verouderde stand en trek je de verkeerde conclusie (#126).
    kop('Ophalen en prunen');
    const fetchResultaat = run('git', ['fetch', '--prune'], { cwd, capture: true });
    const gepruned = fetchResultaat.stderr.split('\n').filter((r) => r.includes('[deleted]')).length;
    // --- Context: huidige branch en branches in een worktree.
    const huidig = uitvoerVan('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd) ?? 'HEAD';
    const inWorktree = worktreeBranches(cwd);
    // --- Lokale branches categoriseren.
    const lokaal = (uitvoerVan('git', ['branch', '--format=%(refname:short)'], cwd) ?? '')
        .split('\n')
        .filter(Boolean);
    const lokaalVerwijderen = [];
    const lokaalBlijven = [];
    const lokaalWorktree = [];
    for (const branch of lokaal) {
        if (branch === 'main' || branch === huidig)
            continue;
        if (inWorktree.has(branch)) {
            lokaalWorktree.push(branch);
            continue;
        }
        if (isGemerged(branch, cwd)) {
            lokaalVerwijderen.push(branch);
        }
        else {
            lokaalBlijven.push(branch);
        }
    }
    // --- Remote branches categoriseren.
    const remote = (uitvoerVan('git', ['branch', '-r', '--format=%(refname:short)'], cwd) ?? '')
        .split('\n')
        .filter(Boolean)
        .filter((r) => r.startsWith('origin/') && r !== 'origin/main' && r !== 'origin/HEAD')
        .map((r) => r.slice('origin/'.length));
    const remoteVerwijderen = [];
    const remoteBlijven = [];
    for (const branch of remote) {
        if (isGemerged(`origin/${branch}`, cwd)) {
            remoteVerwijderen.push(branch);
        }
        else {
            remoteBlijven.push(branch);
        }
    }
    // --- Rapportage.
    kop(dry ? 'Wat er zou gebeuren' : 'Opruimen');
    if (gepruned > 0) {
        ok(`${String(gepruned)} remote-refs verlopen (geprund)`);
    }
    if (lokaalVerwijderen.length > 0) {
        const actie = dry ? 'worden verwijderd' : 'verwijderd';
        ok(`${String(lokaalVerwijderen.length)} lokale branches gemerged in origin/main → ${actie}`);
    }
    if (remoteVerwijderen.length > 0) {
        const actie = dry ? 'worden verwijderd' : 'verwijderd';
        ok(`${String(remoteVerwijderen.length)} remote-branches gemerged → ${actie}`);
    }
    const blijven = [...lokaalBlijven, ...remoteBlijven.map((r) => `origin/${r}`)];
    if (blijven.length > 0) {
        waarschuwing(`${String(blijven.length)} blijven staan: ${blijven.join(', ')}\n  (niet gemerged)`);
    }
    for (const branch of lokaalWorktree) {
        waarschuwing(`${branch} overgeslagen — in gebruik in een worktree`);
    }
    // --- Uitvoeren (in dry-mode hierboven al gerapporteerd).
    if (dry) {
        process.stdout.write('Niets gewijzigd (--dry).\n');
        return;
    }
    for (const branch of lokaalVerwijderen) {
        run('git', ['branch', '-d', branch], { cwd });
    }
    for (const branch of remoteVerwijderen) {
        run('git', ['push', 'origin', '--delete', branch], { cwd });
    }
    if (lokaalVerwijderen.length === 0 && remoteVerwijderen.length === 0 && gepruned === 0) {
        ok('Alles is al schoon.');
    }
}
/** Of een ref volledig in origin/main zit: alle commits zijn al gemerged. */
function isGemerged(ref, cwd) {
    return (run('git', ['merge-base', '--is-ancestor', ref, 'origin/main'], {
        cwd,
        capture: true,
        toleranter: true,
    }).code === 0);
}
/** Alle branches die op dit moment in een worktree zijn uitgecheckt. */
function worktreeBranches(cwd) {
    const lijst = uitvoerVan('git', ['worktree', 'list', '--porcelain'], cwd) ?? '';
    const branches = new Set();
    for (const regel of lijst.split('\n')) {
        const match = /^branch refs\/heads\/(.+)$/.exec(regel.trim());
        if (match?.[1] !== undefined) {
            branches.add(match[1]);
        }
    }
    return branches;
}
//# sourceMappingURL=opruimen.js.map