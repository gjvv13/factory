import { randomUUID } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bordItems, escalaties, ESCALATIE_LABEL, haalLabelWeg, laatsteOrkestratorComment, plaatsComment, schrijfBody, wachtrijVan, zetKolom, zetLabel, zorgVoorEscalatieLabel, } from '../board.js';
import { templatesDir } from '../paths.js';
import { GebruikersFout, kop, ok, waarschuwing } from '../shell.js';
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
/** Harde kostenrem per run. Wordt overschreden voordat hij afkapt, dus ruim nemen. */
const BUDGET_USD = 4;
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
    if (opties.dry === true && opties.eenmalig === true) {
        // Stil één van de twee kiezen laat iemand denken dat de run gestart is.
        throw new GebruikersFout('--dry en --eenmalig sluiten elkaar uit; kies er één.');
    }
    if (opties.dry !== true && opties.eenmalig !== true) {
        // Er is in deze fase nog geen automatiek. Een kaal commando dat tóch een werker
        // start is precies het soort verrassing dat je bij onbemand werk niet wilt.
        throw new GebruikersFout('Gebruik: factory orkestreer --dry (tonen) of factory orkestreer --eenmalig (één item).');
    }
    const cwd = process.cwd();
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
        process.stdout.write(`\nZou nu draaien: #${String(eerste.issue)} (${eerste.app}), in ${werkplaatsVan(eerste.app, opties.werkplaatsWortel ?? werkplaatsWortel)}.\n` +
            `Er is niets geschreven — niet naar GitHub en niet naar de werkplaats.\n`);
        return;
    }
    if (!neemLock()) {
        throw new GebruikersFout(`Er draait al een orkestrator-run (${LOCK_PAD}).\n` +
            '  Wacht tot die klaar is, of verwijder het slot als er zeker niets meer draait.');
    }
    try {
        werkAf(eerste, cwd, opties.werkplaatsWortel ?? werkplaatsWortel);
    }
    finally {
        geefLockVrij();
    }
}
/** Werkt één item af: werkplaats verversen, werker draaien, uitkomst verwerken. */
function werkAf(item, cwd, wortel) {
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
            budgetUsd: BUDGET_USD,
            model: MODEL,
        });
        verwerk(item, uitkomst, werkmap, cwd);
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
/** Vertaalt de uitkomst van de werker naar wat er op GitHub gebeurt. */
function verwerk(item, uitkomst, werkmap, cwd) {
    if (uitkomst.afloop === 'mislukt') {
        // Escalatie, niet opnieuw proberen: dezelfde fout elke nacht opnieuw draaien kost
        // geld en levert niets op. Terug in de wachtrij-kolom, want er wordt niet aan
        // gewerkt — het label houdt hem daar uit de rij tot jij hem beantwoordt.
        blokkeer(item, cwd);
        plaatsComment(item.issue, `**Run mislukt.** ${uitkomst.fout ?? 'onbekende fout'}\n\n${voetnoot(uitkomst, werkmap)}`, cwd);
        waarschuwing(`#${String(item.issue)} mislukt: ${uitkomst.fout ?? 'onbekende fout'}`);
        return;
    }
    const verdict = uitkomst.verdict;
    if (verdict?.uitkomst === 'escalatie') {
        blokkeer(item, cwd);
        plaatsComment(item.issue, escalatieComment(item.issue, verdict.vraag, verdict.advies, uitkomst, werkmap), cwd);
        ok(`#${String(item.issue)} geëscaleerd — beantwoorden met: factory orkestreer antwoord ${String(item.issue)} "…"`);
        return;
    }
    if (verdict?.uitkomst !== 'klaar') {
        // Onbereikbaar zolang `afloop` en `verdict` uit dezelfde bron komen, maar het
        // alternatief is stil doorgaan met een lege body.
        waarschuwing(`#${String(item.issue)} gaf geen bruikbare uitwerking.`);
        return;
    }
    rondAf(item.issue, verdict.body, verdict.samenvatting, verdict.slices, uitkomst, werkmap, cwd);
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
        return;
    }
    zetKolom(issue, WERK_KOLOM, cwd);
    haalLabelWeg(issue, ESCALATIE_LABEL, cwd);
    plaatsComment(issue, `**Technisch uitgewerkt** (${String(slices)} slice${slices === 1 ? '' : 's'}).\n\n` +
        `${samenvatting}\n\nHet item staat op **${WERK_KOLOM}** en wacht op je akkoord; ` +
        `dat akkoord is het verplaatsen naar **Klaar voor Bouwen**.\n\n${voetnoot(uitkomst, werkmap)}`, cwd);
    ok(`#${String(issue)} uitgewerkt en op ${WERK_KOLOM}`);
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
        const comment = laatsteOrkestratorComment(item.issue, MARKERING, cwd);
        const escalatie = comment === undefined ? undefined : leesEscalatie(comment);
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
    const comment = laatsteOrkestratorComment(issue, MARKERING, cwd);
    const escalatie = comment === undefined ? undefined : leesEscalatie(comment);
    if (escalatie === undefined) {
        throw new GebruikersFout(`Geen escalatie gevonden op #${String(issue)}.\n` +
            '  Er staat geen orkestrator-comment met een sessie-markering; er valt dus niets te hervatten.');
    }
    kop(`Antwoord op #${String(issue)}`);
    const uitkomst = draaiWerker({
        prompt: vervolgPrompt(escalatie, tekst),
        werkmap: escalatie.werkmap,
        sessie: escalatie.sessie,
        budgetUsd: BUDGET_USD,
        model: MODEL,
        ...(opties.opnieuw === true ? {} : { hervat: true }),
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
/** De prompt waarmee de sessie hervat wordt: jouw antwoord, en verder niets nieuws. */
function vervolgPrompt(escalatie, tekst) {
    return (`Antwoord op je vraag "${escalatie.vraag}":\n\n${tekst}\n\n` +
        'Werk hiermee verder en geef opnieuw een verdict. Loop vóór je antwoord de gesloten ' +
        'lijst uit de onbemand-werken-skill nog een keer langs; kom je er nog een tegen, dan ' +
        'escaleer je opnieuw in plaats van hem zelf op te lossen.');
}
//# sourceMappingURL=orkestreer.js.map