import { kop, ok, run, uitvoerVan, waarschuwing } from '../shell.js';
/** Parse de porcelain-uitvoer van `git worktree list` naar gestructureerde entries. */
export function parseWorktreeList(porcelain) {
    const entries = [];
    let pad;
    let branch;
    for (const regel of porcelain.split('\n')) {
        const trimmed = regel.trim();
        if (trimmed.startsWith('worktree ')) {
            pad = trimmed.slice('worktree '.length);
            branch = undefined;
        }
        else if (trimmed.startsWith('branch refs/heads/')) {
            branch = trimmed.slice('branch refs/heads/'.length);
        }
        else if (trimmed === '' && pad !== undefined) {
            entries.push({ pad, branch });
            pad = undefined;
            branch = undefined;
        }
    }
    // Laatste entry zonder afsluitende lege regel.
    if (pad !== undefined) {
        entries.push({ pad, branch });
    }
    return entries;
}
/** Parse het JSON-antwoord van `gh pr list --json` voor release-PR's. */
export function parseReleasePrList(json) {
    const items = JSON.parse(json);
    if (!Array.isArray(items))
        return [];
    return items.filter((item) => typeof item === 'object' &&
        item !== null &&
        'number' in item &&
        'headRefName' in item &&
        typeof item.headRefName === 'string' &&
        typeof item.number === 'number');
}
/** Vergelijk twee semver-achtige versies. Geeft <0, 0, of >0. */
export function vergelijkVersies(a, b) {
    const parse = (v) => v
        .replace(/^v/, '')
        .split('.')
        .map((s) => {
        const n = Number.parseInt(s, 10);
        return Number.isNaN(n) ? 0 : n;
    });
    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0)
            return diff;
    }
    return 0;
}
// ---------------------------------------------------------------------------
// Issue-nummer uit een slice-branch
// ---------------------------------------------------------------------------
/** Haalt het issue-nummer uit een `slice/<issue>-<n>`-branch, of undefined. */
function issueUitBranch(branch) {
    const match = /^slice\/(\d+)-\d+$/.exec(branch);
    if (match?.[1] === undefined)
        return undefined;
    const nummer = Number.parseInt(match[1], 10);
    return Number.isSafeInteger(nummer) && nummer > 0 ? nummer : undefined;
}
// ---------------------------------------------------------------------------
// Hoofdfunctie
// ---------------------------------------------------------------------------
/**
 * Ruimt gemergede branches op: lokaal en op de remote. Wat niet in `origin/main`
 * zit blijft staan — dat is de enige harde regel. `main` en de huidige branch
 * worden nooit aangeraakt, en een branch die in een worktree is uitgecheckt wordt
 * overgeslagen met een leesbare melding in plaats van een kale git-fout.
 *
 * Uitgebreid (#421): ruimt ook stale worktrees op (issue dicht, schoon, nul
 * commits boven main) en handelt achterhaalde release-PR's af.
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
    // --- Worktrees categoriseren (#421).
    const worktreeResultaten = categoriseerWorktrees(cwd, dry);
    // --- Release-PR's afhandelen (#421).
    const releaseResultaten = afhandelenReleasePrs(cwd, dry);
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
    // Worktree-rapportage.
    for (const r of worktreeResultaten) {
        const label = r.branch ?? '?';
        if (r.actie === 'verwijderd') {
            ok(dry
                ? `worktree ${r.pad} (${label}) → wordt verwijderd`
                : `worktree ${r.pad} (${label}) verwijderd`);
        }
        else {
            waarschuwing(`worktree ${r.pad} (${label}) overgeslagen — ${r.reden ?? 'onbekende reden'}`);
        }
    }
    // Release-PR-rapportage.
    for (const r of releaseResultaten) {
        if (r.actie === 'gesloten') {
            ok(dry
                ? `release-PR #${String(r.nummer)} (${r.branch}) → wordt gesloten`
                : `release-PR #${String(r.nummer)} (${r.branch}) gesloten`);
        }
        else if (r.actie === 'gerebased') {
            ok(dry
                ? `release-PR #${String(r.nummer)} (${r.branch}) → wordt gerebased`
                : `release-PR #${String(r.nummer)} (${r.branch}) gerebased`);
        }
        else {
            waarschuwing(`release-PR #${String(r.nummer)} (${r.branch}) overgeslagen — ${r.reden ?? 'onbekende reden'}`);
        }
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
    const ietsGedaan = lokaalVerwijderen.length > 0 ||
        remoteVerwijderen.length > 0 ||
        gepruned > 0 ||
        worktreeResultaten.some((r) => r.actie === 'verwijderd') ||
        releaseResultaten.some((r) => r.actie !== 'overgeslagen');
    if (!ietsGedaan) {
        ok('Alles is al schoon.');
    }
}
/**
 * Categoriseert en ruimt stale worktrees op.
 *
 * Een worktree wordt verwijderd als:
 * - Het een slice-branch is met een issue-nummer
 * - Het issue is gesloten
 * - Git status is schoon (geen uncommitted wijzigingen)
 * - Er zijn 0 commits boven origin/main (niets niet-gepushts)
 *
 * Alles wat daar niet aan voldoet wordt overgeslagen met een melding.
 */
function categoriseerWorktrees(cwd, dry) {
    const porcelain = uitvoerVan('git', ['worktree', 'list', '--porcelain'], cwd) ?? '';
    const entries = parseWorktreeList(porcelain);
    // De hoofd-worktree (cwd zelf) overslaan — die is altijd de repo zelf.
    const hoofdWorktree = uitvoerVan('git', ['rev-parse', '--show-toplevel'], cwd)?.replace(/\/$/, '') ?? cwd;
    const resultaten = [];
    for (const entry of entries) {
        // Hoofd-worktree niet aanraken.
        if (entry.pad === hoofdWorktree)
            continue;
        // Bare/detached worktrees (geen branch) overslaan.
        if (entry.branch === undefined)
            continue;
        const issueNr = issueUitBranch(entry.branch);
        if (issueNr === undefined) {
            // Geen slice-branch — buiten scope.
            continue;
        }
        // Is het issue nog open?
        const issueState = uitvoerVan('gh', [
            'issue',
            'view',
            String(issueNr),
            '--repo',
            'gjvv13/factory',
            '--json',
            'state',
            '-q',
            '.state',
        ], cwd);
        if (issueState === undefined || issueState.toUpperCase() !== 'CLOSED') {
            resultaten.push({
                pad: entry.pad,
                branch: entry.branch,
                actie: 'overgeslagen',
                reden: 'issue is nog open',
            });
            continue;
        }
        // Heeft de worktree uncommitted wijzigingen?
        const statusUitvoer = uitvoerVan('git', ['-C', entry.pad, 'status', '--porcelain'], cwd);
        if (statusUitvoer === undefined || statusUitvoer !== '') {
            resultaten.push({
                pad: entry.pad,
                branch: entry.branch,
                actie: 'overgeslagen',
                reden: 'ongecommitte wijzigingen of niet-gepushte commits',
            });
            continue;
        }
        // Heeft de worktree commits boven origin/main?
        const aheadCount = uitvoerVan('git', ['-C', entry.pad, 'rev-list', '--count', 'origin/main..HEAD'], cwd);
        if (aheadCount === undefined || aheadCount !== '0') {
            resultaten.push({
                pad: entry.pad,
                branch: entry.branch,
                actie: 'overgeslagen',
                reden: 'ongecommitte wijzigingen of niet-gepushte commits',
            });
            continue;
        }
        // Alles goed — verwijderen.
        if (!dry) {
            run('git', ['worktree', 'remove', entry.pad], { cwd });
        }
        resultaten.push({ pad: entry.pad, branch: entry.branch, actie: 'verwijderd' });
    }
    return resultaten;
}
/**
 * Handelt achterhaalde release-PR's af.
 *
 * - Een `release/v*`-PR met een versie lager dan de nieuwste tag → sluiten + branch
 *   verwijderen.
 * - Een `release/v*`-PR op de huidige tag-versie die conflicteert op alleen
 *   `package.json` → rebasen en force-pushen.
 * - Een release-PR met conflicten buiten `package.json` → overslaan met waarschuwing.
 */
function afhandelenReleasePrs(cwd, dry) {
    const prJson = uitvoerVan('gh', [
        'pr',
        'list',
        '--repo',
        'gjvv13/factory',
        '--state',
        'open',
        '--json',
        'number,headRefName,mergeable,title',
    ], cwd);
    if (prJson === undefined || prJson === '')
        return [];
    // Zoek de nieuwste tag.
    const laatsteTag = uitvoerVan('git', ['describe', '--tags', '--abbrev=0', 'origin/main'], cwd);
    if (laatsteTag === undefined || laatsteTag === '')
        return [];
    const prs = parseReleasePrList(prJson);
    const resultaten = [];
    for (const pr of prs) {
        const versieMatch = /^release\/v(.+)$/.exec(pr.headRefName);
        if (versieMatch?.[1] === undefined)
            continue;
        const prVersie = versieMatch[1];
        const tagVersie = laatsteTag.replace(/^v/, '');
        // Versie lager dan de nieuwste tag → sluiten.
        if (vergelijkVersies(prVersie, tagVersie) < 0) {
            if (!dry) {
                run('gh', ['pr', 'close', String(pr.number), '--repo', 'gjvv13/factory', '--delete-branch'], {
                    cwd,
                    capture: true,
                });
            }
            resultaten.push({ nummer: pr.number, branch: pr.headRefName, actie: 'gesloten' });
            continue;
        }
        // Versie gelijk aan de nieuwste tag → check merge-conflict.
        if (vergelijkVersies(prVersie, tagVersie) === 0) {
            if (pr.mergeable === 'MERGEABLE') {
                // Geen conflict, niets te doen.
                continue;
            }
            if (pr.mergeable === 'CONFLICTING') {
                // Check welke bestanden conflicteren.
                const conflictBestanden = bepaalConflictBestanden(pr.headRefName, cwd);
                if (conflictBestanden === undefined) {
                    resultaten.push({
                        nummer: pr.number,
                        branch: pr.headRefName,
                        actie: 'overgeslagen',
                        reden: 'conflict-bestanden niet te bepalen',
                    });
                    continue;
                }
                // Alleen package.json → rebasen.
                if (conflictBestanden.length === 1 && conflictBestanden[0] === 'package.json') {
                    if (!dry) {
                        const rebaseResult = rebaseReleaseBranch(pr.headRefName, cwd);
                        if (!rebaseResult) {
                            resultaten.push({
                                nummer: pr.number,
                                branch: pr.headRefName,
                                actie: 'overgeslagen',
                                reden: 'rebase mislukt',
                            });
                            continue;
                        }
                    }
                    resultaten.push({ nummer: pr.number, branch: pr.headRefName, actie: 'gerebased' });
                    continue;
                }
                // Conflicten buiten package.json → overslaan.
                resultaten.push({
                    nummer: pr.number,
                    branch: pr.headRefName,
                    actie: 'overgeslagen',
                    reden: 'conflicten buiten package.json',
                });
                continue;
            }
            // UNKNOWN of andere status → overslaan.
            continue;
        }
        // Versie hoger dan de tag — laat staan, dat is onverwacht maar niet ons probleem.
    }
    return resultaten;
}
/**
 * Bepaalt welke bestanden een merge-conflict zouden geven tussen een branch en
 * origin/main. Geeft undefined als het niet te bepalen is.
 */
function bepaalConflictBestanden(branch, cwd) {
    // Gebruik merge-tree om de conflicten te bepalen zonder de worktree te raken.
    const result = run('git', ['merge-tree', '--write-tree', '--no-messages', `origin/main`, branch], { cwd, capture: true, toleranter: true });
    // Exit code 1 = conflicten. Stdout bevat de tree hash op de eerste regel,
    // gevolgd door de conflicterende bestanden.
    if (result.code === 0)
        return []; // Geen conflicten.
    const regels = result.stdout.split('\n').filter(Boolean);
    // De eerste regel is de tree hash, daarna komt conflict-info.
    // Parse de conflicterende bestanden uit de uitvoer.
    const bestanden = [];
    for (const regel of regels) {
        // merge-tree toont conflicten als bestandsnamen na de tree hash.
        // Formaat: de eerste regel is de tree, daarna paden.
        if (!regel.match(/^[0-9a-f]{40,}$/)) {
            bestanden.push(regel.trim());
        }
    }
    return bestanden.length > 0 ? bestanden : undefined;
}
/**
 * Rebased een release-branch op origin/main en force-pusht. Geeft true bij succes.
 */
function rebaseReleaseBranch(branch, cwd) {
    // Checkout de branch, rebase op origin/main, force-push.
    const checkout = run('git', ['checkout', branch], { cwd, capture: true, toleranter: true });
    if (checkout.code !== 0)
        return false;
    const rebase = run('git', ['rebase', 'origin/main'], { cwd, capture: true, toleranter: true });
    if (rebase.code !== 0) {
        // Rebase mislukt — abort en terug naar de vorige branch.
        run('git', ['rebase', '--abort'], { cwd, capture: true, toleranter: true });
        run('git', ['checkout', '-'], { cwd, capture: true, toleranter: true });
        return false;
    }
    const push = run('git', ['push', '--force-with-lease'], { cwd, capture: true, toleranter: true });
    if (push.code !== 0) {
        run('git', ['checkout', '-'], { cwd, capture: true, toleranter: true });
        return false;
    }
    // Terug naar de originele branch.
    run('git', ['checkout', '-'], { cwd, capture: true, toleranter: true });
    return true;
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