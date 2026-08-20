import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bordItems, ESCALATIE_LABEL, plaatsComment, zetKolom, zetLabel, zorgVoorEscalatieLabel, } from '../board.js';
import { leesInstellingen, standaardPaden, } from '../orkestrator-instellingen.js';
import { templatesDir } from '../paths.js';
import { GebruikersFout, kop, ok, waarschuwing } from '../shell.js';
import { draaiBouwer } from '../werker.js';
import { buitenDocumenten, versWerkplaats, werkplaatsWortel } from '../werkplaats.js';
import { inleveren } from './inleveren.js';
import { werkplek } from './werkplek.js';
/**
 * De tweede taaksoort: een werker die bouwt in plaats van refinet (#164, slice #182).
 *
 * Deze slice levert alleen `--dry`: de wachtrij van bouwbare items en het bouwplan voor
 * de kop ervan. Er wordt niets geschreven — geen bordmutatie, geen worktree, geen PR,
 * geen `claude`-run. De rem in deze fase is dat niets dit aanroept behalve ik.
 */
/** Waar de bouw-werker uit put. */
const BOUW_KOLOM = 'Klaar voor Bouwen';
/** De kolom die "iemand werkt hieraan" betekent; een item dáár is geclaimd. */
const GECLAIMD_KOLOM = 'Bouwen';
/** Alleen kleine klussen. Een epic is geen bouwopdracht, en een slice hoort bij zijn epic. */
const BOUWBARE_SOORTEN = ['type:bug', 'type:task'];
const EIGENAAR = 'gjvv13';
/** Eén model voor alle onbemande werkers — zie het modelkeuze-besluit in #104. */
const MODEL = 'claude-opus-4-6';
/**
 * Waar de bouw-werker zijn worktree neerzet.
 *
 * Niet `factory werkplek`'s pad (`../<repo>-wt/<issue>`, naast de werkkopie), want dat
 * ligt in `~/Documents` en daar komt een onbemande werker niet — TCC houdt hem buiten en
 * er lopen parallelle sessies in. Vandaar dezelfde wortel als de spiegels, met `-wt`
 * erachter zodat een worktree nooit met een spiegel te verwarren is.
 */
export function bouwWerkplek(app, issue, wortel = werkplaatsWortel) {
    return path.join(wortel, `${app}-wt`, String(issue));
}
/** De branch die de werker zou maken; `-1` zoals #128 hem herkent. */
export function bouwBranch(issue) {
    return `slice/${String(issue)}-1`;
}
/**
 * De bouw-wachtrij uit één board-lezing: open items op **Klaar voor Bouwen** die klein
 * genoeg zijn, niet geclaimd, niet geëscaleerd en geen slice onder een epic.
 *
 * Alles komt uit dezelfde lezing — labels en de ouder-relatie zitten sinds #182 in de
 * board-query. Een filter dat per item een tweede aanroep doet zou het GraphQL-budget
 * opeten dat #104 juist bewaakt.
 */
export function bouwWachtrij(items) {
    const bruikbaar = [];
    for (const item of items) {
        if (item.kolom !== BOUW_KOLOM) {
            continue;
        }
        if (!BOUWBARE_SOORTEN.some((soort) => item.labels.includes(soort))) {
            continue;
        }
        if (item.labels.includes(ESCALATIE_LABEL)) {
            continue;
        }
        if (item.ouder !== undefined) {
            // Een slice hoort bij zijn ouder: die wordt in de volgorde van dat epic gebouwd,
            // niet los opgepikt omdat hij toevallig vooraan staat.
            //
            // Bewust "heeft een ouder" en niet "heeft een ouder mét type:epic", ook al vraagt
            // #182 het laatste. Gemeten op 2026-08-20: `bordItems` slaat items zonder
            // Status-waarde over, en de epics #164, #169 en #171 hebben die niet — ze zijn dus
            // onzichtbaar in dezelfde lezing waarin we hun kinderen zien. Een filter dat de
            // ouder moet kunnen opzoeken liet daardoor zes slices in de bouw-wachtrij staan.
            // Deze vorm is strikter en kan niet stil falen; een kind van een niet-epic bestaat
            // op deze backlog niet, en zou óók bij zijn ouder horen.
            continue;
        }
        if (item.app === undefined || item.app === '') {
            // Niet stil overslaan, net als in #153: zonder App weet de werker niet welke code
            // hij moet lezen, en een item dat nooit aan de beurt komt zonder dat iemand het
            // merkt is erger dan een item dat overgeslagen wordt met een melding.
            waarschuwing(`#${String(item.issue)} heeft geen App-veld — overgeslagen.`);
            continue;
        }
        bruikbaar.push({ ...item, app: item.app });
    }
    return bruikbaar;
}
/**
 * Draait de bouw-taaksoort. In deze slice bestaat alleen `--dry`: alles wat er te zien
 * valt vóórdat er iets gebeurt.
 */
export function orkestreerBouw(opties = {}) {
    if (opties.dry === true && opties.eenmalig === true) {
        throw new GebruikersFout('--dry en --eenmalig sluiten elkaar uit; kies er één.');
    }
    if (opties.dry !== true && opties.eenmalig !== true) {
        // Geen stille default naar bouwen: een commando dat zonder vlag een werker met
        // schrijfrechten start is precies de verrassing die deze epic wil vermijden.
        throw new GebruikersFout('Gebruik: factory orkestreer --soort bouw --dry (tonen) of --eenmalig (één item bouwen).');
    }
    const cwd = process.cwd();
    const items = bordItems(cwd);
    if (items === undefined) {
        throw new GebruikersFout('Kon het board niet lezen; zonder wachtrij is er niets te doen.\n' +
            '  Controleer je gh-auth (`gh auth status`) en de GraphQL-limiet\n' +
            '  (`gh api rate_limit --jq .resources.graphql`).');
    }
    const wortel = opties.werkplaatsWortel ?? werkplaatsWortel;
    const instellingen = leesInstellingen(opties.paden ?? standaardPaden());
    const wachtrij = bouwWachtrij(items);
    const geclaimd = items.filter((item) => item.kolom === GECLAIMD_KOLOM).length;
    kop(`Bouw-wachtrij: ${BOUW_KOLOM}`);
    if (wachtrij.length === 0) {
        ok('niets te bouwen');
        return;
    }
    for (const item of wachtrij) {
        const nummer = `#${String(item.issue)}`.padEnd(6);
        process.stdout.write(`  ${nummer} ${item.app.padEnd(12)} ${item.titel}\n`);
    }
    if (geclaimd > 0) {
        // Zichtbaar maken wat er buiten de rij valt: een geclaimd item is niet vergeten
        // maar in behandeling, en dat wil je kunnen zien zonder het board te openen.
        ok(`${String(geclaimd)} item(s) staan op ${GECLAIMD_KOLOM} en zijn dus geclaimd.`);
    }
    const eerste = wachtrij[0];
    if (eerste === undefined) {
        return;
    }
    const werkplekPad = bouwWerkplek(eerste.app, eerste.issue, wortel);
    if (!buitenDocumenten(werkplekPad)) {
        // Onbereikbaar zolang de wortel in $HOME ligt, maar dit is de aanname waar de hele
        // opzet op rust; als iemand het pad verlegt moet dat luid falen.
        throw new GebruikersFout(`Werkplek ${werkplekPad} ligt binnen ~/Documents; dat mag niet.`);
    }
    if (opties.dry === true) {
        process.stdout.write(`\nZou nu bouwen: #${String(eerste.issue)} (${eerste.app}) — ${eerste.titel}\n` +
            `  werkplek: ${werkplekPad}\n` +
            `  branch:   ${bouwBranch(eerste.issue)}\n` +
            `  budget:   $${String(instellingen.bouwBudgetPerRun)} voor deze run\n` +
            `Er is niets geschreven — niet naar GitHub, niet naar de werkplaats en niet naar een worktree.\n`);
        return;
    }
    bouwAf(eerste, cwd, wortel, instellingen.bouwBudgetPerRun, opties.leverIn ?? inleveren);
}
/** De prompt voor de bouw-werker: het sjabloon met de feiten die hij niet mag opzoeken. */
export function bouwPrompt(item, werkmap, factoryMap) {
    const sjabloon = readFileSync(path.join(templatesDir, 'werker-bouw.md'), 'utf8');
    const vervang = {
        '{{ISSUE}}': String(item.issue),
        '{{TITEL}}': item.titel,
        '{{APP}}': item.app,
        '{{BRANCH}}': bouwBranch(item.issue),
        '{{WERKMAP}}': werkmap,
        '{{FACTORY_MAP}}': factoryMap,
    };
    return Object.entries(vervang).reduce((tekst, [sleutel, waarde]) => tekst.split(sleutel).join(waarde), sjabloon);
}
/**
 * Bouwt één item af: claimen, worktree maken, werker draaien, inleveren of escaleren.
 *
 * De claim gaat vóór alles wat geld kost: een tweede werker of een `/bouw`-sessie in de
 * chat kent dit slot niet, en twee werkers op één item leveren twee branches op waarvan
 * er één weg moet.
 */
function bouwAf(item, cwd, wortel, budgetUsd, leverIn) {
    kop(`#${String(item.issue)} — ${item.titel}`);
    zorgVoorEscalatieLabel(cwd);
    zetKolom(item.issue, GECLAIMD_KOLOM, cwd);
    // Valt de run om, dan hoort het item terug in de rij: geclaimd blijven staan zonder
    // dat er iemand aan werkt is precies hoe een item onvindbaar wordt (de les van #153).
    const terug = () => {
        zetKolom(item.issue, BOUW_KOLOM, cwd);
    };
    let uitkomst;
    try {
        const spiegel = versWerkplaats(item.app, EIGENAAR, wortel);
        const factoryMap = versWerkplaats('factory', EIGENAAR, wortel);
        // Via `factory werkplek` en niet met een eigen `git worktree add`: dan geldt hier
        // dezelfde padconventie en dezelfde branchnaam als voor een menselijke sessie, en
        // `inleveren` ruimt de werkplek achteraf op de manier die hij al kent.
        werkplek(String(item.issue), { cwd: spiegel });
        const werkmap = bouwWerkplek(item.app, item.issue, wortel);
        uitkomst = draaiBouwer({
            prompt: bouwPrompt(item, werkmap, factoryMap),
            werkmap,
            sessie: randomUUID(),
            extraMappen: [factoryMap],
            budgetUsd,
            model: MODEL,
        });
    }
    catch (fout) {
        terug();
        throw fout;
    }
    verwerkBouw(item, uitkomst, cwd, wortel, leverIn);
}
/** Vertaalt de uitkomst van de bouw-werker naar wat er op GitHub gebeurt. */
function verwerkBouw(item, uitkomst, cwd, wortel, leverIn) {
    const voetnoot = `<sub>${[
        uitkomst.kosten === undefined ? undefined : `$${uitkomst.kosten.toFixed(2)}`,
        uitkomst.beurten === undefined ? undefined : `${String(uitkomst.beurten)} beurten`,
        uitkomst.weigeringen > 0 ? `${String(uitkomst.weigeringen)}× geweigerd` : undefined,
    ]
        .filter((deel) => deel !== undefined)
        .join(' · ')}</sub>\n` +
        `<!-- orkestrator: sessie=${uitkomst.sessie} werkmap=${bouwWerkplek(item.app, item.issue, wortel)} -->`;
    if (uitkomst.afloop === 'mislukt') {
        // Een `is_error: true` bij exit 0 landt hier: geen PR, geen afvink-comment. Terug in
        // de rij met een label, zodat dezelfde fout niet vannacht opnieuw draait.
        blokkeer(item, cwd);
        plaatsComment(item.issue, `**Bouw-run mislukt.** ${uitkomst.fout ?? 'onbekende fout'}\n\n${voetnoot}`, cwd);
        waarschuwing(`#${String(item.issue)} mislukt: ${uitkomst.fout ?? 'onbekende fout'}`);
        return;
    }
    const verdict = uitkomst.verdict;
    if (verdict?.uitkomst === 'escalatie') {
        blokkeer(item, cwd);
        plaatsComment(item.issue, `**Escalatie tijdens het bouwen.**\n\n**Vraag:** ${verdict.vraag}\n\n` +
            `**Advies:** ${verdict.advies}\n\nEr is niets ingeleverd.\n\n${voetnoot}`, cwd);
        ok(`#${String(item.issue)} geëscaleerd — niets ingeleverd.`);
        return;
    }
    if (verdict?.uitkomst !== 'klaar') {
        blokkeer(item, cwd);
        waarschuwing(`#${String(item.issue)} gaf geen bruikbare uitkomst.`);
        return;
    }
    // Inleveren doet de rest: poort draaien, pushen, PR openen, het item naar Uitrollen
    // schuiven (#128) en de werkplek opruimen. Zonder auto-merge, want deze werker mag
    // code voorstellen en niet landen.
    const werkmap = bouwWerkplek(item.app, item.issue, wortel);
    plaatsComment(item.issue, `**Gebouwd door een onbemande werker.**\n\n${verdict.samenvatting}\n\n` +
        `| Acceptatiecriterium | Bewijs |\n| --- | --- |\n` +
        verdict.criteria.map((regel) => `| ${regel.criterium} | ${regel.bewijs} |`).join('\n') +
        `\n\nDe PR staat open **zonder auto-merge**; mergen is jouw beslissing.\n\n${voetnoot}`, cwd);
    leverIn({ cwd: werkmap, geenAutomerge: true });
    ok(`#${String(item.issue)} gebouwd en ingeleverd zonder auto-merge.`);
}
/** Zet een item stil: terug in de bouw-wachtrij, met het label dat het overslaat. */
function blokkeer(item, cwd) {
    zetKolom(item.issue, BOUW_KOLOM, cwd);
    zetLabel(item.issue, ESCALATIE_LABEL, cwd);
}
/** Of het opgegeven `--soort` bestaat, en welke. Onbekend is een fout, geen stille default. */
export function leesSoort(waarde) {
    if (waarde === undefined || waarde === 'refine') {
        return 'refine';
    }
    if (waarde === 'bouw') {
        return 'bouw';
    }
    throw new GebruikersFout(`Onbekende --soort '${waarde}'. Kies: refine (default) of bouw.`);
}
//# sourceMappingURL=orkestreer-bouw.js.map