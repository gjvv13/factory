import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bordItems, escalaties, ESCALATIE_LABEL, isBacklogRepo, haalLabelWeg, orkestratorComments, plaatsComment, schrijfBody, wachtrijVan, zetKolom, zetLabel, zorgVoorEscalatieLabel, } from '../board.js';
import { boekRun, kalenderdag, LAUNCH_LABEL, leesInstellingen, leesStaat, logRun, schrijfLog, standaardPaden, TOKEN_SLEUTEL, vereisToken, zorgVoorEnvBestand, } from '../orkestrator-instellingen.js';
import { templatesDir } from '../paths.js';
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
function neemLock() {
    try {
        if (Date.now() - statSync(LOCK_PAD).mtimeMs > LOCK_VERVALT_MS) {
            rmSync(LOCK_PAD);
        }
    }
    catch {
        // Geen bestaand slot — prima.
    }
    try {
        // `wx` is atomair: faalt als het bestand al bestaat, dus twee runs racen niet.
        closeSync(openSync(LOCK_PAD, 'wx'));
        return true;
    }
    catch {
        return false;
    }
}
function geefLockVrij() {
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
export function bouwPrompt(item, werkmap, factoryMap) {
    const sjabloon = readFileSync(path.join(templatesDir, 'werker-refine.md'), 'utf8');
    const vervang = {
        '{{ISSUE}}': String(item.issue),
        '{{TITEL}}': item.titel,
        '{{APP}}': item.app,
        '{{KOLOM}}': WERK_KOLOM,
        '{{WERKMAP}}': werkmap,
        '{{FACTORY_MAP}}': factoryMap,
    };
    return Object.entries(vervang).reduce((tekst, [sleutel, waarde]) => tekst.split(sleutel).join(waarde), sjabloon);
}
/** Draait de supervisor. Zie `factory help` voor de vlaggen. */
export function orkestreer(opties = {}) {
    const paden = opties.paden ?? standaardPaden();
    if (opties.installeer === true) {
        installeerAgent(paden);
        return;
    }
    if (opties.verwijder === true) {
        verwijderAgent(paden);
        return;
    }
    const modi = [opties.dry, opties.eenmalig, opties.nacht].filter((modus) => modus === true);
    if (modi.length > 1) {
        // Stil één van de modi kiezen laat iemand denken dat de run gestart is.
        throw new GebruikersFout('--dry, --eenmalig en --nacht sluiten elkaar uit; kies er één.');
    }
    if (modi.length === 0) {
        // Een kaal commando dat tóch een werker start is precies het soort verrassing dat
        // je bij onbemand werk niet wilt — ook nu er een LaunchAgent bestaat die het wél
        // vanzelf doet. Die staat in de plist als `--nacht`, expliciet en na te lezen.
        throw new GebruikersFout('Gebruik: factory orkestreer --dry (tonen), --eenmalig (één item) of --nacht (tot het dagmaximum).');
    }
    const cwd = process.cwd();
    const wortel = opties.werkplaatsWortel ?? werkplaatsWortel;
    if (opties.nacht === true) {
        draaiNacht(cwd, wortel, paden, opties.nu ?? new Date(Date.now()));
        return;
    }
    const wachtrij = bouwWachtrij(cwd);
    kop(`Wachtrij: ${WACHTRIJ_KOLOM}`);
    if (wachtrij.length === 0) {
        ok('niets te doen');
        return;
    }
    for (const item of wachtrij) {
        const nummer = `#${String(item.issue)}`.padEnd(6);
        process.stdout.write(`  ${nummer} ${item.app.padEnd(12)} ${item.titel}\n`);
    }
    const eerste = wachtrij[0];
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
        throw new GebruikersFout(`Er draait al een orkestrator-run (${LOCK_PAD}).\n` +
            '  Wacht tot die klaar is, of verwijder het slot als er zeker niets meer draait.');
    }
    try {
        // Met de hand: het budget uit de instellingen, maar geen token vereist — dan draait
        // `claude` op de gewone keychain-auth van de terminal waarin je dit typt.
        werkAf(eerste, cwd, wortel, { budgetUsd: leesInstellingen(paden).budgetPerRun });
    }
    finally {
        geefLockVrij();
    }
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
function draaiNacht(cwd, wortel, paden, nu) {
    const instellingen = leesInstellingen(paden);
    // De token eerst: een nacht die pas bij de eerste `claude`-aanroep struikelt heeft
    // dan al een item uit de wachtrij gehaald en een kolom verzet.
    const token = vereisToken(instellingen, paden);
    const draaiOpties = {
        budgetUsd: instellingen.budgetPerRun,
        env: { ...process.env, [TOKEN_SLEUTEL]: token },
    };
    kop(`Nacht van ${kalenderdag(nu)}`);
    let gestart = leesStaat(paden, nu).gestart;
    if (gestart >= instellingen.dagmaximum) {
        // Meerdere runs op één kalenderdag delen hetzelfde maximum; anders is een handmatige
        // extra run 's avonds een gratis verdubbeling van wat ik moet beoordelen.
        ok(`dagmaximum al bereikt (${String(gestart)}/${String(instellingen.dagmaximum)}); niets gedaan.`);
        return;
    }
    if (!neemLock()) {
        throw new GebruikersFout(`Er draait al een orkestrator-run (${LOCK_PAD}).`);
    }
    const gedaan = new Set();
    try {
        while (gestart < instellingen.dagmaximum) {
            const eerste = bouwWachtrij(cwd)[0];
            if (eerste === undefined) {
                ok('wachtrij leeg; klaar voor vannacht.');
                break;
            }
            // Vangnet tegen een lus, zoals `integreer` dat ook heeft. Een geslaagde run haalt
            // het item normaal uit de wachtrij-kolom, maar `zetKolom` faalt zacht — een
            // board-hik of een opgesoupeerd GraphQL-budget is genoeg. Dan zou de nacht
            // hetzelfde issue tot vier keer refinen: vier keer betalen voor één uitwerking.
            if (gedaan.has(eerste.issue)) {
                waarschuwing(`#${String(eerste.issue)} staat na de run nog in de wachtrij; gestopt om een lus te voorkomen.`);
                break;
            }
            gedaan.add(eerste.issue);
            // Boeken vóór de run: een run die omvalt heeft wél geld gekost.
            gestart = boekRun(paden, nu);
            let uitkomst;
            try {
                uitkomst = werkAf(eerste, cwd, wortel, draaiOpties);
            }
            catch (fout) {
                // Ook een run die de CLI omvertrekt hoort in het log. Anders staat de teller op
                // 1 en het log op niets, en dat is precies de stilte die je 's ochtends niet
                // kunt lezen. Daarna alsnog doorgooien: dit is een probleem van de machine, en
                // elke volgende run loopt er net zo goed op stuk.
                logRun(paden, new Date(Date.now()), {
                    issue: eerste.issue,
                    app: eerste.app,
                    uitkomst: `afgebroken (${fout instanceof Error ? (fout.message.split('\n')[0] ?? '') : String(fout)})`,
                });
                throw fout;
            }
            logRun(paden, new Date(Date.now()), {
                issue: eerste.issue,
                app: eerste.app,
                uitkomst: uitkomst.afloop,
                ...(uitkomst.kosten === undefined ? {} : { kosten: uitkomst.kosten }),
                ...(uitkomst.beurten === undefined ? {} : { beurten: uitkomst.beurten }),
            });
            ok(`${String(gestart)}/${String(instellingen.dagmaximum)} van vannacht gedaan.`);
        }
    }
    finally {
        geefLockVrij();
    }
}
/** Werkt één item af: werkplaats verversen, werker draaien, uitkomst verwerken. */
function werkAf(item, cwd, wortel, draai) {
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
        const uitkomst = draaiWerker({
            prompt: bouwPrompt(item, werkmap, factoryMap),
            werkmap,
            sessie,
            extraMappen: [factoryMap],
            budgetUsd: draai.budgetUsd,
            model: MODEL,
            ...(draai.env === undefined ? {} : { env: draai.env }),
        });
        // De afloop komt uit `verwerk` en niet uit de werker: schrijft de body niet weg,
        // dan is 'klaar' onwaar, en het log hoort te zeggen wat er echt gebeurde.
        return {
            afloop: verwerk(item, uitkomst, werkmap, cwd),
            ...(uitkomst.kosten === undefined ? {} : { kosten: uitkomst.kosten }),
            ...(uitkomst.beurten === undefined ? {} : { beurten: uitkomst.beurten }),
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
export function escalatieComment(issue, vraag, advies, uitkomst, werkmap) {
    return (`**Escalatie.**\n\n` +
        `${VRAAG_MERK}\n**Vraag:** ${vraag}\n${VRAAG_EIND}\n\n` +
        `${ADVIES_MERK}\n**Advies:** ${advies}\n${ADVIES_EIND}\n\n` +
        `Antwoorden: \`factory orkestreer antwoord ${String(issue)} "<jouw keuze>"\`\n\n` +
        voetnoot(uitkomst, werkmap));
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
/** Leest een escalatie terug uit de comment die `escalatieComment` schreef. */
export function leesEscalatie(comment) {
    const sessie = /<!-- orkestrator: sessie=([^\s]+) werkmap=(.+?) -->/.exec(comment);
    if (sessie?.[1] === undefined || sessie[2] === undefined) {
        return undefined;
    }
    const vraag = tussen(comment, VRAAG_MERK, VRAAG_EIND);
    const advies = tussen(comment, ADVIES_MERK, ADVIES_EIND);
    if (vraag === undefined || advies === undefined) {
        return undefined;
    }
    return { vraag, advies, sessie: sessie[1], werkmap: sessie[2] };
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
function voetnoot(uitkomst, werkmap) {
    const delen = [
        uitkomst.kosten === undefined ? undefined : `$${uitkomst.kosten.toFixed(2)}`,
        uitkomst.beurten === undefined ? undefined : `${String(uitkomst.beurten)} beurten`,
        uitkomst.weigeringen > 0 ? `${String(uitkomst.weigeringen)}× geweigerd` : undefined,
    ].filter((deel) => deel !== undefined);
    return (`<sub>${delen.join(' · ')}</sub>\n` +
        `<!-- orkestrator: sessie=${uitkomst.sessie} werkmap=${werkmap} -->`);
}
// --- status: wat wacht er op mij ---------------------------------------------
/**
 * Toont in één blik waar iedereen op wacht: op jou, op een antwoord, of op een werker.
 *
 * Eén board-lezing voor alle drie de blokken; het escalatie-blok haalt zijn vraag en
 * advies uit de comment die de orkestrator zelf schreef.
 */
export function orkestreerStatus(cwd) {
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
    const wachtrij = items.filter((item) => item.kolom === WACHTRIJ_KOLOM && !geblokkeerd.has(item.issue));
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
    kop(`Wachtrij: ${WACHTRIJ_KOLOM} (${String(wachtrij.length)})`);
    toonLijst(wachtrij);
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
export function orkestreerAntwoord(issueArgument, tekst, opties = {}, cwd = process.cwd()) {
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
        throw new GebruikersFout(`Er draait al een orkestrator-run (${LOCK_PAD}).`);
    }
    try {
        werkAntwoordAf(issue, tekst, escalatie, opties, cwd);
    }
    finally {
        geefLockVrij();
    }
}
function werkAntwoordAf(issue, tekst, escalatie, opties, cwd) {
    kop(`Antwoord op #${String(issue)}`);
    const opdracht = opties.opnieuw === true
        ? verseOpdracht(issue, tekst, escalatie, cwd, opties.werkplaatsWortel ?? werkplaatsWortel)
        : {
            prompt: vervolgPrompt(escalatie, tekst),
            werkmap: escalatie.werkmap,
            sessie: escalatie.sessie,
            hervat: true,
        };
    const uitkomst = draaiWerker({
        ...opdracht,
        budgetUsd: leesInstellingen(opties.paden ?? standaardPaden()).budgetPerRun,
        model: MODEL,
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
function vervolgPrompt(escalatie, tekst) {
    return (`Antwoord op je vraag "${escalatie.vraag}":\n\n${tekst}\n\n` +
        'Werk hiermee verder en geef opnieuw een verdict. Loop vóór je antwoord de gesloten ' +
        'lijst uit de onbemand-werken-skill nog een keer langs; kom je er nog een tegen, dan ' +
        'escaleer je opnieuw in plaats van hem zelf op te lossen.');
}
// --- De LaunchAgent: één keer per nacht, zonder dat ik een terminal open ------
/** Het uur waarop de nacht draait — 04:00, zoals #104 het schetste. */
const NACHT_UUR = 4;
/**
 * Bouwt de plist die `factory orkestreer --nacht` één keer per nacht draait.
 *
 * Drie keuzes die een lezer zou willen aanvechten:
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
 */
export function bouwOrkestreerPlist(opzet) {
    // De PATH van de installerende shell meebakken: launchd start anders met een kale
    // PATH en vindt node, gh of claude dan niet.
    const pad = process.env.PATH ?? '/usr/bin:/bin';
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opzet.bin}</string>
    <string>orkestreer</string>
    <string>--nacht</string>
  </array>
  <key>WorkingDirectory</key><string>${opzet.werkmap}</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${String(NACHT_UUR)}</integer><key>Minute</key><integer>0</integer></dict>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${pad}</string></dict>
  <key>StandardOutPath</key><string>${opzet.logPad}</string>
  <key>StandardErrorPath</key><string>${opzet.logPad}</string>
</dict>
</plist>
`;
}
/**
 * De nieuwste release-tag van de factory, waaruit de globale bin geïnstalleerd wordt.
 *
 * De tag en niet `package.json` op main: de tag is de bron van waarheid over "wat is
 * de laatste release", en main's versie kan tijdelijk achterlopen terwijl de
 * release-PR nog in de lucht is (dezelfde reden als in `release.yml`, zie #132).
 */
function nieuwsteTag(cwd) {
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
    writeFileSync(pad, bouwOrkestreerPlist({ bin, werkmap: os.homedir(), logPad: paden.logPad }));
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
function vereisNachtModus(bin) {
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