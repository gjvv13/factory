import path from 'node:path';
import { bordItems, ESCALATIE_LABEL } from '../board.js';
import { leesInstellingen, standaardPaden, } from '../orkestrator-instellingen.js';
import { GebruikersFout, kop, ok, waarschuwing } from '../shell.js';
import { buitenDocumenten, werkplaatsWortel } from '../werkplaats.js';
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
    if (opties.dry !== true) {
        // Bewust geen stille default naar bouwen. `--eenmalig` komt in #183; tot dan is een
        // commando dat zonder vlag een werker met schrijfrechten start precies de
        // verrassing die deze epic wil vermijden.
        throw new GebruikersFout('Gebruik: factory orkestreer --soort bouw --dry (tonen). Bouwen zelf komt in #183.');
    }
    const items = bordItems(process.cwd());
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
    const werkplek = bouwWerkplek(eerste.app, eerste.issue, wortel);
    if (!buitenDocumenten(werkplek)) {
        // Onbereikbaar zolang de wortel in $HOME ligt, maar dit is de aanname waar de hele
        // opzet op rust; als iemand het pad verlegt moet dat luid falen.
        throw new GebruikersFout(`Werkplek ${werkplek} ligt binnen ~/Documents; dat mag niet.`);
    }
    process.stdout.write(`\nZou nu bouwen: #${String(eerste.issue)} (${eerste.app}) — ${eerste.titel}\n` +
        `  werkplek: ${werkplek}\n` +
        `  branch:   ${bouwBranch(eerste.issue)}\n` +
        `  budget:   $${String(instellingen.bouwBudgetPerRun)} voor deze run\n` +
        `Er is niets geschreven — niet naar GitHub, niet naar de werkplaats en niet naar een worktree.\n`);
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