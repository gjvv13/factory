import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appOpties, bordItems, ESCALATIE_LABEL, haalLabelWeg, isBacklogRepo, kolomVan, plaatsComment, zetKolom, zetLabel, zorgVoorEscalatieLabel, } from '../board.js';
import { BOUW_LAUNCH_LABEL, kalenderdag, leesInstellingen, leesStaat, metBoekhouding, schrijfLog, standaardPaden, TOKEN_SLEUTEL, vereisToken, zorgVoorEnvBestand, } from '../orkestrator-instellingen.js';
import { templatesDir } from '../paths.js';
import { draaiReeks, meldReeks } from '../reeks.js';
import { globaleFactoryVersie, minstensVersie } from './integreer.js';
import { GebruikersFout, OmgevingsFout, kop, ok, run, uitvoerVan, waarschuwing } from '../shell.js';
import { draaiBouwer, draaiReviewer } from '../werker.js';
import { BOUW_NACHT_MINUUT, BOUW_NACHT_UUR, bouwOrkestreerPlist, eigenVersie, escalatieComment, geefLockVrij, lockInfo, neemLock, nieuwsteTag, vervolgPrompt, vereisNachtModus, } from './orkestreer.js';
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
export function kiesItem(wachtrij, alles, issue, cwd, reden = redenBuitenDeRij) {
    if (issue === undefined) {
        return wachtrij[0];
    }
    const gevraagd = wachtrij.find((item) => item.issue === issue);
    if (gevraagd !== undefined) {
        return gevraagd;
    }
    const inLezing = alles.find((item) => item.issue === issue);
    if (inLezing !== undefined) {
        const uitkomst = reden(inLezing);
        throw new GebruikersFout(`#${String(issue)} staat niet in de bouw-wachtrij: ${uitkomst?.zin ?? 'onbekende reden'}.`);
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
 * Draait de bouw-taaksoort: wachtrij tonen, één item bouwen, een reeks, of de
 * onbemande bouw-nacht (#343).
 */
export async function orkestreerBouw(opties = {}) {
    const paden = opties.paden ?? standaardPaden();
    if (opties.installeer === true) {
        installeerBouwAgent(paden);
        return;
    }
    if (opties.verwijder === true) {
        verwijderBouwAgent(paden);
        return;
    }
    const modi = [opties.dry, opties.eenmalig, opties.nacht, opties.reeks !== undefined].filter((modus) => modus === true);
    if (modi.length > 1) {
        throw new GebruikersFout('--dry, --eenmalig, --reeks en --nacht sluiten elkaar uit; kies er één.');
    }
    if (modi.length === 0) {
        // Geen stille default naar bouwen: een commando dat zonder vlag een werker met
        // schrijfrechten start is precies de verrassing die deze epic wil vermijden.
        throw new GebruikersFout('Gebruik: factory orkestreer --soort bouw --dry (tonen), --eenmalig (één item bouwen), --reeks <n> (een reeks) of --nacht (tot het dagmaximum).');
    }
    const cwd = process.cwd();
    const wortel = opties.werkplaatsWortel ?? werkplaatsWortel;
    const instellingen = leesInstellingen(paden);
    if (opties.nacht === true) {
        if (opties.issue !== undefined) {
            throw new GebruikersFout('--issue en --nacht gaan niet samen; gebruik --eenmalig.');
        }
        if (opties.baan !== undefined) {
            // --nacht draait beide banen met onafhankelijke caps; een enkele baan kiezen kan
            // met --eenmalig of --dry (#400).
            throw new GebruikersFout('--baan en --nacht gaan niet samen; --nacht draait beide banen.');
        }
        await draaiNachtBouw(cwd, wortel, paden, opties.nu ?? new Date(Date.now()), opties.leverIn);
        return;
    }
    const items = bordItems(cwd);
    if (items === undefined) {
        throw new GebruikersFout('Kon het board niet lezen; zonder wachtrij is er niets te doen.\n' +
            '  Controleer je gh-auth (`gh auth status`) en de GraphQL-limiet\n' +
            '  (`gh api rate_limit --jq .resources.graphql`).');
    }
    const isFastlane = opties.baan === 'fastlane';
    const wachtrij = isFastlane ? fastlaneWachtrij(items) : bouwWachtrij(items);
    const redenFunctie = isFastlane ? redenBuitenFastlane : redenBuitenDeRij;
    const geclaimd = items.filter((item) => item.kolom === GECLAIMD_KOLOM).length;
    const baanNaam = isFastlane ? 'Fastlane' : 'Bouw';
    kop(`${baanNaam}-wachtrij: ${BOUW_KOLOM}`);
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
    const eerste = kiesItem(wachtrij, items, opties.issue, cwd, redenFunctie);
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
            `  budget:   $${String(instellingen.bouwBudgetPerRun)} bouw + $${String(instellingen.reviewBudgetPerRun)} review\n` +
            (bronRegels === '' ? '' : `${bronRegels}\n`) +
            `Er is niets geschreven — niet naar GitHub, niet naar de werkplaats en niet naar een worktree.\n`);
        return;
    }
    if (opties.reeks !== undefined) {
        const keuze = opties.reeks;
        const lijst = keuze.soort === 'lijst' ? keuze.issues : undefined;
        if (lijst !== undefined) {
            // Een nummer dat niet bestaat is een fout vóór de eerste `claude`-aanroep: anders
            // betaal je drie runs en hoor je pas daarna dat de vierde een typefout was.
            const bekend = new Set(items.map((item) => item.issue));
            const onbekend = lijst.filter((nummer) => !bekend.has(nummer));
            if (onbekend.length > 0) {
                throw new GebruikersFout(`Niet op het board: ${onbekend.map((n) => `#${String(n)}`).join(', ')}.`);
            }
        }
        kop(keuze.soort === 'aantal'
            ? `Reeks van ${String(keuze.aantal)}`
            : `Reeks: ${keuze.issues.map((n) => `#${String(n)}`).join(', ')}`);
        meldReeks(await draaiReeks({
            paden,
            nu: new Date(Date.now()),
            soort: 'bouw',
            pot: 'interactief',
            noemer: 'deze reeks',
            aantal: keuze.soort === 'aantal' ? keuze.aantal : keuze.issues.length,
            ...(lijst === undefined ? {} : { lijst }),
            reden: (issue) => {
                const item = items.find((kandidaat) => kandidaat.issue === issue);
                return item === undefined ? undefined : redenFunctie(item)?.zin;
            },
            // Per ronde opnieuw lezen: de vorige run heeft een kolom verzet of een
            // escalatie-label gehangen, en op de oude lijst zou hij dat item nog eens pakken.
            leesRij: () => isFastlane ? fastlaneWachtrij(bordItems(cwd) ?? []) : bouwWachtrij(bordItems(cwd) ?? []),
            // Stapelen per app (#327): het volgende item in dezelfde app vertrekt van de
            // branch van het vorige, zodat de PR's conflictvrij mergen in volgorde.
            branchVan: (item) => bouwBranch(item.issue),
            werkAf: (item, reeks) => bouwAf(item, cwd, wortel, instellingen.bouwBudgetPerRun, instellingen.reviewBudgetPerRun, instellingen.werkerEffort, opties.leverIn ?? inleveren, appOpties() ?? [], reeks),
            beschrijf: beschrijfBouw,
            beoordeel: (u) => (u.bouw.afloop === 'klaar' ? 'gelukt' : u.bouw.afloop),
        }));
        return;
    }
    // Een bouw-run stond tot #264 nergens: `logRun` werd alleen uit de nacht-lus
    // aangeroepen, en die is refine-only. Juist de duurste soort was dus onzichtbaar.
    await metBoekhouding({
        paden,
        nu: new Date(Date.now()),
        soort: 'bouw',
        // Wie dit start is een mens; de pot is interactief (#265).
        pot: 'interactief',
        item: eerste,
    }, () => bouwAf(eerste, cwd, wortel, instellingen.bouwBudgetPerRun, instellingen.reviewBudgetPerRun, instellingen.werkerEffort, opties.leverIn ?? inleveren, appOpties() ?? []), beschrijfBouw);
}
/**
 * Wat er van een bouw-run in het log komt.
 *
 * Somt de kosten en beurten van bouw + review op tot één totaal, met een uitsplitsing
 * als de review gedraaid heeft (#298). Zonder review is de logregel ongewijzigd.
 */
export function beschrijfBouw(resultaat) {
    const { bouw, review } = resultaat;
    const uitkomst = bouw.afgekaptNaMinuten === undefined
        ? bouw.afloop
        : `afgekapt (${String(bouw.afgekaptNaMinuten)} min)`;
    // Zonder review: alleen de bouw-kosten, geen uitsplitsing — de logregel is ongewijzigd.
    if (review === undefined) {
        return {
            uitkomst,
            ...(bouw.kosten === undefined ? {} : { kosten: bouw.kosten }),
            ...(bouw.beurten === undefined ? {} : { beurten: bouw.beurten }),
        };
    }
    // Met review: kosten en beurten optellen, met een uitsplitsing.
    const bouwKostenTekst = bouw.kosten === undefined ? '?' : `$${bouw.kosten.toFixed(2)}`;
    const reviewKostenTekst = review.kosten === undefined ? '?' : `$${review.kosten.toFixed(2)}`;
    // Totaalkosten: alleen de bekende kosten optellen. Zijn beide onbekend, dan is het
    // totaal ook onbekend.
    const totaalKosten = bouw.kosten === undefined && review.kosten === undefined
        ? undefined
        : (bouw.kosten ?? 0) + (review.kosten ?? 0);
    const totaalBeurten = bouw.beurten === undefined && review.beurten === undefined
        ? undefined
        : (bouw.beurten ?? 0) + (review.beurten ?? 0);
    return {
        uitkomst,
        ...(totaalKosten === undefined ? {} : { kosten: totaalKosten }),
        ...(totaalBeurten === undefined ? {} : { beurten: totaalBeurten }),
        uitsplitsing: `(bouw ${bouwKostenTekst} · review ${reviewKostenTekst})`,
    };
}
/** De prompt voor de bouw-werker: het sjabloon met de feiten die hij niet mag opzoeken. */
export function bouwPrompt(item, werkmap, factoryMap, bronMappen = [], apps = []) {
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
        '{{BEKENDE_APPS}}': apps.join(', '),
    };
    return Object.entries(vervang).reduce((tekst, [sleutel, waarde]) => tekst.split(sleutel).join(waarde), sjabloon);
}
/** De prompt voor de review-werker: het sjabloon met dezelfde feiten als de bouwer. */
export function reviewPrompt(item, werkmap, factoryMap, apps = []) {
    const sjabloon = readFileSync(path.join(templatesDir, 'werker-review.md'), 'utf8');
    const vervang = {
        '{{ISSUE}}': String(item.issue),
        '{{TITEL}}': item.titel,
        '{{APP}}': item.app,
        '{{WERKMAP}}': werkmap,
        '{{FACTORY_MAP}}': factoryMap,
        '{{BEKENDE_APPS}}': apps.join(', '),
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
export async function bouwAf(item, cwd, wortel, budgetUsd, reviewBudgetUsd, effort, leverIn, apps = [], reeks, env, timeoutMs) {
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
    // `factoryMap` buiten de try: de review-stap na de try heeft hem nodig.
    // Geen initialisatie: de catch gooit door, dus na de try is hij altijd gezet.
    let factoryMap;
    try {
        const spiegel = versWerkplaats(item.app, EIGENAAR, wortel);
        factoryMap = versWerkplaats('factory', EIGENAAR, wortel);
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
        // In een reeks vertrekt de worktree van de basis-branch (#327): dat is de branch
        // van het vorige item in dezelfde app, of undefined bij het eerste item.
        werkplek(String(item.issue), {
            cwd: spiegel,
            ...(reeks?.basis !== undefined ? { basis: reeks.basis } : {}),
        });
        uitkomst = await draaiBouwer({
            prompt: bouwPrompt(item, werkmap, factoryMap, bronMappen, apps),
            werkmap,
            sessie: randomUUID(),
            extraMappen: [factoryMap, ...bronMappen],
            budgetUsd,
            model: MODEL,
            effort,
            ...(env === undefined ? {} : { env }),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
        });
    }
    catch (fout) {
        ruimBronMapOp(bronWortel);
        if (fout instanceof OmgevingsFout) {
            // De omgeving is stuk — geen repo, onleesbare package.json, worktree kon niet
            // aangemaakt worden. Escaleren in plaats van als kale mislukking boeken, zodat
            // de noodstop in de nachtreeks niet afgaat op iets waar de code niets mee te
            // maken heeft (#383).
            escaleerOmgevingsfout(item, cwd, werkmap, fout, 'de bouw-run kon niet starten');
            return {
                bouw: {
                    afloop: 'escalatie',
                    sessie: '',
                    weigeringen: 0,
                },
            };
        }
        terug();
        throw fout;
    }
    // Na de run is de bron-map weg, ook als de run escaleerde of faalde — de uitkomst
    // hoort er niet van af te hangen, en een achtergebleven map is rommel die bij de
    // volgende run in de weg kan zitten.
    ruimBronMapOp(bronWortel);
    // Review: alleen als de bouw slaagde, in de worktree die er dan nog staat (#184).
    // Na het inleveren is de worktree weg — de review móét ervoor draaien.
    // Een throw uit de review (startfout, onverwachte uitzondering) mag het inleveren
    // nooit blokkeren — de review is een extra poort, geen voorwaarde (#289).
    let reviewUitkomst;
    if (uitkomst.afloop === 'klaar') {
        try {
            reviewUitkomst = await draaiReviewer({
                prompt: reviewPrompt(item, werkmap, factoryMap, apps),
                werkmap,
                sessie: randomUUID(),
                extraMappen: [factoryMap],
                budgetUsd: reviewBudgetUsd,
                model: MODEL,
                effort,
                ...(env === undefined ? {} : { env }),
                ...(timeoutMs === undefined ? {} : { timeoutMs }),
            });
        }
        catch (fout) {
            const reden = fout instanceof Error ? fout.message : String(fout);
            waarschuwing(`review kon niet draaien: ${reden}`);
            reviewUitkomst = { afloop: 'mislukt', sessie: '', weigeringen: 0, fout: reden };
        }
    }
    const inleverOmgevingsfout = verwerkBouw(item, uitkomst, reviewUitkomst, cwd, wortel, leverIn, reeks);
    return {
        // Een OmgevingsFout bij het inleveren is op het board al als escalatie afgehandeld,
        // maar de bouw zélf slaagde (afloop 'klaar'). Zonder deze override zou `beoordeel` de
        // run als 'gelukt' tellen en de noodstop-teller in de nachtreeks resetten (#383).
        bouw: inleverOmgevingsfout ? { ...uitkomst, afloop: 'escalatie' } : uitkomst,
        ...(reviewUitkomst === undefined ? {} : { review: reviewUitkomst }),
    };
}
/**
 * Vertaalt de uitkomst van de bouw-werker naar wat er op GitHub gebeurt.
 *
 * Retourneert `true` als het inleveren op een `OmgevingsFout` stuitte: dan is het item
 * op het board al geëscaleerd, maar moet de aanroeper de uitkomst als escalatie boeken
 * (niet als de 'klaar' waarmee de bouw zelf eindigde) zodat de noodstop klopt (#383).
 */
function verwerkBouw(item, uitkomst, reviewUitkomst, cwd, wortel, leverIn, reeks) {
    const voetnoot = maakVoetnoot(item, uitkomst, reviewUitkomst, wortel);
    if (uitkomst.afloop === 'mislukt') {
        // Een `is_error: true` bij exit 0 landt hier: geen PR, geen afvink-comment. Terug in
        // de rij met een label, zodat dezelfde fout niet vannacht opnieuw draait.
        blokkeer(item, cwd);
        plaatsComment(item.issue, `**Bouw-run mislukt.** ${uitkomst.fout ?? 'onbekende fout'}\n\n${voetnoot}`, cwd);
        waarschuwing(`#${String(item.issue)} mislukt: ${uitkomst.fout ?? 'onbekende fout'}`);
        return false;
    }
    const verdict = uitkomst.verdict;
    const werkmap = bouwWerkplek(item.app, item.issue, wortel);
    if (verdict?.uitkomst === 'escalatie') {
        blokkeer(item, cwd);
        plaatsComment(item.issue, escalatieComment(item.issue, verdict.vraag, verdict.advies, uitkomst, werkmap, 'bouw', item.app), cwd);
        ok(`#${String(item.issue)} geëscaleerd — niets ingeleverd.`);
        return false;
    }
    if (verdict?.uitkomst !== 'klaar') {
        blokkeer(item, cwd);
        waarschuwing(`#${String(item.issue)} gaf geen bruikbare uitkomst.`);
        return false;
    }
    // Inleveren doet de rest: poort draaien, pushen, PR openen, het item naar Uitrollen
    // schuiven (#128) en de werkplek opruimen. Zonder auto-merge, want deze werker mag
    // code voorstellen en niet landen.
    //
    // De "Gebouwd door"-comment (met "de PR staat open") komt pas ná een geslaagd
    // inleveren: stuit `leverIn` op een omgevingsfout, dan is er géén PR en zou die comment
    // liegen (#383).
    const reviewComment = maakReviewComment(reviewUitkomst);
    try {
        // Mét titel: zonder `--titel` raadt `gh --fill` er een uit de branchnaam, en dan heet
        // de PR "slice/87 1" — zoals bij de eerste bouw-run gebeurde.
        leverIn({
            cwd: werkmap,
            geenAutomerge: true,
            titel: `#${String(item.issue)} — ${item.titel}`,
            // In een reeks de stacking-informatie doorgeven (#327): de positie en de
            // basis-branch komen in de PR-body, zodat de stapel 's ochtends leesbaar is.
            ...(reeks?.basis !== undefined && reeks.basisIssue !== undefined
                ? {
                    reeksInfo: {
                        positie: reeks.positie,
                        totaal: reeks.totaal,
                        basisBranch: reeks.basis,
                        basisIssue: reeks.basisIssue,
                    },
                }
                : {}),
        });
    }
    catch (fout) {
        if (fout instanceof OmgevingsFout) {
            // De poort kon niet draaien door een omgevingsprobleem — geen inhoudelijke fout.
            // Escaleren zodat de noodstop niet afgaat (#383).
            escaleerOmgevingsfout(item, cwd, werkmap, fout, 'de kwaliteitspoort kon niet draaien');
            return true;
        }
        // Inleveren mislukt: de review-bevindingen gaan naar het issue, want een PR bestaat
        // niet. Gooi daarna alsnog door — de bouw-run hoort rood te worden.
        if (reviewComment !== undefined) {
            plaatsComment(item.issue, reviewComment, cwd);
        }
        throw fout;
    }
    // Inleveren geslaagd: nu pas melden dat er gebouwd is en dat de PR openstaat.
    plaatsComment(item.issue, `**Gebouwd door een onbemande werker.**\n\n${verdict.samenvatting}\n\n` +
        `| Acceptatiecriterium | Bewijs |\n| --- | --- |\n` +
        verdict.criteria.map((regel) => `| ${regel.criterium} | ${regel.bewijs} |`).join('\n') +
        `\n\nDe PR staat open **zonder auto-merge**; mergen is jouw beslissing.\n\n${voetnoot}`, cwd);
    // Na een geslaagd inleveren: bevindingen als PR-comment via `gh api` (#184).
    if (reviewComment !== undefined) {
        if (!plaatsPrComment(item, reviewComment)) {
            // Kon de PR niet vinden of de comment niet plaatsen; val terug op het issue.
            waarschuwing(`Kon review-comment niet op de PR plaatsen; het staat op het issue.`);
            plaatsComment(item.issue, reviewComment, cwd);
        }
    }
    ok(`#${String(item.issue)} gebouwd en ingeleverd zonder auto-merge.`);
    return false;
}
/** Zet een item stil: terug in de bouw-wachtrij, met het label dat het overslaat. */
function blokkeer(item, cwd) {
    zetKolom(item.issue, BOUW_KOLOM, cwd);
    zetLabel(item.issue, ESCALATIE_LABEL, cwd);
}
/**
 * Escaleert een item wegens een omgevingsfout (geen inhoudelijke fout): terug in de rij
 * met het escalatie-label en een comment die de fase, de fout en het pad noemt, plus de
 * orkestrator-marker zodat de escalatie in beide fasen (setup én inleveren) identiek te
 * herkennen en te hervatten is (#383). Eén plek, zodat de twee catch-paden niet uit
 * elkaar lopen.
 */
function escaleerOmgevingsfout(item, cwd, werkmap, fout, fase) {
    blokkeer(item, cwd);
    plaatsComment(item.issue, `**Omgevingsfout.** ${fase}.\n\n` +
        `Fout: ${fout.message}\n` +
        `Pad: ${werkmap}\n\n` +
        `Controleer de werkplaats en probeer opnieuw, of haal het escalatie-label eraf.\n\n` +
        `<sub></sub>\n` +
        `<!-- orkestrator: sessie= werkmap=${werkmap} -->`, cwd);
    waarschuwing(`#${String(item.issue)} omgevingsfout: ${fout.message}`);
}
/**
 * De voetnoot onder een bouw-comment: kosten en beurten van zowel de bouw als de review
 * (#184), zodat de totaalkosten in één oogopslag te zien zijn.
 */
function maakVoetnoot(item, uitkomst, reviewUitkomst, wortel) {
    const delen = [
        uitkomst.kosten === undefined ? undefined : `$${uitkomst.kosten.toFixed(2)}`,
        uitkomst.beurten === undefined ? undefined : `${String(uitkomst.beurten)} beurten`,
        uitkomst.weigeringen > 0
            ? `${String(uitkomst.weigeringen)}× geweigerd${uitkomst.geweigerd === undefined ? '' : ` (${uitkomst.geweigerd.join(', ')})`}`
            : undefined,
    ];
    if (reviewUitkomst !== undefined) {
        if (reviewUitkomst.kosten !== undefined) {
            delen.push(`review $${reviewUitkomst.kosten.toFixed(2)}`);
        }
        if (reviewUitkomst.beurten !== undefined) {
            delen.push(`${String(reviewUitkomst.beurten)} review-beurten`);
        }
    }
    const sessies = reviewUitkomst === undefined
        ? `sessie=${uitkomst.sessie}`
        : `sessie=${uitkomst.sessie} review-sessie=${reviewUitkomst.sessie}`;
    return (`<sub>${delen.filter((deel) => deel !== undefined).join(' · ')}</sub>\n` +
        `<!-- orkestrator: ${sessies} werkmap=${bouwWerkplek(item.app, item.issue, wortel)} -->`);
}
/**
 * Het review-comment als markdown, of `undefined` als er geen review gedraaid heeft.
 *
 * Drie vormen: bevindingen (een tabel), nul bevindingen (een expliciete melding), of
 * een gefaalde run (de reden). Stilte is geen uitkomst — ook nul bevindingen staat er.
 */
function maakReviewComment(reviewUitkomst) {
    if (reviewUitkomst === undefined) {
        return undefined;
    }
    if (reviewUitkomst.afloop === 'mislukt') {
        return `**Code-review niet gelukt.** ${reviewUitkomst.fout ?? 'onbekende fout'}`;
    }
    const verdict = reviewUitkomst.verdict;
    if (verdict === undefined) {
        return '**Code-review niet gelukt.** Geen bruikbaar verdict.';
    }
    if (verdict.bevindingen.length === 0) {
        return `**Code-review door een onbemande reviewer.**\n\nGeen bevindingen.\n\n**Oordeel:** ${verdict.oordeel}`;
    }
    const tabel = `| Bestand | Regel | Ernst | Bevinding |\n| --- | --- | --- | --- |\n` +
        verdict.bevindingen
            .map((b) => `| ${b.bestand} | ${b.regel === undefined ? '—' : String(b.regel)} | ${b.ernst} | ${b.bevinding} |`)
            .join('\n');
    return `**Code-review door een onbemande reviewer.**\n\n${tabel}\n\n**Oordeel:** ${verdict.oordeel}`;
}
/**
 * Plaatst een comment op de PR die bij dit item hoort, via `gh api` (#184).
 *
 * Zoekt de PR op aan de hand van de branchnaam (`slice/<issue>-1`) in de app-repo.
 * Geeft `true` terug als het lukt, `false` als de PR niet gevonden of het comment
 * niet geplaatst kan worden — de aanroeper valt dan terug op het issue.
 */
function plaatsPrComment(item, tekst) {
    const branch = bouwBranch(item.issue);
    const repo = `${EIGENAAR}/${item.app}`;
    const nummer = uitvoerVan('gh', [
        'pr',
        'view',
        branch,
        '--repo',
        repo,
        '--json',
        'number',
        '--jq',
        '.number',
    ]);
    if (nummer === undefined || nummer === '') {
        return false;
    }
    const uitkomst = run('gh', ['api', `repos/${repo}/issues/${nummer}/comments`, '-f', `body=${tekst}`], { capture: true, toleranter: true });
    return uitkomst.code === 0;
}
// --- antwoord: een bouw-escalatie beantwoorden --------------------------------
/**
 * Verwerkt het antwoord op een bouw-escalatie: hervat de sessie met `draaiBouwer` en
 * draait het bouw-afrondingspad (review + inleveren). De logica zit hier en niet in
 * `orkestreer.ts` omdat zij het schema, de permissions en de afronding deelt met
 * `bouwAf` — `werkAntwoordAf` delegeert hier naartoe op `soort === 'bouw'`.
 */
export async function werkBouwAntwoordAf(issue, tekst, escalatie, opties, cwd) {
    kop(`Bouw-antwoord op #${String(issue)}`);
    const app = escalatie.app;
    if (app === undefined) {
        throw new GebruikersFout(`De escalatie-comment op #${String(issue)} bevat geen app-veld; hervatten kan niet.\n` +
            '  Dit is een comment uit een oudere versie. Begin een verse run:\n' +
            `    factory orkestreer --soort bouw --issue ${String(issue)} --eenmalig`);
    }
    const wortel = opties.werkplaatsWortel ?? werkplaatsWortel;
    const werkmap = bouwWerkplek(app, issue, wortel);
    const factoryMap = versWerkplaats('factory', EIGENAAR, wortel);
    const opdracht = opties.opnieuw === true
        ? verseBouwOpdracht(issue, app, tekst, escalatie, cwd, wortel)
        : {
            prompt: vervolgPrompt(escalatie, tekst),
            werkmap: escalatie.werkmap,
            sessie: escalatie.sessie,
            hervat: true,
        };
    const instellingen = leesInstellingen(opties.paden ?? standaardPaden());
    const uitkomst = await draaiBouwer({
        ...opdracht,
        budgetUsd: instellingen.bouwBudgetPerRun,
        model: MODEL,
        effort: instellingen.werkerEffort,
    });
    if (uitkomst.sessieWeg === true) {
        throw new GebruikersFout(`De sessie ${escalatie.sessie} bestaat niet meer, dus hervatten kan niet.\n` +
            `  Begin een verse run met je antwoord erbij:\n` +
            `    factory orkestreer antwoord ${String(issue)} "${tekst}" --opnieuw\n` +
            '  Dat kost meer (geen cache) en het werk tot de escalatie is weg, maar het loopt door.');
    }
    if (uitkomst.afloop === 'mislukt') {
        plaatsComment(issue, `**Bouw-antwoord verwerkt, maar de run mislukte.** ${uitkomst.fout ?? 'onbekende fout'}\n\n` +
            `<sub>${uitkomst.kosten === undefined ? '' : `$${uitkomst.kosten.toFixed(2)} · `}` +
            `${uitkomst.beurten === undefined ? '' : `${String(uitkomst.beurten)} beurten`}</sub>\n` +
            `<!-- orkestrator: soort=bouw app=${app} sessie=${uitkomst.sessie} werkmap=${werkmap} -->`, cwd);
        throw new GebruikersFout(`De run mislukte: ${uitkomst.fout ?? 'onbekende fout'}`);
    }
    const verdict = uitkomst.verdict;
    if (verdict?.uitkomst === 'escalatie') {
        // Nog een vraag. Het escalatie-label blijft staan; er is gewoon een nieuwe ronde nodig.
        plaatsComment(issue, escalatieComment(issue, verdict.vraag, verdict.advies, uitkomst, werkmap, 'bouw', app), cwd);
        ok(`#${String(issue)} escaleert opnieuw`);
        return;
    }
    if (verdict?.uitkomst !== 'klaar') {
        throw new GebruikersFout(`#${String(issue)} gaf geen bruikbare uitkomst.`);
    }
    // Review: alleen als de bouw slaagde, in de worktree die er dan nog staat (#184).
    let reviewUitkomst;
    try {
        reviewUitkomst = await draaiReviewer({
            prompt: reviewPrompt({ issue, app, titel: '', labels: [], kolom: GECLAIMD_KOLOM, aangemaakt: '' }, werkmap, factoryMap),
            werkmap,
            sessie: randomUUID(),
            extraMappen: [factoryMap],
            budgetUsd: instellingen.reviewBudgetPerRun,
            model: MODEL,
            effort: instellingen.werkerEffort,
        });
    }
    catch (fout) {
        const reden = fout instanceof Error ? fout.message : String(fout);
        waarschuwing(`review kon niet draaien: ${reden}`);
        reviewUitkomst = { afloop: 'mislukt', sessie: '', weigeringen: 0, fout: reden };
    }
    // Het item ophalen voor de titel (PR-titel bij inleveren) en de volledige Bouwitem.
    const item = bordItems(cwd)?.find((kandidaat) => kandidaat.issue === issue);
    const titel = item?.titel ?? `#${String(issue)}`;
    const bouwitem = {
        issue,
        app,
        titel,
        labels: item?.labels ?? [],
        kolom: GECLAIMD_KOLOM,
        aangemaakt: item?.aangemaakt ?? '',
    };
    // Het escalatie-label weghalen: het item is niet meer vastgelopen.
    haalLabelWeg(issue, ESCALATIE_LABEL, cwd);
    verwerkBouw(bouwitem, uitkomst, reviewUitkomst, cwd, wortel, inleveren);
}
/**
 * Bouwt een verse bouw-opdracht op voor `--opnieuw`: de sessie is weg, dus de volledige
 * prompt moet er opnieuw in, mét het antwoord op de eerdere vraag.
 */
function verseBouwOpdracht(issue, app, tekst, escalatie, cwd, wortel) {
    const item = bordItems(cwd)?.find((kandidaat) => kandidaat.issue === issue);
    if (item?.app === undefined) {
        throw new GebruikersFout(`Kon #${String(issue)} niet op het board vinden (of het heeft geen App-veld);\n` +
            '  zonder die gegevens is er geen opdracht om verse mee te beginnen.');
    }
    const werkmap = bouwWerkplek(app, issue, wortel);
    const factoryMap = versWerkplaats('factory', EIGENAAR, wortel);
    return {
        prompt: `${bouwPrompt({ ...item, app: item.app }, werkmap, factoryMap)}\n\n` +
            `## Eerder gevraagd\n\nEen eerdere poging stelde deze vraag:\n\n> ${escalatie.vraag}\n\n` +
            `Het antwoord is:\n\n> ${tekst}\n\nWerk daarmee verder.`,
        werkmap,
        sessie: randomUUID(),
    };
}
/**
 * Leest `--reeks`: een aantal (`--reeks 4`) of een lijst (`--reeks 126,186,263`).
 *
 * Twee vormen op één vlag, en niet een aparte vlag voor de lijst: de vraag is dezelfde
 * ("werk deze reeks af"), alleen het antwoord op *welke* items verschilt. `--issue`
 * blijft wat het was — één item voor `--eenmalig` of `--dry` — zodat elke vlag één
 * betekenis houdt.
 *
 * Een bovengrens van 20 op het aantal: dit start werkers die geld kosten, en een
 * typefout van één nul is dan duur. Wie meer wil doet het twee keer.
 */
export function leesReeks(waarde) {
    if (waarde === undefined)
        return undefined;
    if (waarde.includes(',')) {
        const issues = waarde.split(',').map((deel) => {
            const nummer = Number(deel.trim());
            if (!Number.isInteger(nummer) || nummer < 1) {
                throw new GebruikersFout(`--reeks wil issuenummers, niet "${deel.trim()}".`);
            }
            return nummer;
        });
        const ontdubbeld = [...new Set(issues)];
        if (ontdubbeld.length !== issues.length) {
            // Niet stil ontdubbelen: dan denk je vier items te doen en zijn het er drie.
            waarschuwing('dubbele nummers in --reeks; elk item draait één keer.');
        }
        if (ontdubbeld.length > 20) {
            throw new GebruikersFout('--reeks doet er maximaal 20 in één keer.');
        }
        return { soort: 'lijst', issues: ontdubbeld };
    }
    const aantal = Number(waarde);
    if (!Number.isInteger(aantal) || aantal < 1 || aantal > 20) {
        throw new GebruikersFout(`--reeks wil een geheel getal van 1 tot 20, niet "${waarde}".`);
    }
    return { soort: 'aantal', aantal };
}
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
// --- Bouw-nacht: onbemand bouwen tot het bouw-dagmaximum (#343) -----------------
/**
 * De bouw-nachtmodus: werkers starten tot het bouw-dagmaximum of tot de rij leeg is.
 *
 * Analoog aan `draaiNacht` in `orkestreer.ts`, maar met een eigen teller (`nachtBouw`),
 * een eigen dagmaximum (`bouwDagmaximum`), en `soort: 'bouw'` / `pot: 'nacht-bouw'`.
 *
 * Het gedeelde slot voorkomt dat een refine- en een bouw-nacht tegelijk draaien. Slot
 * bezet → loggen en overslaan, geen `GebruikersFout` en geen wachten.
 */
async function draaiNachtBouw(cwd, wortel, paden, nu, leverIn) {
    const instellingen = leesInstellingen(paden);
    const token = vereisToken(instellingen, paden);
    const draaiOpties = {
        budgetUsd: instellingen.bouwBudgetPerRun,
        env: { ...process.env, [TOKEN_SLEUTEL]: token },
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
    kop(`Bouw-nacht van ${kalenderdag(nu)}`);
    schrijfLog(paden, `${new Date(nu.getTime()).toISOString()} bouw-nacht gestart (factory ${versie})`);
    const staat = leesStaat(paden, nu);
    const bouwAlGestart = staat.nachtBouw;
    const fastlaneAlGestart = staat.nachtFastlane;
    const bouwKlaar = bouwAlGestart >= instellingen.bouwDagmaximum;
    const fastlaneKlaar = instellingen.fastlaneCap === 0 || fastlaneAlGestart >= instellingen.fastlaneCap;
    if (bouwKlaar && fastlaneKlaar) {
        ok(`beide caps bereikt (bouw ${String(bouwAlGestart)}/${String(instellingen.bouwDagmaximum)}, ` +
            `fastlane ${String(fastlaneAlGestart)}/${String(instellingen.fastlaneCap)}); niets gedaan.`);
        return;
    }
    if (!neemLock()) {
        // Slot bezet → overslaan met een logregel, geen fout. De refine-nacht draait er
        // misschien al; twee werkers tegelijk is het probleem.
        schrijfLog(paden, `${new Date(nu.getTime()).toISOString()} bouw-nacht overgeslagen: slot bezet`);
        ok(`slot bezet (${lockInfo()}); bouw-nacht overgeslagen.`);
        return;
    }
    try {
        // Gewone bouw-baan (#343).
        if (!bouwKlaar) {
            kop('Gewone bouw-baan');
            const uitkomst = await draaiReeks({
                paden,
                nu,
                soort: 'bouw',
                pot: 'nacht-bouw',
                noemer: 'de bouw-nacht',
                aantal: instellingen.bouwDagmaximum - bouwAlGestart,
                leesRij: () => bouwWachtrij(bordItems(cwd) ?? []),
                branchVan: (item) => bouwBranch(item.issue),
                werkAf: (item, reeks) => bouwAf(item, cwd, wortel, instellingen.bouwBudgetPerRun, instellingen.reviewBudgetPerRun, instellingen.werkerEffort, leverIn ?? inleveren, appOpties() ?? [], reeks, draaiOpties.env, draaiOpties.timeoutMs),
                beschrijf: beschrijfBouw,
                beoordeel: (u) => (u.bouw.afloop === 'klaar' ? 'gelukt' : u.bouw.afloop),
                naElkeRun: (aantal) => {
                    ok(`${String(bouwAlGestart + aantal)}/${String(instellingen.bouwDagmaximum)} van de bouw-nacht gedaan.`);
                },
            });
            if (uitkomst.einde === 'rij-leeg') {
                ok('bouw-wachtrij leeg.');
            }
            else if (uitkomst.einde === 'niets-nieuws') {
                ok('niets nieuws meer in de bouw-wachtrij.');
            }
        }
        // Fastlane-baan (#400): eigen cap, eigen teller.
        if (!fastlaneKlaar) {
            kop('Fastlane-baan');
            const flUitkomst = await draaiReeks({
                paden,
                nu,
                soort: 'bouw',
                pot: 'nacht-fastlane',
                noemer: 'de fastlane-nacht',
                aantal: instellingen.fastlaneCap - fastlaneAlGestart,
                leesRij: () => fastlaneWachtrij(bordItems(cwd) ?? []),
                branchVan: (item) => bouwBranch(item.issue),
                werkAf: (item, reeks) => bouwAf(item, cwd, wortel, instellingen.bouwBudgetPerRun, instellingen.reviewBudgetPerRun, instellingen.werkerEffort, leverIn ?? inleveren, appOpties() ?? [], reeks, draaiOpties.env, draaiOpties.timeoutMs),
                beschrijf: beschrijfBouw,
                beoordeel: (u) => (u.bouw.afloop === 'klaar' ? 'gelukt' : u.bouw.afloop),
                naElkeRun: (aantal) => {
                    ok(`${String(fastlaneAlGestart + aantal)}/${String(instellingen.fastlaneCap)} van de fastlane-nacht gedaan.`);
                },
            });
            if (flUitkomst.einde === 'rij-leeg') {
                ok('fastlane-wachtrij leeg.');
            }
            else if (flUitkomst.einde === 'niets-nieuws') {
                ok('niets nieuws meer in de fastlane-wachtrij.');
            }
        }
    }
    finally {
        geefLockVrij();
    }
}
/**
 * Zet de bouw-LaunchAgent op: `factory orkestreer --soort bouw --nacht` om 05:30.
 *
 * Analoog aan `installeerAgent` in `orkestreer.ts`, maar met een eigen label
 * (`nl.factory.orkestreer.bouw`) en een eigen plist. Dezelfde controles: factory-repo,
 * token, globale bin, en `vereisNachtModus`.
 */
function installeerBouwAgent(paden) {
    const cwd = process.cwd();
    if (!isBacklogRepo(cwd)) {
        throw new GebruikersFout('Draai dit in de factory-repo: de globale bin komt uit de release-tags daarvan.');
    }
    kop('Instellingen en token');
    zorgVoorEnvBestand(paden);
    const instellingen = leesInstellingen(paden);
    vereisToken(instellingen, paden);
    ok(`bouw-dagmaximum ${String(instellingen.bouwDagmaximum)}, budget $${String(instellingen.bouwBudgetPerRun)} bouw + $${String(instellingen.reviewBudgetPerRun)} review per run (${paden.envPad}).`);
    kop('Factory globaal installeren');
    const tag = nieuwsteTag(cwd);
    const versie = tag.replace(/^v/, '');
    const globaal = globaleFactoryVersie();
    if (globaal !== undefined && minstensVersie(globaal, versie)) {
        ok(`factory ${globaal} staat al globaal (≥ ${versie}); install overgeslagen.`);
    }
    else {
        run('npm', ['install', '-g', `https://codeload.github.com/${EIGENAAR}/factory/tar.gz/refs/tags/${tag}`], { capture: true });
        ok(`factory ${versie} globaal geïnstalleerd.`);
    }
    const prefix = uitvoerVan('npm', ['prefix', '-g'], cwd) ?? '/usr/local';
    const bin = path.join(prefix, 'bin', 'factory');
    // De globale bin moet `--soort bouw --nacht` kennen; `--nacht` in de help is genoeg.
    vereisNachtModus(bin);
    kop('Bouw-LaunchAgent laden');
    const pad = paden.bouwAgentPad;
    mkdirSync(path.dirname(pad), { recursive: true });
    writeFileSync(pad, bouwOrkestreerPlist({
        bin,
        werkmap: os.homedir(),
        logPad: paden.logPad,
        label: BOUW_LAUNCH_LABEL,
        uur: BOUW_NACHT_UUR,
        minuut: BOUW_NACHT_MINUUT,
        nachtCommando: `"${bin}" orkestreer --soort bouw --nacht`,
    }));
    run('launchctl', ['unload', pad], { toleranter: true, capture: true });
    run('launchctl', ['load', pad]);
    schrijfLog(paden, `${new Date(Date.now()).toISOString()} bouw-agent geladen (${tag}, ${bin})`);
    ok(`geladen; \`factory orkestreer --soort bouw --nacht\` draait elke nacht om ${String(BOUW_NACHT_UUR).padStart(2, '0')}:${String(BOUW_NACHT_MINUUT).padStart(2, '0')} (log: ${paden.logPad}).`);
}
/** Haalt de bouw-LaunchAgent weg. Idempotent. */
function verwijderBouwAgent(paden) {
    kop('Bouw-LaunchAgent verwijderen');
    const pad = paden.bouwAgentPad;
    run('launchctl', ['unload', pad], { toleranter: true, capture: true });
    rmSync(pad, { force: true });
    ok('verwijderd; er draait geen bouw-nacht meer vanzelf.');
}
/** Het label dat een `type:task` als fastlane markeert; alleen de mens zet dit. */
export const FASTLANE_LABEL = 'fastlane';
/**
 * Leest `--baan`: `gewoon` (default) of `fastlane`. Elke andere waarde is een fout;
 * zonder waarde blijft het de gewone baan.
 */
export function leesBaan(waarde) {
    if (waarde === undefined)
        return undefined;
    if (waarde === 'fastlane')
        return 'fastlane';
    if (waarde === 'gewoon')
        return 'gewoon';
    throw new GebruikersFout(`Onbekende --baan '${waarde}'. Kies: gewoon (default) of fastlane.`);
}
/**
 * Waarom een item niet in de fastlane-wachtrij staat.
 *
 * `type:bug` kwalificeert automatisch; `type:task` alleen mét het `fastlane`-label
 * (dat alleen de mens zet). Child-slices (items met een ouder) zijn uitgesloten —
 * die blijven in de geordende gewone baan (ADR 005, #397).
 */
export function redenBuitenFastlane(item) {
    if (item.kolom !== BOUW_KOLOM) {
        return {
            grond: 'kolom',
            zin: `het staat op ${item.kolom}, niet op ${BOUW_KOLOM}`,
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
    // Child-slices (sub-issues van een epic) zijn uitgesloten: die horen in de
    // geordende gewone baan (#397, ADR 005).
    if (item.ouder !== undefined) {
        return {
            grond: 'soort',
            zin: `het is een child-slice (onder #${String(item.ouder)}) — die blijven in de gewone baan`,
        };
    }
    // type:bug kwalificeert zonder extra label.
    if (item.labels.includes('type:bug')) {
        return undefined;
    }
    // type:task alleen mét het fastlane-label.
    if (item.labels.includes('type:task') && item.labels.includes(FASTLANE_LABEL)) {
        return undefined;
    }
    return {
        grond: 'soort',
        zin: item.labels.includes('type:task')
            ? `het is een type:task zonder het label ${FASTLANE_LABEL}`
            : `het draagt geen van de labels type:bug of type:task`,
    };
}
/**
 * De fastlane-wachtrij: items die snel door de bouw mogen (#400).
 *
 * Zelfde vorm als `bouwWachtrij`, maar met een smal filter: alleen bugs en
 * gelabelde tasks, geen child-slices. Één functie zodat `--dry`, `--eenmalig`
 * en `--nacht` er dezelfde rij uit trekken.
 */
export function fastlaneWachtrij(items) {
    const bruikbaar = [];
    for (const item of items) {
        const reden = redenBuitenFastlane(item);
        if (reden !== undefined) {
            if (reden.grond === 'geen-app') {
                waarschuwing(`#${String(item.issue)} heeft geen App-veld — overgeslagen.`);
            }
            continue;
        }
        bruikbaar.push({ ...item, app: item.app ?? '' });
    }
    return bruikbaar;
}
export function leesSoort(waarde) {
    if (waarde === undefined || waarde === 'refine') {
        return 'refine';
    }
    if (waarde === 'bouw') {
        return 'bouw';
    }
    if (waarde === 'accepteer') {
        return 'accepteer';
    }
    throw new GebruikersFout(`Onbekende --soort '${waarde}'. Kies: refine (default), bouw of accepteer.`);
}
//# sourceMappingURL=orkestreer-bouw.js.map