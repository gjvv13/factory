import { existsSync } from 'node:fs';
import path from 'node:path';
import { leesAppConfig, zoekAppDir } from '../app-config.js';
import { BACKLOG_REPO, EIGENAAR, heeftLabel, issueUitBranch, plaatsComment, zetKolom, } from '../board.js';
import { draaiCodeReview, maakGateComment, } from '../code-review.js';
import { BASISLIJN_BESTAND } from '../dekking-basislijn.js';
import { GebruikersFout, git, installeer, kop, ok, pakketbeheerder, run, runMetHerhaling, uitvoerVan, waarschuwing, } from '../shell.js';
import { heeftIntegreerAgent, WACHTRIJ_LABEL, zorgVoorWachtrijLabel } from './integreer.js';
import { verify } from './verify.js';
import { repoWortelVan, ruimWerkplekOp, werkplekVanSessie } from './werkplek.js';
/**
 * Het label dat de fastlane-baan aandrijft (ADR 009, #401). Hergebruikt uit
 * `orkestreer-bouw.ts` maar gedupliceerd om een circulaire import te voorkomen:
 * `orkestreer-bouw` importeert `inleveren`, dus de omgekeerde richting mag niet.
 */
const FASTLANE_LABEL = 'fastlane';
/**
 * Label-gebaseerde auto-merge (#573): een PR merget alleen met dit label op het
 * issue én een schone code-review-gate. Geen label = mens-poort. Het label wordt
 * door een mens gezet (tijdens grooming), niet door een werker.
 */
export const AUTO_MERGE_OK_LABEL = 'auto-merge-ok';
/** Committeert een gewijzigd bestand met een korte melding; slaat over als het niet wijzigde. */
function commitAlsGewijzigd(repoDir, bestand, melding) {
    if (!existsSync(path.join(repoDir, bestand))) {
        return false;
    }
    if (uitvoerVan('git', ['status', '--porcelain', bestand], repoDir) === '') {
        return false;
    }
    git(['add', bestand], repoDir);
    git(['commit', '-q', '-m', melding], repoDir);
    return true;
}
/**
 * Parseert de JSON-uitvoer van `gh pr view --json url,state` tot url + state.
 * Een lege string (geen PR voor deze branch) geeft undefined.
 */
export function parsePrView(json) {
    if (json === '')
        return undefined;
    const parsed = JSON.parse(json);
    return { url: parsed.url, state: parsed.state };
}
/**
 * De bestaande PR voor deze branch, of undefined als er nog geen is.
 *
 * Geeft naast de URL ook de state terug, zodat de aanroeper onderscheid kan
 * maken tussen een open PR (hergebruiken) en een gemergede of gesloten PR (een
 * nieuwe openen). Zonder dat onderscheid meldt `inleveren` een gemergede PR als
 * geslaagde inlevering — het werk verdwijnt stil (#275).
 */
function bestaandePr(repoDir, branch) {
    const json = uitvoerVan('gh', ['pr', 'view', branch, '--json', 'url,state'], repoDir);
    if (json === undefined)
        return undefined;
    const result = parsePrView(json);
    if (result === undefined)
        return undefined;
    return { url: result.url, state: result.state };
}
/**
 * Levert de huidige slice-branch in: lockfile in lijn brengen, de poort draaien,
 * de branch pushen, een PR naar main openen en die in de merge-queue zetten. De
 * queue integreert branches daarna serieel en conflictvrij naar main, dus de sessie
 * kan meteen aan de volgende slice beginnen.
 */
export function inleveren(opties = {}) {
    const repoDir = opties.cwd ?? process.cwd();
    const branch = uitvoerVan('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoDir);
    if (branch === undefined || branch === 'main') {
        throw new GebruikersFout(`Inleveren doe je vanaf een slice-branch, niet vanaf '${branch ?? '?'}'.`);
    }
    // Een eerdere verify-run (bijv. van de bouw-werker) kan de dekkings-basislijn
    // hebben verhoogd zonder te committen; breng dat mee vóór de schoon-check.
    commitAlsGewijzigd(repoDir, BASISLIJN_BESTAND, 'verhoog dekking-basislijn');
    if (uitvoerVan('git', ['status', '--porcelain'], repoDir) !== '') {
        git(['status', '--short'], repoDir);
        throw new GebruikersFout('Werkmap is niet schoon. Commit je wijzigingen eerst.');
    }
    // Vóór de dure stappen: botst deze branch met de main van nu? Dan is rebasen
    // onvermijdelijk en moet verify daarna tóch opnieuw. Eerst een halfuur poort draaien
    // om dat daarna weg te gooien is precies de verspilling die we hier wegnemen.
    runMetHerhaling('git', ['fetch', '-q', 'origin', 'main'], { cwd: repoDir }, { wat: 'git fetch' });
    const botsing = conflictMetMain(repoDir);
    if (botsing !== undefined) {
        // Een conflict dat alleen in `dist/` zit is geen conflict: dat is gegenereerde
        // uitvoer, en `dist/` staat in versiebeheer zodat de CLI zonder buildstap draait.
        // Twee branches die beide `src/` raken botsen dáárom altijd in de sourcemaps, en bij
        // een reeks (#265) is elke merge tussen twee runs zo'n geval. Rebasen, opnieuw
        // bouwen, doorgaan — er valt niets met de hand te mergen (#282).
        if (alleenDist(botsing) && losDistConflictOp(repoDir)) {
            ok('conflict zat alleen in dist/ — opnieuw gebouwd en gerebased.');
        }
        else {
            throw new GebruikersFout(`main is verder gelopen en botst met ${branch} (${botsing.join(', ')}).\n` +
                '  Rebase erop, los het één keer op, en lever daarna opnieuw in:\n' +
                '    git rebase origin/main\n' +
                '    # los de conflicten op, dan: git add <bestand> && git rebase --continue\n' +
                lockfileHint(botsing) +
                '    factory inleveren\n' +
                '  De kwaliteitspoort draait dan opnieuw, over het samengevoegde resultaat.');
        }
    }
    // Lockfile in lijn met package.json brengen zodat de merge-queue er niet op
    // struikelt (`--frozen-lockfile`). `--lockfile-only`: alleen de lockfile, geen
    // volledige install van node_modules.
    kop('Lockfile bijwerken');
    installeer(['--lockfile-only'], { cwd: repoDir, capture: true });
    ok(commitAlsGewijzigd(repoDir, 'pnpm-lock.yaml', 'sync lockfile voor inleveren')
        ? 'lockfile bijgewerkt en gecommit'
        : 'lockfile al in lijn');
    kop('Kwaliteitspoort');
    verify({ cwd: repoDir });
    // De volledige verify kan de dekkings-basislijn hebben verhoogd; commit die mee,
    // zodat de branch schoon blijft en de verhoogde lat met de PR meereist.
    commitAlsGewijzigd(repoDir, BASISLIJN_BESTAND, 'verhoog dekking-basislijn');
    // Code-review gate (#368): draait na verify, vóór de push. De instelling komt uit
    // factory.json; zonder factory.json (de factory zelf) geldt `waarschuw`.
    let reviewVerdict;
    if (opties.geenReview !== true) {
        const appDir = zoekAppDir(repoDir);
        const reviewConfig = appDir === undefined ? undefined : leesAppConfig(appDir);
        const instelling = reviewConfig?.codeReview ?? 'waarschuw';
        reviewVerdict = draaiCodeReview(instelling, repoDir, opties.opsMelding);
        if (!reviewVerdict.doorgaan) {
            throw new GebruikersFout(`Code-review geblokkeerd: ${reviewVerdict.melding ?? 'bevindingen gevonden'}.\n` +
                '  Los de bevindingen op of lever in met --geen-review.');
        }
    }
    kop('Branch pushen');
    git(['push', '-q', '-u', 'origin', branch], repoDir);
    ok(`${branch} gepusht`);
    const appDir = zoekAppDir(repoDir);
    const config = appDir === undefined ? undefined : leesAppConfig(appDir);
    const lokaal = config?.integratie === 'lokaal';
    kop(lokaal ? 'PR openen en in de wachtrij zetten' : 'PR openen en in de merge-queue zetten');
    const reeksVermelding = opties.reeksInfo !== undefined
        ? `\n\n🔗 Reeks ${String(opties.reeksInfo.positie)}/${String(opties.reeksInfo.totaal)}` +
            ` — vertakt van #${String(opties.reeksInfo.basisIssue)} (${opties.reeksInfo.basisBranch})`
        : '';
    // Issue uit de branchnaam: voegt `Closes owner/repo#<N>` toe aan de PR-body zodat
    // GitHub het issue sluit bij merge — ook cross-repo (#598, #619). Bij een branch
    // zonder slice-vorm wordt niets toegevoegd — liever geen Closes dan een verkeerd
    // issue sluiten.
    const sliceIssue = issueUitBranch(branch);
    // Eén bron voor de afspraak "Closes owner/repo#<N> aan het eind van de body" (#598,
    // #619): `closesTekst` is de kale regel, `closesRegel` de variant met witregels voor
    // de opgebouwde body. Beide PR-paden gebruiken dezelfde tekst. De gekwalificeerde
    // vorm (`owner/repo#N`) is nodig zodat een merge in een app-repo het factory-issue
    // sluit; een kale `#N` werkt alleen binnen dezelfde repo.
    const closesTekst = sliceIssue !== undefined ? `Closes ${EIGENAAR}/${BACKLOG_REPO}#${String(sliceIssue)}` : '';
    const closesRegel = closesTekst !== '' ? `\n\n${closesTekst}` : '';
    const titelArgumenten = opties.titel === undefined
        ? closesTekst !== ''
            ? ['--fill', '--body', closesTekst]
            : ['--fill']
        : [
            '--title',
            opties.titel,
            '--body',
            `Ingeleverd via \`factory inleveren\`.${reeksVermelding}${closesRegel}`,
        ];
    // Een bestaande PR hergebruiken mag alleen als hij nog open is. Een gemergede of
    // gesloten PR is geen inlevering: het werk zit in geen enkele open PR en bereikt
    // main dus niet, terwijl de uitvoer zegt dat het gelukt is (#275).
    const bestaande = bestaandePr(repoDir, branch);
    let prUrl;
    if (bestaande !== undefined && bestaande.state === 'OPEN') {
        prUrl = bestaande.url;
    }
    else {
        if (bestaande !== undefined) {
            const toestand = bestaande.state === 'MERGED' ? 'gemerged' : 'gesloten';
            waarschuwing(`bestaande PR ${bestaande.url} is al ${toestand} — er wordt een nieuwe geopend.`);
        }
        prUrl = uitvoerVan('gh', ['pr', 'create', '--base', 'main', '--head', branch, ...titelArgumenten], repoDir);
        if (prUrl === undefined || prUrl === '') {
            const reden = bestaande !== undefined
                ? `De branch ${branch} heeft een ${bestaande.state === 'MERGED' ? 'gemergede' : 'gesloten'} PR (${bestaande.url}), ` +
                    'maar er is niets nieuws om in te leveren.'
                : 'Kon geen PR aanmaken of vinden met gh.';
            throw new GebruikersFout(reden);
        }
    }
    // Review-bevindingen als PR-comment posten, zodat ze ook bij `waarschuw` zichtbaar
    // blijven voor de ochtend-review (#368). Moet na de PR-creatie, want we hebben de URL nodig.
    if (reviewVerdict?.verdict !== undefined && reviewVerdict.verdict.bevindingen.length >= 0) {
        const comment = maakGateComment(reviewVerdict.verdict);
        run('gh', ['pr', 'comment', prUrl, '--body', comment], { cwd: repoDir, toleranter: true });
    }
    // Het item schuift zelf mee (#128). Vanaf hier wacht de slice op de merge — de
    // menselijke poort die bepaalt of het de main bereikt. Een branch zonder
    // slice-vorm hoort bij geen enkel backlog-item en verschuift daarom niets.
    if (sliceIssue !== undefined && zetKolom(sliceIssue, 'Wacht op merge', repoDir)) {
        plaatsComment(sliceIssue, `Ingeleverd via \`factory inleveren\`: ${prUrl}`, repoDir);
        ok(`#${String(sliceIssue)} staat op Wacht op merge`);
    }
    // Nu opzoeken, zolang de map er nog is: het opruimen hieronder maakt hem onvindbaar.
    const werkplek = werkplekVanSessie(repoDir);
    if (opties.geenAutomerge === true) {
        // Een onbemande bouw-werker mag code voorstellen, niet landen. Dus geen auto-merge
        // en op een app ook geen `wachtrij`-label — dat label ís de opdracht om te mergen.
        // De PR staat er, de poort draait erop, en het mergen blijft een mensbesluit.
        ok(`PR geopend zonder auto-merge: ${prUrl}`);
        process.stdout.write(`\n${branch} wacht op een menselijke merge; er is niets in een wachtrij gezet.\n`);
    }
    else if (opties.fastlane === true) {
        // Fastlane (#401): auto-merge aanzetten, ongeacht of het een lokale of GitHub-
        // merge-queue-app is. De fastlane is de bewuste afwijking van akkoord-voor-
        // inleveren: de poort is de enige gate, en de PR merget zichzelf op groen.
        //
        // Tweedelijns-beveiliging (#364): het issue moet het `fastlane`-label dragen.
        // Dat label kan alleen een mens zetten (ADR 009); zonder label is de fastlane
        // niet toegestaan, ook al liet de hook het commando door.
        if (sliceIssue !== undefined && !heeftLabel(sliceIssue, FASTLANE_LABEL, repoDir)) {
            throw new GebruikersFout(`--fastlane vereist het label '${FASTLANE_LABEL}' op #${String(sliceIssue)}.\n` +
                `  Zet het label eerst: gh issue edit ${String(sliceIssue)} --repo gjvv13/factory --add-label ${FASTLANE_LABEL}`);
        }
        if (lokaal) {
            zorgVoorWachtrijLabel(repoDir);
            run('gh', ['pr', 'edit', prUrl, '--add-label', WACHTRIJ_LABEL], { cwd: repoDir });
        }
        else {
            run('gh', ['pr', 'merge', prUrl, '--auto', '--merge'], { cwd: repoDir });
        }
        ok(`fastlane-PR met auto-merge: ${prUrl}`);
        process.stdout.write(`\n${branch} merget zichzelf zodra de poort groen is.\n`);
    }
    else {
        // Label-gebaseerde auto-merge (#573): de default is geen auto-merge. Auto-merge
        // gaat alleen aan als het issue `auto-merge-ok` draagt én de code-review-gate
        // schoon is (reden 'schoon' of 'geen-diff'). Zonder label, zonder schone gate,
        // of zonder slice-issue: mens-poort.
        const heeftAutoMerge = sliceIssue !== undefined && heeftLabel(sliceIssue, AUTO_MERGE_OK_LABEL, repoDir);
        const gateIsSchoon = reviewGateSchoon(reviewVerdict);
        if (heeftAutoMerge && gateIsSchoon) {
            if (config !== undefined && lokaal) {
                // `lokaal` impliceert `config !== undefined`, maar de expliciete guard
                // voorkomt een non-null-assertion die ESLint (terecht) weigert.
                zorgVoorWachtrijLabel(repoDir);
                run('gh', ['pr', 'edit', prUrl, '--add-label', WACHTRIJ_LABEL], { cwd: repoDir });
                ok(`in de wachtrij gezet (auto-merge-ok): ${prUrl}`);
                if (heeftIntegreerAgent(config.naam)) {
                    process.stdout.write(`\nDe factory-wachtrij integreert ${branch} serieel naar main. Je kunt doorbouwen.\n`);
                }
                else {
                    const doel = ghDoelVanUrl(prUrl) ?? config.naam;
                    waarschuwing(`geen integreer-agent voor ${config.naam} — deze PR blijft in de wachtrij staan.\n` +
                        `  Installeer 'm met \`factory integreer --installeer\` (in de app-map),\n` +
                        `  of werk de rij nu af met \`factory integreer --repo=${doel}\`.`);
                }
            }
            else {
                run('gh', ['pr', 'merge', prUrl, '--auto', '--merge'], { cwd: repoDir });
                ok(`auto-merge (auto-merge-ok): ${prUrl}`);
                process.stdout.write(`\nDe merge-queue integreert ${branch} serieel naar main. Je kunt doorbouwen.\n`);
            }
        }
        else {
            // Geen auto-merge: het label ontbreekt, of de gate is niet schoon.
            if (heeftAutoMerge && !gateIsSchoon) {
                const reden = reviewVerdict?.reden ?? 'geen review';
                waarschuwing(`auto-merge-ok aanwezig maar gate niet schoon (${reden}) — menselijke merge vereist.`);
                run('gh', [
                    'pr',
                    'comment',
                    prUrl,
                    '--body',
                    `⚠️ \`auto-merge-ok\` aanwezig maar code-review-gate niet schoon (${reden}) — menselijke merge vereist.`,
                ], { cwd: repoDir, toleranter: true });
            }
            ok(`PR geopend zonder auto-merge: ${prUrl}`);
            process.stdout.write(`\n${branch} wacht op een menselijke merge; er is niets in een wachtrij gezet.\n`);
        }
    }
    // Allerlaatste stap (#118): het werk zit in de PR, dus de werkmap heeft zijn dienst
    // gedaan. Blijft hij staan, dan stapelen de werkplekken zich op en weet niemand meer
    // welke nog leeft. Hierna bestaat `repoDir` niet meer, dus er mag niets meer volgen.
    if (werkplek !== undefined) {
        const wortel = repoWortelVan(repoDir);
        if (ruimWerkplekOp(wortel, werkplek)) {
            // Zeg het expliciet: de gebruiker staat nu in een map die er niet meer is, en
            // dat is verwarrend tot je het leest. Terugkomen kan altijd met `factory werkplek`.
            process.stdout.write(`Je stond in ${werkplek}; ga verder in ${wortel}.\n`);
        }
    }
    return reviewVerdict?.reden !== undefined ? { reviewReden: reviewVerdict.reden } : {};
}
/**
 * Of de code-review-gate schoon is: de review is gelopen en er zijn geen bevindingen.
 * Alleen `'schoon'` en `'geen-diff'` tellen als schoon; `'uit'`, `'niet-beschikbaar'`,
 * `'geen-verdict'` en `'bevindingen'` niet (#573, besluit 6).
 */
function reviewGateSchoon(verdict) {
    return verdict?.reden === 'schoon' || verdict?.reden === 'geen-diff';
}
/**
 * De bestanden waarop deze branch botst met `origin/main`, of undefined als het schoon
 * samengaat.
 *
 * `merge-tree --write-tree` doet de merge in het geheugen: geen checkout, geen
 * halfafgemaakte rebase in de werkmap. Het is een merge en geen rebase, dus strikt
 * genomen een benadering — maar botst de merge, dan botst de rebase ook, en dat is
 * precies wat we op tijd willen weten.
 */
function conflictMetMain(repoDir) {
    const uitkomst = git(['merge-tree', '--write-tree', '--name-only', 'origin/main', 'HEAD'], repoDir, {
        capture: true,
        toleranter: true,
    });
    // Exitcode 1 betekent zowel "conflict" als "kon die refs niet mergen". Het verschil
    // zit in stdout: bij een conflict staat daar de tree-oid met de botsende bestanden,
    // bij een fout is stdout leeg en staat de reden op stderr. Zonder dit onderscheid
    // zou een repo zonder `origin/main` elk inleveren blokkeren met een verzonnen conflict.
    if (uitkomst.code === 0 || uitkomst.stdout.trim() === '') {
        return undefined;
    }
    // Eerste regel is de tree-oid, daarna de bestanden tot de lege regel voor de meldingen.
    // Ontbreekt die lege regel, dan lopen de bestanden tot het eind — `indexOf` geeft dan
    // -1, en `slice(0, -1)` zou stilletjes het láátste botsende bestand weglaten.
    const regels = uitkomst.stdout.split('\n').slice(1);
    const einde = regels.indexOf('');
    const bestanden = (einde === -1 ? regels : regels.slice(0, einde)).filter((regel) => regel !== '');
    return bestanden.length === 0 ? ['onbekend welk bestand'] : bestanden;
}
/** Of elk botsend bestand gegenereerde uitvoer is (`dist/`), en dus door een build op te lossen. */
function alleenDist(bestanden) {
    return bestanden.length > 0 && bestanden.every((bestand) => bestand.startsWith('dist/'));
}
/**
 * Rebaset op `origin/main` en lost een puur-`dist/`-conflict op door opnieuw te bouwen.
 *
 * De `merge-tree`-preview zei dat alleen `dist/` botst, maar de echte rebase is de
 * waarheid: pas ná `git rebase` weten we welke bestanden werkelijk conflicteren. Zit er
 * dan tóch iets buiten `dist/` bij, dan draaien we de rebase terug en laten we het aan de
 * mens — een build overschrijft `src/` niet en zou een echt conflict verbergen.
 *
 * Geeft `false` als er niet schoon op te lossen viel; de aanroeper valt dan terug op de
 * melding-met-de-hand.
 */
function losDistConflictOp(repoDir) {
    const rebase = git(['rebase', 'origin/main'], repoDir, { capture: true, toleranter: true });
    if (rebase.code === 0) {
        // Geen conflict na alles: de preview was te voorzichtig (bijv. een merge die wél
        // samengaat). Niets meer te doen.
        return true;
    }
    const conflicten = git(['diff', '--name-only', '--diff-filter=U'], repoDir, { capture: true })
        .stdout.split('\n')
        .filter((regel) => regel !== '');
    if (!alleenDist(conflicten)) {
        git(['rebase', '--abort'], repoDir, { toleranter: true });
        return false;
    }
    // `dist/` is gegenereerd uit `src/`; opnieuw bouwen levert het conflictvrij op.
    const { commando, basisArgumenten } = pakketbeheerder();
    run(commando, [...basisArgumenten, 'run', 'build'], { cwd: repoDir, capture: true });
    git(['add', 'dist'], repoDir);
    // GIT_EDITOR leeg: `rebase --continue` mag geen editor openen in een pijplijn.
    const verder = run('git', ['rebase', '--continue'], {
        cwd: repoDir,
        capture: true,
        toleranter: true,
        env: { ...process.env, GIT_EDITOR: 'true' },
    });
    if (verder.code !== 0) {
        git(['rebase', '--abort'], repoDir, { toleranter: true });
        return false;
    }
    return true;
}
/**
 * Een extra regel voor de lockfile, want die mag je niet met de hand samenvoegen.
 *
 * `pnpm-lock.yaml` is het bestand dat het vaakst botst en het bestand waar handmatig
 * mergen het meeste kapotmaakt: het resultaat ziet er goed uit maar klopt niet meer met
 * `package.json`, en dan valt CI om op `--frozen-lockfile`. Regenereren is het antwoord.
 */
function lockfileHint(bestanden) {
    return bestanden.includes('pnpm-lock.yaml')
        ? '    # pnpm-lock.yaml niet met de hand mergen maar opnieuw laten maken:\n' +
            '    #   git checkout --ours pnpm-lock.yaml && pnpm install --lockfile-only\n' +
            '    #   git add pnpm-lock.yaml && git rebase --continue\n'
        : '';
}
/** `<owner>/<naam>` uit een GitHub-PR-URL, voor de `--repo`-hint in de waarschuwing. */
function ghDoelVanUrl(prUrl) {
    return /github\.com\/([^/]+\/[^/]+)\//.exec(prUrl)?.[1];
}
//# sourceMappingURL=inleveren.js.map