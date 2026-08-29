import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appOpties, bordItems, escalaties, ESCALATIE_LABEL, kolomVan, isBacklogRepo, haalLabelWeg, orkestratorComments, plaatsComment, schrijfBody, wachtrijVan, zetKolom, zetLabel, zorgVoorEscalatieLabel, } from '../board.js';
import { kalenderdag, LAUNCH_LABEL, leesInstellingen, leesStaat, metBoekhouding, schrijfLog, standaardPaden, TOKEN_SLEUTEL, vereisToken, zorgVoorEnvBestand, } from '../orkestrator-instellingen.js';
import { templatesDir } from '../paths.js';
import { draaiReeks, meldReeks } from '../reeks.js';
import { werkBouwAntwoordAf } from './orkestreer-bouw.js';
import { globaleFactoryVersie, minstensVersie } from './integreer.js';
import { GebruikersFout, kop, ok, run, uitvoerVan, waarschuwing } from '../shell.js';
import { draaiWerker } from '../werker.js';
import { versWerkplaats, werkplaatsVan, werkplaatsWortel } from '../werkplaats.js';
/**
 * De supervisor: hij pakt het oudste item uit de wachtrij en laat er één onbemande
 * werker op los (#104, slice #153).
 *
 * Wat hier bewust níet gebeurt: promoveren naar **Klaar voor Bouwen**. Voor een
 * refinement bestaat geen `verify` die hem kan afkeuren, dus de enige poort is de
 * gebruiker. Een werker die zijn eigen werk goedkeurt heeft geen poort meer.
 */
/** Waar de werker uit put: de kolom waar niemand aan zet is. */
const WACHTRIJ_KOLOM = 'Klaar voor technische refinement';
/** Waar het item tijdens en na de run staat; daar wacht het op het akkoord. */
const WERK_KOLOM = 'Technisch refinen';
const EIGENAAR = 'gjvv13';
/** Eén model voor alle refinements — gemeten, zie het modelkeuze-besluit in #104. */
const MODEL = 'claude-opus-4-6';
// --- Lock: één orkestrator-run tegelijk, zelfde patroon als `factory integreer` ---
const LOCK_PAD = path.join(os.tmpdir(), 'factory-orkestreer.lock');
const LOCK_VERVALT_MS = 60 * 60 * 1000;
/**
 * Leest het pid uit het slotbestand. Geeft `undefined` als het bestand leeg is, geen
 * getal bevat of niet gelezen kan worden — dat is het terugvalpad voor slotbestanden
 * van een oudere versie die nog geen pid bevatten.
 */
function leesPid(pad) {
    try {
        const inhoud = readFileSync(pad, 'utf-8').trim();
        if (inhoud === '')
            return undefined;
        const pid = Number(inhoud);
        return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    }
    catch {
        return undefined;
    }
}
/** Controleert of een proces met het gegeven pid nog draait. */
function pidLeeft(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Probeert het slot te nemen. Schrijft het eigen pid in het slotbestand.
 *
 * - Bestaat er een slot met een pid dat nog leeft, dan wordt het nooit opgeruimd — ook
 *   niet als het ouder is dan `LOCK_VERVALT_MS`. Een levend pid weegt zwaarder dan de
 *   leeftijd, want precies dat scenario (een lange run) was het probleem.
 * - Bevat het slot geen pid (oudere versie) of is het pid dood, dan geldt de bestaande
 *   leeftijdsgrens: ouder dan `LOCK_VERVALT_MS` = opruimen.
 * - `lockInfo` geeft na een gefaalde poging de pad- en pid-informatie terug voor de
 *   foutmelding.
 */
export function neemLock() {
    try {
        const stat = statSync(LOCK_PAD);
        const pid = leesPid(LOCK_PAD);
        if (pid !== undefined && pidLeeft(pid)) {
            // De eigenaar leeft nog — niet opruimen, ongeacht leeftijd.
            return false;
        }
        // Geen pid (oud formaat) of pid is dood: val terug op leeftijd.
        if (Date.now() - stat.mtimeMs > LOCK_VERVALT_MS) {
            if (pid !== undefined) {
                process.stdout.write(`! oud slot van pid ${String(pid)} opgeruimd — dat proces bestaat niet meer.\n`);
            }
            rmSync(LOCK_PAD);
        }
    }
    catch {
        // Geen bestaand slot — prima.
    }
    try {
        // `wx` is atomair: faalt als het bestand al bestaat, dus twee runs racen niet.
        closeSync(openSync(LOCK_PAD, 'wx'));
        writeFileSync(LOCK_PAD, String(process.pid));
        return true;
    }
    catch {
        return false;
    }
}
/** Leest het pid uit het huidige slotbestand, voor de foutmelding. */
export function lockInfo() {
    const pid = leesPid(LOCK_PAD);
    if (pid !== undefined) {
        const leeftTekst = pidLeeft(pid) ? 'leeft nog' : 'dood';
        return `${LOCK_PAD}, pid ${String(pid)} ${leeftTekst}`;
    }
    return LOCK_PAD;
}
export function geefLockVrij() {
    try {
        rmSync(LOCK_PAD);
    }
    catch {
        // Al weg — prima.
    }
}
/**
 * De wachtrij: open items in de wachtrij-kolom, zonder escalatie, oudste eerst.
 *
 * Het board wordt hier **één keer** gelezen, en de gegevens reizen daarna mee naar de
 * werker. Dertien werkers die elk het board opzoeken kosten een kwart van het
 * uurbudget om iets op te halen wat de supervisor al weet — zie #104.
 */
/**
 * Het item waar deze run over gaat: de kop van de rij, of het gevraagde issue.
 *
 * `--issue` filtert de rij die `bouwWachtrij` al gemaakt heeft; hij bouwt geen tweede
 * rij en kan dus een item dat niet mag ook niet laten draaien. Staat het er niet in,
 * dan is dat een fout mét de reden — stilte kostte gisteren een halfuur zoeken.
 *
 * De opzoekingen hieronder draaien alléén op dit foutpad. De gewone doorloop leest het
 * board één keer, en dat blijft zo.
 */
function kiesOpdracht(wachtrij, issue, cwd) {
    if (issue === undefined) {
        return wachtrij[0];
    }
    const gevraagd = wachtrij.find((item) => item.issue === issue);
    if (gevraagd !== undefined) {
        return gevraagd;
    }
    const nummer = `#${String(issue)}`;
    if (escalaties(cwd)?.has(issue) === true) {
        throw new GebruikersFout(`${nummer} staat niet in de wachtrij: het draagt het label ${ESCALATIE_LABEL}.\n` +
            `  Antwoord eerst: factory orkestreer antwoord ${String(issue)} "…"`);
    }
    const kolom = kolomVan(issue, cwd);
    if (kolom === undefined) {
        throw new GebruikersFout(`${nummer} staat niet in de wachtrij: hij heeft geen kolom op het board, of hij is gesloten.`);
    }
    if (kolom !== WACHTRIJ_KOLOM) {
        throw new GebruikersFout(`${nummer} staat niet in de wachtrij: het staat op ${kolom}, niet op ${WACHTRIJ_KOLOM}.`);
    }
    throw new GebruikersFout(`${nummer} staat niet in de wachtrij: het heeft geen App-veld, dus geen code om te lezen.`);
}
function bouwWachtrij(cwd) {
    const alles = wachtrijVan(WACHTRIJ_KOLOM, cwd);
    if (alles === undefined) {
        throw new GebruikersFout(`Kon het board niet lezen; zonder wachtrij is er niets te doen.\n` +
            `  Controleer je gh-auth (\`gh auth status\`) en of de GraphQL-limiet niet op is\n` +
            `  (\`gh api rate_limit --jq .resources.graphql\`).`);
    }
    const geblokkeerd = escalaties(cwd);
    if (geblokkeerd === undefined) {
        // Zonder deze lijst weten we niet welke items al een vraag hebben openstaan, en
        // dan draaien we die vraag opnieuw — met kosten en zonder nieuwe informatie.
        throw new GebruikersFout('Kon de escalaties niet lezen; zonder die lijst zou een openstaande vraag opnieuw draaien.');
    }
    const bruikbaar = [];
    for (const item of alles) {
        if (geblokkeerd.has(item.issue)) {
            continue;
        }
        if (item.app === undefined || item.app === '') {
            // Niet stil overslaan: zonder App weet de werker niet wélke code hij moet lezen,
            // en een item dat nooit aan de beurt komt zonder dat iemand het merkt is erger
            // dan een item dat overgeslagen wordt met een melding.
            waarschuwing(`#${String(item.issue)} heeft geen App-veld — overgeslagen.`);
            continue;
        }
        bruikbaar.push({ ...item, app: item.app });
    }
    return bruikbaar;
}
/** De prompt voor de werker: het sjabloon met de feiten die hij niet mag opzoeken. */
export function bouwPrompt(item, werkmap, factoryMap, apps = []) {
    const sjabloon = readFileSync(path.join(templatesDir, 'werker-refine.md'), 'utf8');
    const vervang = {
        '{{ISSUE}}': String(item.issue),
        '{{TITEL}}': item.titel,
        '{{APP}}': item.app,
        '{{KOLOM}}': WERK_KOLOM,
        '{{WERKMAP}}': werkmap,
        '{{FACTORY_MAP}}': factoryMap,
        '{{BEKENDE_APPS}}': apps.join(', '),
    };
    return Object.entries(vervang).reduce((tekst, [sleutel, waarde]) => tekst.split(sleutel).join(waarde), sjabloon);
}
/** Draait de supervisor. Zie `factory help` voor de vlaggen. */
export async function orkestreer(opties = {}) {
    const paden = opties.paden ?? standaardPaden();
    if (opties.installeer === true) {
        installeerAgent(paden);
        return;
    }
    if (opties.verwijder === true) {
        verwijderAgent(paden);
        return;
    }
    const modi = [opties.dry, opties.eenmalig, opties.nacht, opties.reeks !== undefined].filter((modus) => modus === true);
    if (modi.length > 1) {
        // Stil één van de modi kiezen laat iemand denken dat de run gestart is.
        throw new GebruikersFout('--dry, --eenmalig, --reeks en --nacht sluiten elkaar uit; kies er één.');
    }
    if (modi.length === 0) {
        // Een kaal commando dat tóch een werker start is precies het soort verrassing dat
        // je bij onbemand werk niet wilt — ook nu er een LaunchAgent bestaat die het wél
        // vanzelf doet. Die staat in de plist als `--nacht`, expliciet en na te lezen.
        throw new GebruikersFout('Gebruik: factory orkestreer --dry (tonen), --eenmalig (één item), --reeks <n> (een reeks) of --nacht (tot het dagmaximum).');
    }
    const cwd = process.cwd();
    const wortel = opties.werkplaatsWortel ?? werkplaatsWortel;
    if (opties.reeks !== undefined) {
        if (opties.issue !== undefined) {
            // Een reeks van één is `--eenmalig`; een reeks op één item gericht bestaat niet.
            throw new GebruikersFout('--issue en --reeks gaan niet samen; gebruik --eenmalig.');
        }
        if (!neemLock()) {
            throw new GebruikersFout(`Er draait al een orkestrator-run (${lockInfo()}).`);
        }
        const instellingen = leesInstellingen(paden);
        const keuze = opties.reeks;
        const lijst = keuze.soort === 'lijst' ? keuze.issues : undefined;
        try {
            kop(keuze.soort === 'aantal'
                ? `Reeks van ${String(keuze.aantal)}`
                : `Reeks: ${keuze.issues.map((n) => `#${String(n)}`).join(', ')}`);
            meldReeks(await draaiReeks({
                paden,
                nu: opties.nu ?? new Date(Date.now()),
                soort: 'refine',
                // Jij startte deze reeks, dus hij komt niet uit de pot van de nacht (#264).
                pot: 'interactief',
                noemer: 'deze reeks',
                aantal: keuze.soort === 'aantal' ? keuze.aantal : keuze.issues.length,
                ...(lijst === undefined ? {} : { lijst }),
                leesRij: () => bouwWachtrij(cwd),
                werkAf: (item) => werkAf(item, cwd, wortel, {
                    budgetUsd: instellingen.budgetPerRun,
                    // Dezelfde tijdslimiet als de nacht: een hangende werker in een reeks van
                    // vier is even duur als een hangende werker om 04:00 (#206).
                    timeoutMs: instellingen.runTimeoutMs,
                    effort: instellingen.werkerEffort,
                }, appOpties() ?? []),
                beschrijf: beschrijfRun,
                beoordeel: (u) => (u.afloop === 'klaar' ? 'gelukt' : u.afloop),
            }));
        }
        finally {
            geefLockVrij();
        }
        return;
    }
    if (opties.nacht === true) {
        if (opties.issue !== undefined) {
            // Een nachtrun draait tot het dagmaximum. Op één item gericht zou hij dat item één
            // keer doen en daarna op de lus-vanger stuiten: dan is de vlag een dure manier om
            // `--eenmalig` te zeggen. De controle staat hier en niet in `cli.ts`, zodat een
            // test hem kan bereiken zonder de CLI te starten.
            throw new GebruikersFout('--issue en --nacht gaan niet samen; gebruik --eenmalig.');
        }
        await draaiNacht(cwd, wortel, paden, opties.nu ?? new Date(Date.now()));
        return;
    }
    const wachtrij = bouwWachtrij(cwd);
    kop(`Wachtrij: ${WACHTRIJ_KOLOM}`);
    if (wachtrij.length === 0 && opties.issue === undefined) {
        ok('niets te doen');
        return;
    }
    for (const item of wachtrij) {
        const nummer = `#${String(item.issue)}`.padEnd(6);
        process.stdout.write(`  ${nummer} ${item.app.padEnd(12)} ${item.titel}\n`);
    }
    const eerste = kiesOpdracht(wachtrij, opties.issue, cwd);
    if (eerste === undefined) {
        return;
    }
    if (opties.dry === true) {
        // Bewust vóór het lezen van de instellingen: `--dry` raakt niets aan, ook geen
        // bestand in de home-map, en moet dus ook werken als daar niets staat.
        process.stdout.write(`\nZou nu draaien: #${String(eerste.issue)} (${eerste.app}), in ${werkplaatsVan(eerste.app, wortel)}.\n` +
            `Er is niets geschreven — niet naar GitHub en niet naar de werkplaats.\n`);
        return;
    }
    if (!neemLock()) {
        throw new GebruikersFout(`Er draait al een orkestrator-run (${lockInfo()}).\n` +
            '  Wacht tot die klaar is, of verwijder het slot als er zeker niets meer draait.');
    }
    try {
        // Met de hand: het budget uit de instellingen, maar geen token vereist — dan draait
        // `claude` op de gewone keychain-auth van de terminal waarin je dit typt. Boeken en
        // loggen gaan wél mee: een run met de hand kost hetzelfde geld als een run in de
        // nacht, en stond tot #264 nergens.
        await metBoekhouding({
            paden,
            nu: opties.nu ?? new Date(Date.now()),
            soort: 'refine',
            // Jij startte deze run, dus hij komt niet uit de pot van de nacht.
            pot: 'interactief',
            item: eerste,
        }, () => werkAf(eerste, cwd, wortel, {
            budgetUsd: leesInstellingen(paden).budgetPerRun,
            effort: leesInstellingen(paden).werkerEffort,
        }, appOpties() ?? []), beschrijfRun);
    }
    finally {
        geefLockVrij();
    }
}
/**
 * Wat er van een refine-run in het log komt.
 *
 * Een afkapping is een eigen soort mislukking: 's ochtends wil je in één blik zien dat
 * de tijd op was en niet dat "iets" faalde (#206).
 */
function beschrijfRun(uitkomst) {
    return {
        uitkomst: uitkomst.afgekaptNaMinuten === undefined
            ? uitkomst.afloop
            : `afgekapt (${String(uitkomst.afgekaptNaMinuten)} min)`,
        ...(uitkomst.kosten === undefined ? {} : { kosten: uitkomst.kosten }),
        ...(uitkomst.beurten === undefined ? {} : { beurten: uitkomst.beurten }),
    };
}
/**
 * De onbemande modus: werkers starten tot het dagmaximum of tot de wachtrij leeg is.
 *
 * De wachtrij wordt per ronde opnieuw gelezen. Dat is een board-lezing per item en dus
 * niet gratis (#104 rekent voor hoe schaars het GraphQL-budget is), maar de vorige run
 * heeft het board net veranderd: het item dat hij afwerkte staat nu op een andere
 * kolom, of draagt een escalatie-label. Doorwerken op de oude lijst zou hetzelfde item
 * een tweede keer oppakken.
 */
async function draaiNacht(cwd, wortel, paden, nu) {
    const instellingen = leesInstellingen(paden);
    // De token eerst: een nacht die pas bij de eerste `claude`-aanroep struikelt heeft
    // dan al een item uit de wachtrij gehaald en een kolom verzet.
    const token = vereisToken(instellingen, paden);
    const draaiOpties = {
        budgetUsd: instellingen.budgetPerRun,
        env: { ...process.env, [TOKEN_SLEUTEL]: token },
        // Alleen onbemand een grens: een nacht die vastloopt kost de hele rij, terwijl een
        // run die ik zelf start onder mijn ogen gebeurt en gewoon met ctrl-c stopt.
        timeoutMs: instellingen.runTimeoutMs,
        effort: instellingen.werkerEffort,
    };
    const versie = eigenVersie();
    const verwacht = process.env['FACTORY_VERWACHTE_VERSIE'];
    if (verwacht !== undefined && verwacht !== versie) {
        const melding = `factory draait op ${versie}, verwacht ${verwacht}; de zelf-update is mislukt`;
        waarschuwing(melding);
        schrijfLog(paden, `${new Date(nu.getTime()).toISOString()} WARNING ${melding}`);
    }
    kop(`Nacht van ${kalenderdag(nu)}`);
    schrijfLog(paden, `${new Date(nu.getTime()).toISOString()} nacht gestart (factory ${versie})`);
    const gestart = leesStaat(paden, nu).gestart;
    if (gestart >= instellingen.dagmaximum) {
        // Meerdere runs op één kalenderdag delen hetzelfde maximum; anders is een handmatige
        // extra run 's avonds een gratis verdubbeling van wat ik moet beoordelen.
        ok(`dagmaximum al bereikt (${String(gestart)}/${String(instellingen.dagmaximum)}); niets gedaan.`);
        return;
    }
    if (!neemLock()) {
        throw new GebruikersFout(`Er draait al een orkestrator-run (${lockInfo()}).`);
    }
    const alGestart = gestart;
    try {
        // Dezelfde lus als `--reeks` (#265): het dagmaximum bepaalt hier alleen hoeveel
        // items er nog in passen. Zo blijven de vangnetten van de nacht en van een reeks
        // die jij start per definitie gelijk.
        const uitkomst = await draaiReeks({
            paden,
            nu,
            soort: 'refine',
            pot: 'nacht',
            noemer: 'vannacht',
            aantal: instellingen.dagmaximum - alGestart,
            leesRij: () => bouwWachtrij(cwd),
            werkAf: (item) => werkAf(item, cwd, wortel, draaiOpties, appOpties() ?? []),
            beschrijf: beschrijfRun,
            beoordeel: (u) => (u.afloop === 'klaar' ? 'gelukt' : u.afloop),
            naElkeRun: (aantal) => {
                ok(`${String(alGestart + aantal)}/${String(instellingen.dagmaximum)} van vannacht gedaan.`);
            },
        });
        if (uitkomst.einde === 'rij-leeg') {
            ok('wachtrij leeg; klaar voor vannacht.');
        }
        else if (uitkomst.einde === 'niets-nieuws') {
            ok('niets nieuws meer in de wachtrij; klaar voor vannacht.');
        }
    }
    finally {
        geefLockVrij();
    }
}
/** Werkt één item af: werkplaats verversen, werker draaien, uitkomst verwerken. */
async function werkAf(item, cwd, wortel, draai, apps = []) {
    kop(`#${String(item.issue)} — ${item.titel}`);
    zorgVoorEscalatieLabel(cwd);
    const werkmap = versWerkplaats(item.app, EIGENAAR, wortel);
    // De factory-spiegel gaat mee als leesmap: daar staan de templates, WORKFLOW.md en
    // de coding-guidelines waar de werker zijn uitwerking op moet enten.
    const factoryMap = versWerkplaats('factory', EIGENAAR, wortel);
    // Meteen als bezet markeren: een `/refine`-sessie in de chat kent dit slot niet en
    // zou anders hetzelfde item oppakken.
    zetKolom(item.issue, WERK_KOLOM, cwd);
    // Vanaf hier staat het item buiten de wachtrij. Valt de run om — een fout, of een
    // Ctrl-C halverwege een run van tien minuten — dan zou het daar blijven staan zonder
    // comment en zonder label: uit de wachtrij, niet als vastgelopen te herkennen, en
    // dus nooit meer aan de beurt. Vandaar dit vangnet, ook op een signaal.
    const terugInWachtrij = () => {
        zetKolom(item.issue, WACHTRIJ_KOLOM, cwd);
    };
    const bijSignaal = () => {
        terugInWachtrij();
        geefLockVrij();
        process.exit(130);
    };
    process.on('SIGINT', bijSignaal);
    process.on('SIGTERM', bijSignaal);
    try {
        const sessie = randomUUID();
        const uitkomst = await draaiWerker({
            prompt: bouwPrompt(item, werkmap, factoryMap, apps),
            werkmap,
            sessie,
            extraMappen: [factoryMap],
            budgetUsd: draai.budgetUsd,
            ...(draai.timeoutMs === undefined ? {} : { timeoutMs: draai.timeoutMs }),
            model: MODEL,
            ...(draai.effort === undefined ? {} : { effort: draai.effort }),
            ...(draai.env === undefined ? {} : { env: draai.env }),
        });
        // De afloop komt uit `verwerk` en niet uit de werker: schrijft de body niet weg,
        // dan is 'klaar' onwaar, en het log hoort te zeggen wat er echt gebeurde.
        return {
            afloop: verwerk(item, uitkomst, werkmap, cwd),
            ...(uitkomst.kosten === undefined ? {} : { kosten: uitkomst.kosten }),
            ...(uitkomst.beurten === undefined ? {} : { beurten: uitkomst.beurten }),
            ...(uitkomst.afgekaptNaMinuten === undefined
                ? {}
                : { afgekaptNaMinuten: uitkomst.afgekaptNaMinuten }),
        };
    }
    catch (fout) {
        terugInWachtrij();
        throw fout;
    }
    finally {
        process.off('SIGINT', bijSignaal);
        process.off('SIGTERM', bijSignaal);
    }
}
/** De onzichtbare markering waaraan een orkestrator-comment te herkennen is. */
const MARKERING = '<!-- orkestrator:';
const VRAAG_MERK = '<!-- orkestrator:vraag -->';
const VRAAG_EIND = '<!-- /orkestrator:vraag -->';
const ADVIES_MERK = '<!-- orkestrator:advies -->';
const ADVIES_EIND = '<!-- /orkestrator:advies -->';
/**
 * Bouwt de escalatie-comment: leesbaar voor jou, terugleesbaar voor `antwoord`.
 *
 * De markeringen zijn HTML-comments, dus onzichtbaar in de gerenderde issue. Zonder
 * die grenzen zou `status` de vraag uit opgemaakte tekst moeten vissen, en dan breekt
 * het zodra iemand de comment bijwerkt of de opmaak verandert.
 */
export function escalatieComment(issue, vraag, advies, uitkomst, werkmap, soort = 'refine', app) {
    return (`**Escalatie.**\n\n` +
        `${VRAAG_MERK}\n**Vraag:** ${vraag}\n${VRAAG_EIND}\n\n` +
        `${ADVIES_MERK}\n**Advies:** ${advies}\n${ADVIES_EIND}\n\n` +
        `Antwoorden: \`factory orkestreer antwoord ${String(issue)} "<jouw keuze>"\`\n\n` +
        voetnoot(uitkomst, werkmap, soort, app));
}
/**
 * De laatste escalatie op een issue, of undefined.
 *
 * Zoekt van achter naar voren naar een comment die écht als escalatie te lezen is.
 * Alleen "de laatste orkestrator-comment" pakken gaat mis zodra er daarna nog iets
 * gebeurde — een mislukte run schrijft ook een comment mét sessie-markering maar
 * zonder vraag, en dan zou de vraag een comment hoger onvindbaar worden.
 */
export function laatsteEscalatie(issue, cwd) {
    const comments = orkestratorComments(issue, MARKERING, cwd);
    for (let i = comments.length - 1; i >= 0; i -= 1) {
        const gelezen = leesEscalatie(comments[i] ?? '');
        if (gelezen !== undefined) {
            return gelezen;
        }
    }
    return undefined;
}
/**
 * Leest een escalatie terug uit de comment die `escalatieComment` schreef.
 *
 * Optionele velden `soort` en `app` staan vóór `sessie`; ontbreken ze (oude comments),
 * dan is `soort` altijd `'refine'` — voor #306 bestond er geen bouw-escalatie die het
 * antwoordpad kon bereiken.
 */
export function leesEscalatie(comment) {
    const sessie = /<!-- orkestrator:(?:\s+soort=(\S+))?(?:\s+app=(\S+))?\s+sessie=([^\s]+)\s+werkmap=(.+?)\s*-->/.exec(comment);
    if (sessie?.[3] === undefined || sessie[4] === undefined) {
        return undefined;
    }
    const vraag = tussen(comment, VRAAG_MERK, VRAAG_EIND);
    const advies = tussen(comment, ADVIES_MERK, ADVIES_EIND);
    if (vraag === undefined || advies === undefined) {
        return undefined;
    }
    const soort = sessie[1] === 'bouw' ? 'bouw' : 'refine';
    return {
        vraag,
        advies,
        sessie: sessie[3],
        werkmap: sessie[4],
        soort,
        ...(sessie[2] === undefined ? {} : { app: sessie[2] }),
    };
}
/**
 * De tekst tussen een open- en sluitmarkering, zonder het label ervoor.
 *
 * Expliciet sluiten en niet "tot de volgende markering": het advies wordt gevolgd door
 * de antwoord-hint en de voetnoot, en die hoorden er in de eerste versie stilzwijgend
 * bij. Een parser die op het eind van het blok gokt, gokt vroeg of laat verkeerd.
 */
function tussen(tekst, van, tot) {
    const begin = tekst.indexOf(van);
    if (begin === -1) {
        return undefined;
    }
    const rest = tekst.slice(begin + van.length);
    const eind = rest.indexOf(tot);
    return (eind === -1 ? rest : rest.slice(0, eind))
        .replace(/^\s*\*\*(Vraag|Advies):\*\*\s*/, '')
        .trim();
}
/** Vertaalt de uitkomst van de werker naar wat er op GitHub gebeurt, en hoe het afliep. */
function verwerk(item, uitkomst, werkmap, cwd) {
    if (uitkomst.afloop === 'mislukt') {
        // Escalatie, niet opnieuw proberen: dezelfde fout elke nacht opnieuw draaien kost
        // geld en levert niets op. Terug in de wachtrij-kolom, want er wordt niet aan
        // gewerkt — het label houdt hem daar uit de rij tot jij hem beantwoordt.
        blokkeer(item, cwd);
        plaatsComment(item.issue, `**Run mislukt.** ${uitkomst.fout ?? 'onbekende fout'}\n\n${voetnoot(uitkomst, werkmap)}`, cwd);
        waarschuwing(`#${String(item.issue)} mislukt: ${uitkomst.fout ?? 'onbekende fout'}`);
        return 'mislukt';
    }
    const verdict = uitkomst.verdict;
    if (verdict?.uitkomst === 'escalatie') {
        blokkeer(item, cwd);
        plaatsComment(item.issue, escalatieComment(item.issue, verdict.vraag, verdict.advies, uitkomst, werkmap), cwd);
        ok(`#${String(item.issue)} geëscaleerd — beantwoorden met: factory orkestreer antwoord ${String(item.issue)} "…"`);
        return 'escalatie';
    }
    if (verdict?.uitkomst !== 'klaar') {
        // Onbereikbaar zolang `afloop` en `verdict` uit dezelfde bron komen, maar het
        // alternatief is stil doorgaan met een lege body.
        waarschuwing(`#${String(item.issue)} gaf geen bruikbare uitwerking.`);
        return 'mislukt';
    }
    return rondAf(item.issue, verdict.body, verdict.samenvatting, verdict.slices, uitkomst, werkmap, cwd);
}
/** Zet een item stil: terug in de wachtrij-kolom, met het label dat het overslaat. */
function blokkeer(item, cwd) {
    zetKolom(item.issue, WACHTRIJ_KOLOM, cwd);
    zetLabel(item.issue, ESCALATIE_LABEL, cwd);
}
/** Schrijft de uitwerking weg en zet het item op wachten-op-akkoord. */
function rondAf(issue, body, samenvatting, slices, uitkomst, werkmap, cwd) {
    const tijdelijk = mkdtempSync(path.join(os.tmpdir(), 'factory-orkestreer-'));
    const bodyBestand = path.join(tijdelijk, 'body.md');
    writeFileSync(bodyBestand, body.endsWith('\n') ? body : `${body}\n`);
    const geschreven = schrijfBody(issue, bodyBestand, cwd);
    rmSync(tijdelijk, { recursive: true, force: true });
    if (!geschreven) {
        // De uitwerking is er wel maar staat nergens; dat is een mislukking, geen succes.
        blokkeer({ issue }, cwd);
        plaatsComment(issue, `**Uitwerking kon niet weggeschreven worden.**\n\n${voetnoot(uitkomst, werkmap)}`, cwd);
        return 'mislukt';
    }
    zetKolom(issue, WERK_KOLOM, cwd);
    haalLabelWeg(issue, ESCALATIE_LABEL, cwd);
    plaatsComment(issue, `**Technisch uitgewerkt** (${String(slices)} slice${slices === 1 ? '' : 's'}).\n\n` +
        `${samenvatting}\n\nHet item staat op **${WERK_KOLOM}** en wacht op je akkoord; ` +
        `dat akkoord is het verplaatsen naar **Klaar voor Bouwen**.\n\n${voetnoot(uitkomst, werkmap)}`, cwd);
    ok(`#${String(issue)} uitgewerkt en op ${WERK_KOLOM}`);
    return 'klaar';
}
/**
 * De voetnoot onder elke comment: kosten, beurten en de sessie.
 *
 * De sessie-markering is niet decoratief — `factory orkestreer antwoord` hervat er
 * later mee. De werkmap staat erbij omdat de werker daar de code leest; hervatten
 * zelf blijkt niet map-gebonden (gemeten, anders dan #104 aannam).
 */
function voetnoot(uitkomst, werkmap, soort = 'refine', app) {
    const delen = [
        uitkomst.kosten === undefined ? undefined : `$${uitkomst.kosten.toFixed(2)}`,
        uitkomst.beurten === undefined ? undefined : `${String(uitkomst.beurten)} beurten`,
        uitkomst.weigeringen > 0 ? `${String(uitkomst.weigeringen)}× geweigerd` : undefined,
    ].filter((deel) => deel !== undefined);
    // `soort` en `app` staan vóór `werkmap`: het pad kan spaties bevatten, en de
    // lazy match `werkmap=(.+?) -->` stopt bij het sluitteken — nieuwe velden erachter
    // zouden in de match meelopen.
    const extra = soort === 'refine' && app === undefined
        ? ''
        : ` soort=${soort}${app === undefined ? '' : ` app=${app}`}`;
    return (`<sub>${delen.join(' · ')}</sub>\n` +
        `<!-- orkestrator:${extra} sessie=${uitkomst.sessie} werkmap=${werkmap} -->`);
}
// --- status: wat wacht er op mij ---------------------------------------------
/**
 * Toont in één blik waar iedereen op wacht: op jou, op een antwoord, of op een werker.
 *
 * Eén board-lezing voor alle drie de blokken; het escalatie-blok haalt zijn vraag en
 * advies uit de comment die de orkestrator zelf schreef.
 */
export function orkestreerStatus(cwd, opties = {}) {
    const items = bordItems(cwd);
    if (items === undefined) {
        throw new GebruikersFout('Kon het board niet lezen.');
    }
    const geblokkeerd = escalaties(cwd);
    if (geblokkeerd === undefined) {
        throw new GebruikersFout('Kon de escalaties niet lezen.');
    }
    const wachtOpAkkoord = items.filter((item) => item.kolom === WERK_KOLOM && !geblokkeerd.has(item.issue));
    const vastgelopen = items.filter((item) => geblokkeerd.has(item.issue));
    const wachtOpMerge = items.filter((item) => item.kolom === 'Wacht op merge');
    const wachtrij = items.filter((item) => item.kolom === WACHTRIJ_KOLOM && !geblokkeerd.has(item.issue));
    // De tellers eerst: dit is de enige plek waar je ziet wat er vandaag al gedraaid heeft,
    // en sinds #264 zijn dat twee potten. Zonder deze regel zou je de nachtpot pas leeg
    // zien als de nacht meldt dat hij niets doet.
    const paden = opties.paden ?? standaardPaden();
    const staat = leesStaat(paden, new Date(Date.now()));
    const instellingen = leesInstellingen(paden);
    kop('Vandaag');
    process.stdout.write(`  nacht refine:   ${String(staat.gestart)}/${String(instellingen.dagmaximum)}\n` +
        `  nacht bouw:     ${String(staat.nachtBouw)}/${String(instellingen.bouwDagmaximum)}\n` +
        `  nacht fastlane: ${String(staat.nachtFastlane)}/${String(instellingen.fastlaneCap)}\n` +
        `  zelf gestart:   ${String(staat.interactief)} (geen maximum; het aantal geef je mee bij het starten)\n`);
    kop(`Technisch uitgewerkt, wacht op jouw akkoord (${String(wachtOpAkkoord.length)})`);
    toonLijst(wachtOpAkkoord);
    kop(`Geëscaleerd, wacht op een antwoord (${String(vastgelopen.length)})`);
    for (const item of vastgelopen) {
        toonRegel(item);
        const escalatie = laatsteEscalatie(item.issue, cwd);
        if (escalatie === undefined) {
            // Zeg het: een escalatie zonder leesbare vraag is niet te beantwoorden, en dat
            // stil laten is erger dan een lelijke regel.
            process.stdout.write('         (geen leesbare escalatie-comment gevonden)\n');
            continue;
        }
        process.stdout.write(`         Vraag:  ${escalatie.vraag}\n`);
        process.stdout.write(`         Advies: ${escalatie.advies}\n`);
        process.stdout.write(`         Antwoorden: factory orkestreer antwoord ${String(item.issue)} "<jouw keuze>"\n`);
    }
    kop(`Wacht op merge (${String(wachtOpMerge.length)})`);
    if (wachtOpMerge.length === 0) {
        process.stdout.write('  —\n');
    }
    else {
        for (const item of wachtOpMerge) {
            toonRegel(item);
            const pr = prStatus(item.issue, item.app, cwd);
            if (pr !== undefined) {
                const ci = pr.ci === '' ? 'onbekend' : pr.ci;
                process.stdout.write(`         PR: ${pr.url}  CI: ${ci}\n`);
            }
        }
    }
    kop(`Wachtrij: ${WACHTRIJ_KOLOM} (${String(wachtrij.length)})`);
    toonLijst(wachtrij);
}
/**
 * PR-url en CI-status voor een item op Wacht op merge. Kijkt naar de eerste
 * slice-branch (`slice/<issue>-1`) in de repo van de app; undefined als de PR
 * niet te lezen is.
 */
function prStatus(issue, app, cwd) {
    const repo = app === 'factory' ? `${EIGENAAR}/factory` : `${EIGENAAR}/${app ?? 'factory'}`;
    const ruw = uitvoerVan('gh', ['pr', 'view', `slice/${String(issue)}-1`, '--repo', repo, '--json', 'url,statusCheckRollup'], cwd);
    if (ruw === undefined || ruw === '') {
        return undefined;
    }
    try {
        const parsed = JSON.parse(ruw);
        const url = parsed.url ?? '';
        // De rollup is een lijst per check; de samenvatting is het slechtste resultaat.
        const checks = parsed.statusCheckRollup ?? [];
        const ci = checks.length === 0
            ? ''
            : checks.every((c) => c.state === 'SUCCESS')
                ? 'groen'
                : checks.some((c) => c.state === 'FAILURE' || c.state === 'ERROR')
                    ? 'rood'
                    : 'lopend';
        return { url, ci };
    }
    catch {
        return undefined;
    }
}
function toonLijst(items) {
    if (items.length === 0) {
        process.stdout.write('  —\n');
        return;
    }
    for (const item of items) {
        toonRegel(item);
    }
}
function toonRegel(item) {
    const nummer = `#${String(item.issue)}`.padEnd(6);
    process.stdout.write(`  ${nummer} ${(item.app ?? '?').padEnd(12)} ${item.titel}\n`);
}
/**
 * Beantwoordt een escalatie: het antwoord gaat terug de bestaande sessie in.
 *
 * Hervatten is niet alleen sneller maar veel goedkoper — gemeten op 2026-08-19 kostte
 * een hervatting $0,02 tegen $0,32 voor een verse run, want de context zit in de
 * cache. Het werk tot de escalatie blijft dus staan; de werker begint niet opnieuw.
 */
export async function orkestreerAntwoord(issueArgument, tekst, opties = {}, cwd = process.cwd()) {
    const issue = Number.parseInt(issueArgument ?? '', 10);
    if (!Number.isSafeInteger(issue) || issue <= 0 || tekst === undefined || tekst.trim() === '') {
        throw new GebruikersFout('Gebruik: factory orkestreer antwoord <issuenummer> "<jouw antwoord>"');
    }
    const escalatie = laatsteEscalatie(issue, cwd);
    if (escalatie === undefined) {
        throw new GebruikersFout(`Geen escalatie gevonden op #${String(issue)}.\n` +
            '  Er staat geen orkestrator-comment met een sessie-markering; er valt dus niets te hervatten.');
    }
    if (!neemLock()) {
        // Twee antwoorden tegelijk hervatten dezelfde sessie en schrijven allebei een body
        // en een comment; de laatste wint en je houdt een dubbele comment over.
        throw new GebruikersFout(`Er draait al een orkestrator-run (${lockInfo()}).`);
    }
    try {
        await werkAntwoordAf(issue, tekst, escalatie, opties, cwd);
    }
    finally {
        geefLockVrij();
    }
}
async function werkAntwoordAf(issue, tekst, escalatie, opties, cwd) {
    // Een bouw-escalatie volgt een heel ander pad: draaiBouwer, review, inleveren.
    // Die logica zit in orkestreer-bouw.ts, naast de rest van het bouw-pad.
    if (escalatie.soort === 'bouw') {
        await werkBouwAntwoordAf(issue, tekst, escalatie, opties, cwd);
        return;
    }
    kop(`Antwoord op #${String(issue)}`);
    const opdracht = opties.opnieuw === true
        ? verseOpdracht(issue, tekst, escalatie, cwd, opties.werkplaatsWortel ?? werkplaatsWortel)
        : {
            prompt: vervolgPrompt(escalatie, tekst),
            werkmap: escalatie.werkmap,
            sessie: escalatie.sessie,
            hervat: true,
        };
    const instellingen = leesInstellingen(opties.paden ?? standaardPaden());
    const uitkomst = await draaiWerker({
        ...opdracht,
        budgetUsd: instellingen.budgetPerRun,
        model: MODEL,
        effort: instellingen.werkerEffort,
    });
    if (uitkomst.sessieWeg === true) {
        // Niet stil falen: de sessie is weg, maar er is nog een weg vooruit, en die staat
        // hier letterlijk. Het werk tot de escalatie is dan wel verloren.
        throw new GebruikersFout(`De sessie ${escalatie.sessie} bestaat niet meer, dus hervatten kan niet.\n` +
            `  Begin een verse run met je antwoord erbij:\n` +
            `    factory orkestreer antwoord ${String(issue)} "${tekst}" --opnieuw\n` +
            '  Dat kost meer (geen cache) en het werk tot de escalatie is weg, maar het loopt door.');
    }
    if (uitkomst.afloop === 'mislukt') {
        plaatsComment(issue, `**Antwoord verwerkt, maar de run mislukte.** ${uitkomst.fout ?? 'onbekende fout'}\n\n` +
            voetnoot(uitkomst, escalatie.werkmap), cwd);
        throw new GebruikersFout(`De run mislukte: ${uitkomst.fout ?? 'onbekende fout'}`);
    }
    const verdict = uitkomst.verdict;
    if (verdict?.uitkomst === 'escalatie') {
        // Nog een vraag. Het label blijft staan; er is gewoon een nieuwe ronde nodig.
        plaatsComment(issue, escalatieComment(issue, verdict.vraag, verdict.advies, uitkomst, escalatie.werkmap), cwd);
        ok(`#${String(issue)} escaleert opnieuw`);
        return;
    }
    if (verdict?.uitkomst !== 'klaar') {
        throw new GebruikersFout(`#${String(issue)} gaf geen bruikbare uitwerking.`);
    }
    rondAf(issue, verdict.body, verdict.samenvatting, verdict.slices, uitkomst, escalatie.werkmap, cwd);
}
/**
 * De volledige opdracht opnieuw, mét het antwoord — voor als de sessie weg is.
 *
 * Alleen het antwoord meesturen zou een lege sessie opleveren die niet weet wélk issue,
 * wélke applicatie of wat er opgeleverd moet worden; die levert een verdict zonder
 * inhoud, of erger, een verzonnen body die de issue-body overschrijft. En de sessie
 * krijgt een **nieuwe** id: hergebruik van de oude faalt met "Session ID is already in
 * use" zodra die toch nog bestaat (gemeten).
 */
function verseOpdracht(issue, tekst, escalatie, cwd, wortel) {
    const item = bordItems(cwd)?.find((kandidaat) => kandidaat.issue === issue);
    if (item?.app === undefined) {
        throw new GebruikersFout(`Kon #${String(issue)} niet op het board vinden (of het heeft geen App-veld);\n` +
            '  zonder die gegevens is er geen opdracht om verse mee te beginnen.');
    }
    const werkmap = versWerkplaats(item.app, EIGENAAR, wortel);
    const factoryMap = versWerkplaats('factory', EIGENAAR, wortel);
    return {
        prompt: `${bouwPrompt({ ...item, app: item.app }, werkmap, factoryMap)}\n\n` +
            `## Eerder gevraagd\n\nEen eerdere poging stelde deze vraag:\n\n> ${escalatie.vraag}\n\n` +
            `Het antwoord is:\n\n> ${tekst}\n\nWerk daarmee verder.`,
        werkmap,
        sessie: randomUUID(),
    };
}
/** De prompt waarmee de sessie hervat wordt: jouw antwoord, en verder niets nieuws. */
export function vervolgPrompt(escalatie, tekst) {
    return (`Antwoord op je vraag "${escalatie.vraag}":\n\n${tekst}\n\n` +
        'Werk hiermee verder en geef opnieuw een verdict. Loop vóór je antwoord de gesloten ' +
        'lijst uit de onbemand-werken-skill nog een keer langs; kom je er nog een tegen, dan ' +
        'escaleer je opnieuw in plaats van hem zelf op te lossen.');
}
// --- De LaunchAgent: één keer per nacht, zonder dat ik een terminal open ------
/** Het uur waarop de refine-nacht draait — 04:00, zoals #104 het schetste. */
const NACHT_UUR = 4;
/** Het uur waarop de bouw-nacht draait — 05:30, ná de refine-nacht (#343). */
export const BOUW_NACHT_UUR = 5;
export const BOUW_NACHT_MINUUT = 30;
/**
 * Bouwt de plist die `factory orkestreer --nacht` één keer per nacht draait.
 *
 * Vier keuzes die een lezer zou willen aanvechten:
 *
 * **`StartCalendarInterval` en niet `StartInterval`.** De integreer-agent tikt elke
 * minuut een wachtrij af; die kost niets. Deze start werkers die geld kosten, dus hij
 * hoort op een moment te draaien en niet op een frequentie.
 *
 * **Geen `RunAtLoad`.** Anders begint `--installeer` meteen aan een nacht werk, en dan
 * is het installeren van de automatiek zelf de verrassing die de hele opzet wil
 * vermijden. De eerste run is vannacht.
 *
 * **Geen token in de plist.** Een plist in `~/Library/LaunchAgents` is gewoon
 * leesbaar; de token staat in een 0600-bestand dat de run zelf leest.
 *
 * **De install-stap vóór `--nacht`, niet erin (#237).** De plist draait een shellscript
 * dat eerst de nieuwste tag globaal installeert en dan `exec` doet naar `--nacht`. Zo
 * vervangt de run nooit zijn eigen bin terwijl hij draait: `exec` vervangt het proces
 * pas als de installatie al klaar is. Faalt het bijwerken, dan draait de nacht alsnog
 * op de oude bin, met een waarschuwing in het log.
 */
export function bouwOrkestreerPlist(opzet) {
    // De PATH van de installerende shell meebakken: launchd start anders met een kale
    // PATH en vindt node, gh of claude dan niet.
    const pad = process.env.PATH ?? '/usr/bin:/bin';
    const script = bouwNachtScript(opzet);
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${opzet.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>${script}</string>
  </array>
  <key>WorkingDirectory</key><string>${opzet.werkmap}</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${String(opzet.uur)}</integer><key>Minute</key><integer>${String(opzet.minuut)}</integer></dict>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${pad}</string></dict>
  <key>StandardOutPath</key><string>${opzet.logPad}</string>
  <key>StandardErrorPath</key><string>${opzet.logPad}</string>
</dict>
</plist>
`;
}
/** De publieke URL waarop `git ls-remote` de tags ophaalt — geen lokale repo nodig (#332). */
const FACTORY_REMOTE = `https://github.com/${EIGENAAR}/factory.git`;
/**
 * Het shellscript dat de LaunchAgent draait: eerst bijwerken, dan de nacht starten.
 *
 * Drie dingen zijn bewust zo:
 *
 * - **`git ls-remote` in plaats van `git -C`.** De vorige versie deed een `git -C` naar
 *   de factory-repo onder `~/Documents`, die macOS TCC blokkeert voor
 *   achtergrondprocessen (#332). `ls-remote` heeft geen lokale repo nodig.
 * - **`exec` als laatste regel.** Zo draait `--nacht` als hetzelfde PID en krijgt
 *   launchd de exitcode; zonder `exec` zou de shell na het kind afsluiten en zou een
 *   afgebroken nacht als een schoon exit terugkomen.
 * - **Geen `set -e`.** Het bijwerken mag falen zonder de hele nacht te stoppen; de
 *   if/else handelt dat af, en `exec` draait altijd.
 *
 * Het script vermijdt `&` in de tekst: die is XML-speciaal en zou in de plist als
 * `&amp;` moeten, wat de leesbaarheid van de bron en het log kapotmaakt. Vandaar
 * if/then/else in plaats van `&&`/`||`.
 *
 * `FACTORY_VERWACHTE_VERSIE` wordt gezet zodra de tag opgehaald is, zodat `draaiNacht`
 * een mismatch kan detecteren en loggen wanneer het bijwerken faalde.
 */
export function bouwNachtScript(opzet) {
    return [
        `TAG=$(git ls-remote --tags --refs --sort=-v:refname "${FACTORY_REMOTE}" "v*" | head -1 | sed "s|.*refs/tags/||")`,
        'if [ -n "$TAG" ]; then',
        '  export FACTORY_VERWACHTE_VERSIE="${TAG#v}"',
        `  if npm install -g "https://codeload.github.com/${EIGENAAR}/factory/tar.gz/refs/tags/$TAG" >/dev/null 2>/dev/null; then`,
        '    echo "==> factory bijgewerkt naar $TAG"',
        '  else',
        '    echo "WARNING bijwerken naar $TAG mislukt; nacht draait op de huidige versie"',
        '  fi',
        'else',
        '  echo "WARNING kon de nieuwste tag niet ophalen; nacht draait op de huidige versie"',
        'fi',
        `exec ${opzet.nachtCommando}`,
    ].join('\n');
}
/**
 * De versie van de draaiende factory-bin, uit het eigen `package.json`.
 *
 * Dit is het antwoord op "met welke versie draaide de nacht" (#237): het staat in
 * het runlog, zodat je 's ochtends in één blik ziet of het bijwerken gewerkt heeft.
 * Een onleesbare versie is geen reden om de nacht over te slaan; vandaar 'onbekend'.
 */
export function eigenVersie() {
    try {
        const pj = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
        return typeof pj === 'object' && pj !== null && 'version' in pj
            ? String(pj.version)
            : 'onbekend';
    }
    catch {
        return 'onbekend';
    }
}
/**
 * De nieuwste release-tag van de factory, waaruit de globale bin geïnstalleerd wordt.
 *
 * De tag en niet `package.json` op main: de tag is de bron van waarheid over "wat is
 * de laatste release", en main's versie kan tijdelijk achterlopen terwijl de
 * release-PR nog in de lucht is (dezelfde reden als in `release.yml`, zie #132).
 */
export function nieuwsteTag(cwd) {
    run('git', ['fetch', '--tags', '--force', 'origin'], { cwd, capture: true, toleranter: true });
    const tags = uitvoerVan('git', ['tag', '--list', 'v*', '--sort=-v:refname'], cwd);
    const tag = tags?.split('\n')[0]?.trim();
    if (tag === undefined || tag === '') {
        throw new GebruikersFout('Geen release-tag (v*) gevonden; er is niets om globaal te installeren.');
    }
    return tag;
}
/**
 * Zet de LaunchAgent op. Idempotent: een bestaande agent wordt eerst ontladen en dan
 * vers geladen, en een bestaand instellingenbestand blijft ongemoeid.
 */
function installeerAgent(paden) {
    const cwd = process.cwd();
    if (!isBacklogRepo(cwd)) {
        // De globale bin komt uit de tags van dít repo; buiten de factory zou hij uit een
        // ander repo geïnstalleerd worden, of uit niets.
        throw new GebruikersFout('Draai dit in de factory-repo: de globale bin komt uit de release-tags daarvan.');
    }
    kop('Instellingen en token');
    zorgVoorEnvBestand(paden);
    const instellingen = leesInstellingen(paden);
    // Vóór de install en niet erna: een geladen agent zonder token draait vannacht een
    // ronde die op niets uitloopt, en dat merk je dan pas morgen.
    vereisToken(instellingen, paden);
    ok(`dagmaximum ${String(instellingen.dagmaximum)}, budget $${String(instellingen.budgetPerRun)} per run (${paden.envPad}).`);
    kop('Factory globaal installeren');
    const tag = nieuwsteTag(cwd);
    const versie = tag.replace(/^v/, '');
    const globaal = globaleFactoryVersie();
    if (globaal !== undefined && minstensVersie(globaal, versie)) {
        ok(`factory ${globaal} staat al globaal (≥ ${versie}); install overgeslagen.`);
    }
    else {
        run('npm', ['install', '-g', `https://codeload.github.com/${EIGENAAR}/factory/tar.gz/refs/tags/${tag}`], {
            capture: true,
        });
        ok(`factory ${versie} globaal geïnstalleerd.`);
    }
    const prefix = uitvoerVan('npm', ['prefix', '-g'], cwd) ?? '/usr/local';
    const bin = path.join(prefix, 'bin', 'factory');
    vereisNachtModus(bin);
    kop('LaunchAgent laden');
    const pad = paden.agentPad;
    mkdirSync(path.dirname(pad), { recursive: true });
    writeFileSync(pad, bouwOrkestreerPlist({
        bin,
        werkmap: os.homedir(),
        logPad: paden.logPad,
        label: LAUNCH_LABEL,
        uur: NACHT_UUR,
        minuut: 0,
        nachtCommando: `"${bin}" orkestreer --nacht`,
    }));
    run('launchctl', ['unload', pad], { toleranter: true, capture: true });
    run('launchctl', ['load', pad]);
    schrijfLog(paden, `${new Date(Date.now()).toISOString()} agent geladen (${tag}, ${bin})`);
    ok(`geladen; \`factory orkestreer --nacht\` draait elke nacht om ${String(NACHT_UUR).padStart(2, '0')}:00 (log: ${paden.logPad}).`);
}
/**
 * Weigert een agent te plannen op een bin die `--nacht` niet kent.
 *
 * De globale bin komt uit de nieuwste **tag**, en die loopt per definitie achter op de
 * branch waarin `--nacht` net gebouwd is: installeer je voordat deze slice gereleased
 * is, dan staat er een agent klaar die om 04:00 afketst op "Onbekend commando" — in een
 * log dat je pas dagen later leest. Dit is precies het soort stille misstand als het
 * ontbrekende `PROJECT_TOKEN` uit #195, dus hij hoort hier hard te falen.
 */
export function vereisNachtModus(bin) {
    const hulp = uitvoerVan(bin, ['help']) ?? '';
    if (hulp.includes('--nacht')) {
        return;
    }
    throw new GebruikersFout(`De globale factory (${bin}) kent \`orkestreer --nacht\` niet.\n` +
        '  Die zit in een release die er nog niet is; een agent hierop afketst vannacht stil.\n' +
        '  Lever deze slice eerst in en laat hem releasen, en draai daarna opnieuw:\n' +
        '    factory orkestreer --installeer');
}
/** Haalt de LaunchAgent weg. Idempotent: staat hij er niet, dan is dit een no-op. */
function verwijderAgent(paden) {
    kop('LaunchAgent verwijderen');
    const pad = paden.agentPad;
    run('launchctl', ['unload', pad], { toleranter: true, capture: true });
    rmSync(pad, { force: true });
    ok('verwijderd; er draait niets meer vanzelf.');
}
//# sourceMappingURL=orkestreer.js.map