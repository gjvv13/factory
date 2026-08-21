import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bordItems, ESCALATIE_LABEL, kolomVan, plaatsComment, zetKolom, zetLabel, zorgVoorEscalatieLabel, } from '../board.js';
import { leesInstellingen, metBoekhouding, standaardPaden, } from '../orkestrator-instellingen.js';
import { templatesDir } from '../paths.js';
import { GebruikersFout, kop, ok, waarschuwing } from '../shell.js';
import { draaiBouwer } from '../werker.js';
import { bronMappenVan, bronMomentopname, buitenDocumenten, ruimBronMapOp, versWerkplaats, werkplaatsWortel, } from '../werkplaats.js';
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
 * genoeg zijn, niet geclaimd en niet geëscaleerd.
 *
 * Een slice onder een epic hoort hier wél in. Tot #232 viel die eruit, met het argument
 * dat een slice in de volgorde van zijn epic gebouwd hoort te worden. Dat spreekt #131
 * tegen: de kolom is de bron van waarheid, en een item staat alleen op Klaar voor Bouwen
 * omdat iemand het daar heeft neergezet. Gemeten op 2026-08-21 hield dat filter #184
 * tegen nadat het juist voor de bouw was vrijgegeven — het overruled de beslissing die
 * het board vastlegt. Een epic zélf valt nog steeds af: `type:epic` staat niet in
 * BOUWBARE_SOORTEN.
 *
 * Alles komt uit dezelfde lezing — labels en de ouder-relatie zitten sinds #182 in de
 * board-query. Een filter dat per item een tweede aanroep doet zou het GraphQL-budget
 * opeten dat #104 juist bewaakt.
 */
export function bouwWachtrij(items) {
    const bruikbaar = [];
    for (const item of items) {
        const reden = redenBuitenDeRij(item);
        if (reden !== undefined) {
            if (reden.grond === 'geen-app') {
                // Niet stil overslaan, net als in #153: zonder App weet de werker niet welke
                // code hij moet lezen, en een item dat nooit aan de beurt komt zonder dat
                // iemand het merkt is erger dan een item dat overgeslagen wordt met een melding.
                waarschuwing(`#${String(item.issue)} heeft geen App-veld — overgeslagen.`);
            }
            continue;
        }
        // `redenBuitenDeRij` heeft de App al getoetst; deze regel maakt dat voor de types waar.
        bruikbaar.push({ ...item, app: item.app ?? '' });
    }
    return bruikbaar;
}
/**
 * De uitsluitingsgrond van één item, of `undefined` als het in de rij hoort.
 *
 * Eén functie voor het filter én voor de melding van `--issue`, en niet twee keer
 * dezelfde kennis. De vorige vorm was een reeks kale `continue`-regels: die kon geen
 * reden noemen, en toen het filter in #232 veranderde bleef de documentatie erover
 * achter zonder dat iets rood werd. Wie hier een grond toevoegt, levert de uitleg mee.
 */
export function redenBuitenDeRij(item) {
    if (item.kolom !== BOUW_KOLOM) {
        return {
            grond: 'kolom',
            zin: `het staat op ${item.kolom}, niet op ${BOUW_KOLOM}`,
        };
    }
    if (!BOUWBARE_SOORTEN.some((soort) => item.labels.includes(soort))) {
        return {
            grond: 'soort',
            zin: `het draagt geen van de labels ${BOUWBARE_SOORTEN.join(' of ')}`,
        };
    }
    if (item.labels.includes(ESCALATIE_LABEL)) {
        return {
            grond: 'escalatie',
            zin: `het draagt het label ${ESCALATIE_LABEL} — haal dat er eerst af`,
        };
    }
    if (item.app === undefined || item.app === '') {
        return { grond: 'geen-app', zin: 'het heeft geen App-veld, dus geen code om te lezen' };
    }
    return undefined;
}
/**
 * Het item waar deze run over gaat: de kop van de rij, of het gevraagde issue.
 *
 * Een gevraagd issue dat niet in de rij staat is een fout mét de reden. `--issue`
 * filtert de rij die de filters al gemaakt hebben; hij bouwt geen tweede rij, dus hij
 * kan een item dat niet mag ook niet laten bouwen.
 */
export function kiesItem(wachtrij, alles, issue, cwd) {
    if (issue === undefined) {
        return wachtrij[0];
    }
    const gevraagd = wachtrij.find((item) => item.issue === issue);
    if (gevraagd !== undefined) {
        return gevraagd;
    }
    const inLezing = alles.find((item) => item.issue === issue);
    if (inLezing !== undefined) {
        const reden = redenBuitenDeRij(inLezing);
        throw new GebruikersFout(`#${String(issue)} staat niet in de bouw-wachtrij: ${reden?.zin ?? 'onbekende reden'}.`);
    }
    // Niet in de lezing: `bordItems` laat gesloten items en items zonder Status-waarde
    // weg. Eén gerichte opzoeking maakt het verschil zichtbaar in plaats van te gokken.
    const kolom = kolomVan(issue, cwd);
    throw new GebruikersFout(kolom === undefined
        ? `#${String(issue)} staat niet in de bouw-wachtrij: hij heeft geen kolom op het ` +
            `board, of hij is gesloten.`
        : `#${String(issue)} staat niet in de bouw-wachtrij: het staat op ${kolom}, ` +
            `niet op ${BOUW_KOLOM}.`);
}
/** Het prefix waarmee een bron-label begint; de rest is de app-naam. */
const BRON_PREFIX = 'bron:';
/**
 * Leest de `bron:<app>`-labels van een item, ontdubbeld (#238).
 *
 * Een label naar de eigen app van het item is een waarschuwing en verder een no-op:
 * die code staat al in de worktree. Levert een lege lijst als er geen bron-labels zijn.
 */
export function bronAppsVan(item) {
    const gezien = new Set();
    const apps = [];
    for (const label of item.labels) {
        if (!label.startsWith(BRON_PREFIX)) {
            continue;
        }
        const app = label.slice(BRON_PREFIX.length).trim();
        if (app === '') {
            continue;
        }
        if (app === item.app) {
            waarschuwing(`#${String(item.issue)} draagt ${label}, maar ${app} is zijn eigen app — overgeslagen.`);
            continue;
        }
        if (!gezien.has(app)) {
            gezien.add(app);
            apps.push(app);
        }
    }
    return apps;
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
    const paden = opties.paden ?? standaardPaden();
    const instellingen = leesInstellingen(paden);
    const wachtrij = bouwWachtrij(items);
    const geclaimd = items.filter((item) => item.kolom === GECLAIMD_KOLOM).length;
    kop(`Bouw-wachtrij: ${BOUW_KOLOM}`);
    if (wachtrij.length === 0 && opties.issue === undefined) {
        ok('niets te bouwen');
        return;
    }
    for (const item of wachtrij) {
        const nummer = `#${String(item.issue)}`.padEnd(6);
        // Het epic erbij, als het item er een heeft: sinds #232 mag een slice gewoon
        // gebouwd worden, en dan wil je vóór het geld kost zien dat hij ergens bij hoort.
        const onder = item.ouder === undefined ? '' : ` (onder #${String(item.ouder)})`;
        process.stdout.write(`  ${nummer} ${item.app.padEnd(12)} ${item.titel}${onder}\n`);
    }
    if (geclaimd > 0) {
        // Zichtbaar maken wat er buiten de rij valt: een geclaimd item is niet vergeten
        // maar in behandeling, en dat wil je kunnen zien zonder het board te openen.
        ok(`${String(geclaimd)} item(s) staan op ${GECLAIMD_KOLOM} en zijn dus geclaimd.`);
    }
    const eerste = kiesItem(wachtrij, items, opties.issue, cwd);
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
        const bronApps = bronAppsVan(eerste);
        const bronWortel = bronMappenVan(werkplekPad);
        const bronRegels = bronApps
            .map((app) => `  bron:     ${app} → ${path.join(bronWortel, app)}`)
            .join('\n');
        process.stdout.write(`\nZou nu bouwen: #${String(eerste.issue)} (${eerste.app}) — ${eerste.titel}\n` +
            `  werkplek: ${werkplekPad}\n` +
            `  branch:   ${bouwBranch(eerste.issue)}\n` +
            `  budget:   $${String(instellingen.bouwBudgetPerRun)} voor deze run\n` +
            (bronRegels === '' ? '' : `${bronRegels}\n`) +
            `Er is niets geschreven — niet naar GitHub, niet naar de werkplaats en niet naar een worktree.\n`);
        return;
    }
    // Een bouw-run stond tot #264 nergens: `logRun` werd alleen uit de nacht-lus
    // aangeroepen, en die is refine-only. Juist de duurste soort was dus onzichtbaar.
    metBoekhouding({
        paden,
        nu: new Date(Date.now()),
        soort: 'bouw',
        // Er is nog geen onbemande bouw-nacht; wie dit start is een mens (#265).
        pot: 'interactief',
        item: eerste,
    }, () => bouwAf(eerste, cwd, wortel, instellingen.bouwBudgetPerRun, opties.leverIn ?? inleveren), beschrijfBouw);
}
/**
 * Wat er van een bouw-run in het log komt.
 *
 * Zelfde vorm als bij een refine-run, inclusief de eigen tekst voor een afkapping
 * (#206): "afgekapt (30 min)" is 's ochtends leesbaar, "mislukt" niet.
 */
function beschrijfBouw(uitkomst) {
    return {
        uitkomst: uitkomst.afgekaptNaMinuten === undefined
            ? uitkomst.afloop
            : `afgekapt (${String(uitkomst.afgekaptNaMinuten)} min)`,
        ...(uitkomst.kosten === undefined ? {} : { kosten: uitkomst.kosten }),
        ...(uitkomst.beurten === undefined ? {} : { beurten: uitkomst.beurten }),
    };
}
/** De prompt voor de bouw-werker: het sjabloon met de feiten die hij niet mag opzoeken. */
export function bouwPrompt(item, werkmap, factoryMap, bronMappen = []) {
    const sjabloon = readFileSync(path.join(templatesDir, 'werker-bouw.md'), 'utf8');
    const bronBlok = bronMappen.length === 0
        ? ''
        : bronMappen.map((pad) => `- \`${pad}\` — **alleen lezen, wegwerpkopie**`).join('\n');
    const vervang = {
        '{{ISSUE}}': String(item.issue),
        '{{TITEL}}': item.titel,
        '{{APP}}': item.app,
        '{{BRANCH}}': bouwBranch(item.issue),
        '{{WERKMAP}}': werkmap,
        '{{FACTORY_MAP}}': factoryMap,
        '{{BRON_MAPPEN}}': bronBlok,
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
    const bronApps = bronAppsVan(item);
    const werkmap = bouwWerkplek(item.app, item.issue, wortel);
    const bronWortel = bronMappenVan(werkmap);
    let uitkomst;
    try {
        const spiegel = versWerkplaats(item.app, EIGENAAR, wortel);
        const factoryMap = versWerkplaats('factory', EIGENAAR, wortel);
        // Bron-momentopnames vóór de claude-run: faalt de clone, dan is het een harde fout
        // en kost hij niets. De map is naast de worktree, niet erin: verify in de worktree
        // ziet hem niet, en het ergste wat de werker kan doen is zijn eigen wegwerpkopie
        // verbouwen (#238).
        const bronMappen = [];
        for (const bronApp of bronApps) {
            bronMappen.push(bronMomentopname(bronApp, bronWortel, EIGENAAR, wortel));
        }
        // Via `factory werkplek` en niet met een eigen `git worktree add`: dan geldt hier
        // dezelfde padconventie en dezelfde branchnaam als voor een menselijke sessie, en
        // `inleveren` ruimt de werkplek achteraf op de manier die hij al kent.
        werkplek(String(item.issue), { cwd: spiegel });
        uitkomst = draaiBouwer({
            prompt: bouwPrompt(item, werkmap, factoryMap, bronMappen),
            werkmap,
            sessie: randomUUID(),
            extraMappen: [factoryMap, ...bronMappen],
            budgetUsd,
            model: MODEL,
        });
    }
    catch (fout) {
        ruimBronMapOp(bronWortel);
        terug();
        throw fout;
    }
    // Na de run is de bron-map weg, ook als de run escaleerde of faalde — de uitkomst
    // hoort er niet van af te hangen, en een achtergebleven map is rommel die bij de
    // volgende run in de weg kan zitten.
    ruimBronMapOp(bronWortel);
    verwerkBouw(item, uitkomst, cwd, wortel, leverIn);
    return uitkomst;
}
/** Vertaalt de uitkomst van de bouw-werker naar wat er op GitHub gebeurt. */
function verwerkBouw(item, uitkomst, cwd, wortel, leverIn) {
    const voetnoot = `<sub>${[
        uitkomst.kosten === undefined ? undefined : `$${uitkomst.kosten.toFixed(2)}`,
        uitkomst.beurten === undefined ? undefined : `${String(uitkomst.beurten)} beurten`,
        uitkomst.weigeringen > 0
            ? `${String(uitkomst.weigeringen)}× geweigerd${uitkomst.geweigerd === undefined ? '' : ` (${uitkomst.geweigerd.join(', ')})`}`
            : undefined,
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
    // Mét titel: zonder `--titel` raadt `gh --fill` er een uit de branchnaam, en dan heet
    // de PR "slice/87 1" — zoals bij de eerste bouw-run gebeurde.
    leverIn({
        cwd: werkmap,
        geenAutomerge: true,
        titel: `#${String(item.issue)} — ${item.titel}`,
    });
    ok(`#${String(item.issue)} gebouwd en ingeleverd zonder auto-merge.`);
}
/** Zet een item stil: terug in de bouw-wachtrij, met het label dat het overslaat. */
function blokkeer(item, cwd) {
    zetKolom(item.issue, BOUW_KOLOM, cwd);
    zetLabel(item.issue, ESCALATIE_LABEL, cwd);
}
/** Of het opgegeven `--soort` bestaat, en welke. Onbekend is een fout, geen stille default. */
/**
 * Leest `--issue`: een positief geheel getal, of niets.
 *
 * Bewust een fout vóór de board-lezing. `--issue abc` zou anders een lezing kosten om
 * daarna niets te vinden, en de melding zou over de wachtrij gaan in plaats van over
 * de typefout.
 */
export function leesIssue(waarde) {
    if (waarde === undefined) {
        return undefined;
    }
    const nummer = Number(waarde);
    if (!Number.isInteger(nummer) || nummer < 1) {
        throw new GebruikersFout(`--issue verwacht een issuenummer, geen '${waarde}'.`);
    }
    return nummer;
}
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