/**
 * `factory splits <issue#>` — deel een gerefined multi-slice-issue op in
 * child-issues. Het commando leest de slice-secties uit de issue-body, maakt per
 * slice een sub-issue aan, en herschrijft de ouder-body met verwijzingen.
 *
 * De ouder wordt een epic (label `type:epic`, kolom gewist); elk kind krijgt de
 * labels en het App-veld van de ouder en kolom **Klaar voor Bouwen**. Zo hoeft
 * de mens bij het akkoord niet handmatig issues aan te maken (#378).
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zetLabel, verwijderLabel, schrijfBody } from './board.js';
import { ok, run, waarschuwing, GebruikersFout } from './shell.js';
// ---------------------------------------------------------------------------
// Constanten
// ---------------------------------------------------------------------------
const EIGENAAR = 'gjvv13';
const BACKLOG_REPO = 'factory';
const PROJECT_NUMMER = 2;
const EPIC_LABEL = 'type:epic';
/**
 * De regex waarmee een slice-kop herkend wordt. Strikt: exact `### Slice <n> — <naam>`,
 * conform het refinement-template. Een afwijkende body levert een lege lijst op zodat
 * de aanroeper een duidelijke foutmelding kan geven.
 */
const SLICE_KOP = /^### Slice (\d+) — (.+)$/;
/**
 * Parset de issue-body en retourneert de gevonden slice-secties. Een lege lijst
 * betekent dat er nul of één slice is, of dat het formaat afwijkt.
 *
 * Geëxporteerd voor unit-tests: de parser is puur en heeft geen side-effects.
 */
export function parseSlices(body) {
    const regels = body.split('\n');
    const slices = [];
    let huidig;
    for (let i = 0; i < regels.length; i += 1) {
        const regel = regels[i] ?? '';
        const match = SLICE_KOP.exec(regel);
        if (match !== null) {
            // Sluit de vorige slice af
            if (huidig !== undefined) {
                slices.push(maakSlice(huidig, regels, i));
            }
            const nummer = Number.parseInt(match[1] ?? '', 10);
            const naam = (match[2] ?? '').trim();
            huidig = { nummer, naam, startIndex: i + 1 };
            continue;
        }
        // Een `## `-kop (h2) beëindigt de laatst geopende slice — dat is het begin van
        // Risico's, Besluiten of een andere architectuursectie.
        if (/^## /.test(regel) && huidig !== undefined) {
            slices.push(maakSlice(huidig, regels, i));
            huidig = undefined;
        }
    }
    // Sluit de laatste slice als de body eindigt zonder een volgende `## `-kop.
    if (huidig !== undefined) {
        slices.push(maakSlice(huidig, regels, regels.length));
    }
    // Één slice telt niet als "meerdere slices" — dat is een normaal issue.
    if (slices.length <= 1) {
        return [];
    }
    return slices;
}
function maakSlice(kop, regels, eindIndex) {
    const body = regels.slice(kop.startIndex, eindIndex).join('\n').trim();
    return { nummer: kop.nummer, naam: kop.naam, body };
}
/**
 * Vervangt de slice-secties in de originele body door een verwijzingsblok.
 * Behoudt alles vóór de eerste slice-kop en alles ná de laatste slice-sectie
 * (Risico's, Besluiten, enz.).
 *
 * Geëxporteerd voor unit-tests.
 */
export function herschrijfBody(origineel, kinderen) {
    const regels = origineel.split('\n');
    // Vind de eerste slice-kop
    let eersteSliceIndex = -1;
    for (let i = 0; i < regels.length; i += 1) {
        if (SLICE_KOP.test(regels[i] ?? '')) {
            eersteSliceIndex = i;
            break;
        }
    }
    if (eersteSliceIndex === -1) {
        return origineel;
    }
    // Vind het einde van de laatste slice: de volgende `## `-kop na de laatste slice,
    // of het einde van het bestand.
    let laatsteSliceEinde = regels.length;
    let inSlice = false;
    for (let i = eersteSliceIndex; i < regels.length; i += 1) {
        const regel = regels[i] ?? '';
        if (SLICE_KOP.test(regel)) {
            inSlice = true;
            continue;
        }
        if (/^## /.test(regel) && inSlice) {
            laatsteSliceEinde = i;
            break;
        }
    }
    const voor = regels.slice(0, eersteSliceIndex);
    const na = regels.slice(laatsteSliceEinde);
    // Het "Slices"-kopje (## Slices) behouden als het er direct boven staat.
    // Als de regel vóór de eerste slice-kop `## Slices` is, houden we die.
    // Het verwijzingsblok komt onder datzelfde kopje.
    const verwijzingen = kinderen.map((kind) => `- #${String(kind.issue)} — ${kind.naam}`).join('\n');
    const delen = [...voor, verwijzingen, '', ...na];
    return delen.join('\n').trimEnd() + '\n';
}
function leesIssue(issue) {
    const ruw = run('gh', [
        'issue',
        'view',
        String(issue),
        '-R',
        `${EIGENAAR}/${BACKLOG_REPO}`,
        '--json',
        'title,body,labels,url',
    ], { capture: true });
    let data;
    try {
        data = JSON.parse(ruw.stdout);
    }
    catch {
        throw new GebruikersFout(`Kon issue #${String(issue)} niet lezen.`);
    }
    return {
        title: data.title ?? '',
        body: data.body ?? '',
        labels: (data.labels ?? []).map((l) => l.name).filter((n) => n !== undefined),
        url: data.url ?? '',
    };
}
// ---------------------------------------------------------------------------
// App-veld lezen
// ---------------------------------------------------------------------------
/**
 * Leest het App-veld van een issue via het board. Gebruikt een gerichte query die
 * 1–2 GraphQL-punten kost, niet `item-list` (102 punten).
 */
const APP_QUERY = `query($eigenaar:String!,$repo:String!,$project:Int!,$nummer:Int!){
  repository(owner:$eigenaar,name:$repo){ issue(number:$nummer){
    projectItems(first:10){ nodes { project { number }
      app: fieldValueByName(name:"App"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } }
}`;
/** Parset het GraphQL-antwoord tot de App-waarde. Geëxporteerd voor contract-tests. */
export function parseAppAntwoord(ruw) {
    let antwoord;
    try {
        antwoord = JSON.parse(ruw);
    }
    catch {
        return undefined;
    }
    const knoop = antwoord.data?.repository?.issue?.projectItems?.nodes?.find((node) => node.project?.number === PROJECT_NUMMER);
    return knoop?.app?.name ?? undefined;
}
function leesApp(issue) {
    const uitkomst = run('gh', [
        'api',
        'graphql',
        '-f',
        `query=${APP_QUERY}`,
        '-f',
        `eigenaar=${EIGENAAR}`,
        '-f',
        `repo=${BACKLOG_REPO}`,
        '-F',
        `project=${String(PROJECT_NUMMER)}`,
        '-F',
        `nummer=${String(issue)}`,
    ], { capture: true, toleranter: true });
    if (uitkomst.code !== 0) {
        return undefined;
    }
    return parseAppAntwoord(uitkomst.stdout);
}
// ---------------------------------------------------------------------------
// Kind-issue aanmaken
// ---------------------------------------------------------------------------
/** Maakt één child-issue aan en retourneert het issuenummer en de URL. */
function maakKind(ouderUrl, titel, body, labels) {
    // Schrijf de body naar een tijdelijk bestand zodat speciale tekens niet breken.
    const tmpBestand = path.join(tmpdir(), `factory-splits-${String(Date.now())}-${String(Math.random()).slice(2, 8)}.md`);
    writeFileSync(tmpBestand, body, 'utf8');
    const args = [
        'issue',
        'create',
        '-R',
        `${EIGENAAR}/${BACKLOG_REPO}`,
        '--title',
        titel,
        '--body-file',
        tmpBestand,
        '--parent',
        ouderUrl,
    ];
    // Labels meegeven: gh issue create accepteert meerdere --label vlaggen.
    for (const label of labels) {
        args.push('--label', label);
    }
    const uitkomst = run('gh', args, { capture: true, toleranter: true });
    if (uitkomst.code !== 0) {
        waarschuwing(`kon child-issue '${titel}' niet aanmaken.`);
        return undefined;
    }
    // gh issue create print de URL van het nieuwe issue.
    const kindUrl = uitkomst.stdout.trim();
    const match = /\/(\d+)$/.exec(kindUrl);
    if (match?.[1] === undefined) {
        waarschuwing(`kon het issuenummer niet bepalen uit '${kindUrl}'.`);
        return undefined;
    }
    return { issue: Number.parseInt(match[1], 10), url: kindUrl };
}
// ---------------------------------------------------------------------------
// Board-operaties op kinderen
// ---------------------------------------------------------------------------
/**
 * Zet één single-select-veld op een board-item via de issue-URL (naam-gebaseerd).
 * `gh` lost de issue-URL zelf op naar het board-item, zónder een projectItems-GraphQL-
 * lookup — dat is bewust: een net toegevoegd item is via die lookup nog niet zichtbaar
 * (consistentie-lag), de URL-vorm wél.
 */
function zetVeldViaUrl(kindUrl, veld, waarde) {
    const uitkomst = run('gh', [
        'project',
        'item-edit',
        String(PROJECT_NUMMER),
        '--owner',
        EIGENAAR,
        '--url',
        kindUrl,
        '--field',
        veld,
        '--value',
        waarde,
    ], { capture: true, toleranter: true });
    if (uitkomst.code !== 0) {
        waarschuwing(`kon het veld '${veld}' niet op '${waarde}' zetten op ${kindUrl}.`);
    }
}
/**
 * Plaatst een child-issue op het board: voegt het toe, zet het App-veld (als de ouder
 * er een had) en de kolom. Beide velden gaan via {@link zetVeldViaUrl} (de issue-URL),
 * niet via een projectItems-lookup — anders bleef de kolom ongezet op een net
 * aangemaakt kind (#378-nazorg).
 */
function plaatsKindOpBoard(kindUrl, app, kolom) {
    // Voeg het issue toe aan het project (als het er nog niet in zit).
    run('gh', ['project', 'item-add', String(PROJECT_NUMMER), '--owner', EIGENAAR, '--url', kindUrl], { capture: true, toleranter: true });
    if (app !== undefined) {
        zetVeldViaUrl(kindUrl, 'App', app);
    }
    zetVeldViaUrl(kindUrl, 'Status', kolom);
}
/** Wist de kolomwaarde van een issue op het board. Een epic draagt geen kolom. */
function wisKolom(issueUrl) {
    const uitkomst = run('gh', [
        'project',
        'item-edit',
        String(PROJECT_NUMMER),
        '--owner',
        EIGENAAR,
        '--url',
        issueUrl,
        '--field',
        'Status',
        '--clear',
    ], { capture: true, toleranter: true });
    if (uitkomst.code !== 0) {
        waarschuwing(`kon de kolom van de ouder niet wissen.`);
    }
}
// ---------------------------------------------------------------------------
// Titelprefix
// ---------------------------------------------------------------------------
/**
 * Bepaalt het prefix voor de child-titels. Als de ouder-titel een `·` bevat,
 * gebruik het deel ervoor; anders de hele titel.
 */
function titelPrefix(ouderTitel) {
    const punt = ouderTitel.indexOf('·');
    if (punt !== -1) {
        return ouderTitel.slice(0, punt).trim();
    }
    return ouderTitel.trim();
}
// ---------------------------------------------------------------------------
// Hoofdfunctie
// ---------------------------------------------------------------------------
export function splits(issueNummer) {
    if (issueNummer === undefined || issueNummer === '') {
        throw new GebruikersFout('Gebruik: factory splits <issuenummer>');
    }
    const nummer = Number.parseInt(issueNummer, 10);
    if (!Number.isSafeInteger(nummer) || nummer <= 0) {
        throw new GebruikersFout(`'${issueNummer}' is geen geldig issuenummer.`);
    }
    // 1. Lees het issue
    const issue = leesIssue(nummer);
    // 2. Parseer de slices
    const slices = parseSlices(issue.body);
    if (slices.length === 0) {
        ok(`#${String(nummer)} heeft geen meerdere slice-secties — splitsen is niet nodig.`);
        return;
    }
    // 3. Lees het App-veld van de ouder
    const app = leesApp(nummer);
    // 4. Bepaal het titelprefix en de labels voor de kinderen
    const prefix = titelPrefix(issue.title);
    // Kinderen krijgen de labels van de ouder, maar niet type:epic (dat is voor de ouder).
    const kindLabels = issue.labels.filter((l) => l !== EPIC_LABEL);
    // 5. Maak per slice een child-issue aan
    const kinderen = [];
    for (const slice of slices) {
        const kindTitel = `${prefix} · Slice ${String(slice.nummer)} — ${slice.naam}`;
        const kind = maakKind(issue.url, kindTitel, slice.body, kindLabels);
        if (kind === undefined) {
            throw new GebruikersFout(`Kon slice ${String(slice.nummer)} niet aanmaken — geen kinderen gemaakt.`);
        }
        kinderen.push({ issue: kind.issue, naam: slice.naam });
        // Plaats het kind op het board: App-veld (als de ouder er een had) én de kolom
        // Klaar voor Bouwen — beide via de issue-URL, zodat een net aangemaakt kind niet
        // door de consistentie-lag ongeplaatst blijft (#378-nazorg).
        plaatsKindOpBoard(kind.url, app, 'Klaar voor Bouwen');
        ok(`#${String(kind.issue)} — Slice ${String(slice.nummer)} — ${slice.naam}`);
    }
    // 6. Maak de ouder een epic: zet type:epic (als dat nog niet zo is) en haal
    //    type:task eraf — een epic draagt niet ook nog het task-label.
    if (!issue.labels.includes(EPIC_LABEL)) {
        zetLabel(nummer, EPIC_LABEL);
    }
    if (issue.labels.includes('type:task')) {
        verwijderLabel(nummer, 'type:task');
    }
    // 7. Wis de kolom van de ouder (een epic draagt geen kolom)
    wisKolom(issue.url);
    // 8. Herschrijf de ouder-body met verwijzingen naar de kinderen
    const nieuweBody = herschrijfBody(issue.body, kinderen);
    const tmpBestand = path.join(tmpdir(), `factory-splits-body-${String(nummer)}.md`);
    writeFileSync(tmpBestand, nieuweBody, 'utf8');
    schrijfBody(nummer, tmpBestand);
    ok(`#${String(nummer)} is opgesplitst in ${String(kinderen.length)} slices` +
        ` en is nu een epic.`);
}
//# sourceMappingURL=splits.js.map