import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { bordItems, orkestratorComments } from '../board.js';
import { GebruikersFout, kop, ok, uitvoerVan, waarschuwing } from '../shell.js';
import { werkplaatsWortel } from '../werkplaats.js';
import { versieUitHealth } from './promote.js';
/**
 * De derde taaksoort: een werker die accepteert in plaats van refinet of bouwt (#169).
 *
 * Deze slice levert alleen `--dry`: de wachtrij van acceptabele items en, voor het
 * gekozen item, of acc de nieuwe versie draait — zonder dat er iets geschreven wordt.
 */
/** Waar de accepteer-werker uit put: items die gebouwd en uitgerold zijn. */
const ACCEPTEER_KOLOM = 'Uitrollen';
/** De markering waaraan een bewijs-comment van de accepteer-werker te herkennen is. */
export const ACCEPTEER_MARKERING = '<!-- accepteer:bewijs -->';
const APP_CONFIG_BESTAND = 'factory.json';
/**
 * De accepteer-wachtrij uit één board-lezing: open items op **Uitrollen** die nog geen
 * bewijs-comment van de accepteer-werker dragen, oudste eerst.
 *
 * Het bewijs-commentfilter maakt de wachtrij idempotent: een al geaccepteerd item valt
 * eruit. De comments worden via REST gelezen (aparte pot), niet via het board; het
 * board zelf wordt precies één keer gelezen (#153).
 */
export function accepteerWachtrij(items, cwd) {
    const bruikbaar = [];
    for (const item of items) {
        if (item.kolom !== ACCEPTEER_KOLOM) {
            continue;
        }
        if (item.app === undefined || item.app === '') {
            waarschuwing(`#${String(item.issue)} heeft geen App-veld — overgeslagen.`);
            continue;
        }
        // Bewijs-comment check: als de accepteer-werker al een bewijs-comment heeft
        // geplaatst, dan is dit item al geaccepteerd en hoort het niet meer in de rij.
        const comments = orkestratorComments(item.issue, ACCEPTEER_MARKERING, cwd);
        if (comments.length > 0) {
            continue;
        }
        bruikbaar.push({ ...item, app: item.app });
    }
    return bruikbaar;
}
/**
 * Leest de acc-poort van een app uit haar factory.json.
 *
 * Gebruikt de spiegel in de werkplaats, niet de app-map zelf: de orkestrator draait
 * buiten ~/Documents en heeft de spiegels als leesmap.
 */
export function accPoortVan(app, wortel = werkplaatsWortel) {
    const configPad = path.join(wortel, app, APP_CONFIG_BESTAND);
    if (!existsSync(configPad)) {
        return undefined;
    }
    try {
        const config = JSON.parse(readFileSync(configPad, 'utf8'));
        return config.poorten?.acc;
    }
    catch {
        return undefined;
    }
}
/**
 * Vraagt de draaiende versie op van acc via /health.
 *
 * Dit is een read-only aanroep: alleen een GET op /health, geen schrijvende actie.
 */
export async function accVersie(poort) {
    const url = `http://127.0.0.1:${String(poort)}/health`;
    try {
        const antwoord = await fetch(url);
        if (antwoord.ok) {
            const body = await antwoord.text();
            const versie = versieUitHealth(body);
            return {
                poort,
                ...(versie === undefined ? {} : { draaiend: versie }),
                healthBody: body,
            };
        }
        return { poort };
    }
    catch {
        return { poort };
    }
}
/**
 * Zoekt de oudste release-tag die de merge van een issue bevat.
 *
 * Strategie: zoek in de git-log van de app-repo naar een merge-commit die
 * `slice/<issue>-` in het onderwerp heeft, en bepaal met
 * `git tag --contains <commit> --sort=v:refname` de oudste tag die hem bevat.
 */
export function verwachteTag(issue, appCwd) {
    const commitHash = uitvoerVan('git', ['log', '--all', '--format=%H', `--grep=slice/${String(issue)}-`, '--merges', '-1'], appCwd);
    if (commitHash === undefined || commitHash === '') {
        return undefined;
    }
    const tags = uitvoerVan('git', ['tag', '--contains', commitHash, '--sort=v:refname'], appCwd);
    if (tags === undefined || tags === '') {
        return undefined;
    }
    const eerste = tags.split('\n')[0]?.trim();
    return eerste === undefined || eerste === '' ? undefined : eerste;
}
/**
 * Vergelijkt twee versiestrings (met of zonder v-prefix) als semver.
 * Geeft true als `draaiend` ≥ `verwacht`.
 */
export function versieDekt(draaiend, verwacht) {
    const parse = (v) => {
        const clean = v.replace(/^v/, '');
        const delen = clean.split('.').map(Number);
        return [delen[0] ?? 0, delen[1] ?? 0, delen[2] ?? 0];
    };
    const [dMaj, dMin, dPat] = parse(draaiend);
    const [vMaj, vMin, vPat] = parse(verwacht);
    if (dMaj !== vMaj)
        return dMaj > vMaj;
    if (dMin !== vMin)
        return dMin > vMin;
    return dPat >= vPat;
}
/**
 * Draait de accepteer-taaksoort. In deze slice bestaat alleen `--dry`: alles wat er
 * te zien valt vóórdat er iets gebeurt.
 */
export async function orkestreerAccepteer(opties = {}) {
    if (opties.dry !== true) {
        throw new GebruikersFout('Gebruik: factory orkestreer --soort accepteer --dry (tonen). De accepteer-werker is nog niet gebouwd.');
    }
    const cwd = process.cwd();
    const items = bordItems(cwd);
    if (items === undefined) {
        throw new GebruikersFout('Kon het board niet lezen; zonder wachtrij is er niets te doen.\n' +
            '  Controleer je gh-auth (`gh auth status`) en de GraphQL-limiet\n' +
            '  (`gh api rate_limit --jq .resources.graphql`).');
    }
    const wortel = opties.werkplaatsWortel ?? werkplaatsWortel;
    const wachtrij = accepteerWachtrij(items, cwd);
    kop(`Accepteer-wachtrij: ${ACCEPTEER_KOLOM}`);
    if (wachtrij.length === 0 && opties.issue === undefined) {
        ok('niets te accepteren');
        return;
    }
    for (const item of wachtrij) {
        const nummer = `#${String(item.issue)}`.padEnd(6);
        process.stdout.write(`  ${nummer} ${item.app.padEnd(12)} ${item.titel}\n`);
    }
    const eerste = kiesAccepteerItem(wachtrij, items, opties.issue, cwd);
    if (eerste === undefined) {
        return;
    }
    // Toon de acc-poort en de draaiende versie voor het gekozen item.
    const poort = accPoortVan(eerste.app, wortel);
    if (poort === undefined) {
        process.stdout.write(`\nZou nu toetsen: #${String(eerste.issue)} (${eerste.app}) — ${eerste.titel}\n` +
            `  Geen factory.json gevonden voor ${eerste.app}; acc-poort onbekend.\n` +
            `Er is niets geschreven — niet naar GitHub, niet naar acc.\n`);
        return;
    }
    const info = await accVersie(poort);
    // Bepaal de verwachte tag: de oudste release die de merge van dit issue bevat.
    const appCwd = path.join(wortel, eerste.app);
    const tag = verwachteTag(eerste.issue, appCwd);
    const regels = [
        `\nZou nu toetsen: #${String(eerste.issue)} (${eerste.app}) — ${eerste.titel}`,
        `  acc-poort: ${String(info.poort)}`,
    ];
    if (info.draaiend !== undefined) {
        if (tag !== undefined) {
            const dekt = versieDekt(info.draaiend, tag);
            regels.push(dekt
                ? `  acc draait: ${info.draaiend} ✓ (verwacht ≥ ${tag})`
                : `  acc draait: ${info.draaiend} ✗ (verwacht ≥ ${tag}) — acc draait de nieuwe versie nog niet`);
        }
        else {
            regels.push(`  acc draait: ${info.draaiend} (verwachte tag niet bepaalbaar)`);
        }
    }
    else {
        regels.push(`  acc draait: niet bereikbaar — acc draait de nieuwe versie nog niet`);
    }
    regels.push(`Er is niets geschreven — niet naar GitHub, niet naar acc.`);
    process.stdout.write(regels.join('\n') + '\n');
}
/**
 * Het item waar deze run over gaat: de kop van de rij, of het gevraagde issue.
 *
 * Spiegelt `kiesItem` uit de bouw-taaksoort: een gevraagd issue dat niet in de rij
 * staat is een fout mét de reden.
 */
function kiesAccepteerItem(wachtrij, alles, issue, _cwd) {
    if (issue === undefined) {
        return wachtrij[0];
    }
    const gevraagd = wachtrij.find((item) => item.issue === issue);
    if (gevraagd !== undefined) {
        return gevraagd;
    }
    const inLezing = alles.find((item) => item.issue === issue);
    if (inLezing !== undefined) {
        if (inLezing.kolom !== ACCEPTEER_KOLOM) {
            throw new GebruikersFout(`#${String(issue)} staat niet in de accepteer-wachtrij: het staat op ${inLezing.kolom}, niet op ${ACCEPTEER_KOLOM}.`);
        }
        // Op de juiste kolom maar niet in de wachtrij: al geaccepteerd of geen app.
        throw new GebruikersFout(`#${String(issue)} staat op ${ACCEPTEER_KOLOM} maar valt uit de wachtrij (al geaccepteerd of geen App-veld).`);
    }
    // Niet in de board-lezing.
    throw new GebruikersFout(`#${String(issue)} staat niet op het board, of is gesloten.`);
}
//# sourceMappingURL=orkestreer-accepteer.js.map