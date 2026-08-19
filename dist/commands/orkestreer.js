import { randomUUID } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { escalaties, ESCALATIE_LABEL, plaatsComment, schrijfBody, wachtrijVan, zetKolom, zetLabel, zorgVoorEscalatieLabel, } from '../board.js';
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
/** Vertaalt de uitkomst van de werker naar wat er op GitHub gebeurt. */
function verwerk(item, uitkomst, werkmap, cwd) {
    const staart = `\n\n${voetnoot(uitkomst, werkmap)}`;
    if (uitkomst.afloop === 'mislukt') {
        // Escalatie, niet opnieuw proberen: dezelfde fout elke nacht opnieuw draaien kost
        // geld en levert niets op.
        zetLabel(item.issue, ESCALATIE_LABEL, cwd);
        plaatsComment(item.issue, `**Run mislukt.** ${uitkomst.fout ?? 'onbekende fout'}${staart}`, cwd);
        waarschuwing(`#${String(item.issue)} mislukt: ${uitkomst.fout ?? 'onbekende fout'}`);
        return;
    }
    const verdict = uitkomst.verdict;
    if (verdict?.uitkomst === 'escalatie') {
        zetLabel(item.issue, ESCALATIE_LABEL, cwd);
        plaatsComment(item.issue, `**Escalatie.**\n\n**Vraag:** ${verdict.vraag}\n\n**Advies:** ${verdict.advies}${staart}`, cwd);
        ok(`#${String(item.issue)} geëscaleerd`);
        return;
    }
    if (verdict?.uitkomst !== 'klaar') {
        // Onbereikbaar zolang `afloop` en `verdict` uit dezelfde bron komen, maar het
        // alternatief is stil doorgaan met een lege body.
        waarschuwing(`#${String(item.issue)} gaf geen bruikbare uitwerking.`);
        return;
    }
    const tijdelijk = mkdtempSync(path.join(os.tmpdir(), 'factory-orkestreer-'));
    const bodyBestand = path.join(tijdelijk, 'body.md');
    writeFileSync(bodyBestand, verdict.body.endsWith('\n') ? verdict.body : `${verdict.body}\n`);
    const geschreven = schrijfBody(item.issue, bodyBestand, cwd);
    rmSync(tijdelijk, { recursive: true, force: true });
    if (!geschreven) {
        // De uitwerking is er wel maar staat nergens; dat is een mislukking, geen succes.
        zetLabel(item.issue, ESCALATIE_LABEL, cwd);
        plaatsComment(item.issue, `**Uitwerking kon niet weggeschreven worden.**${staart}`, cwd);
        return;
    }
    plaatsComment(item.issue, `**Technisch uitgewerkt** (${String(verdict.slices)} slice${verdict.slices === 1 ? '' : 's'}).\n\n` +
        `${verdict.samenvatting}\n\nHet item staat op **${WERK_KOLOM}** en wacht op je akkoord; ` +
        `dat akkoord is het verplaatsen naar **Klaar voor Bouwen**.${staart}`, cwd);
    ok(`#${String(item.issue)} uitgewerkt en op ${WERK_KOLOM}`);
}
/**
 * De voetnoot onder elke comment: kosten, beurten en de sessie.
 *
 * De sessie-markering is niet decoratief — `factory orkestreer antwoord` hervat er
 * later mee, en sessies zijn map-gebonden, dus de werkmap hoort erbij.
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
//# sourceMappingURL=orkestreer.js.map