/**
 * De regie-brief (#404): een beslis-gericht overzicht over alle apps heen.
 *
 * Pure functies, geen I/O: de brief wordt opgebouwd uit data die de aanroeper
 * levert. De vier secties — gebouwd/gemergd, wacht op akkoord, geëscaleerd,
 * vastgelopen/stil — verschijnen alleen als er iets in staat (geen ruis).
 */
// ---------------------------------------------------------------------------
// Constanten
// ---------------------------------------------------------------------------
/** Items op een werkkolom zonder wijziging in deze periode tellen als "stil". */
export const STIL_DREMPEL_MS = 72 * 3_600_000;
const ISSUE_URL = 'https://github.com/gjvv13/factory/issues';
/** Kolommen waar actief aan gewerkt wordt; stilstand hier is een signaal. */
const WERK_KOLOMMEN = new Set(['Bouwen', 'Wacht op merge', 'Uitrollen']);
/**
 * Kolommen waarvan items "wacht op akkoord" zijn: iemand moet een besluit nemen.
 * Items met het escalatie-label komen in een aparte sectie.
 */
const AKKOORD_KOLOMMEN = new Set([
    'Technisch refinen',
    'Wacht op akkoord',
    'Wacht op merge',
]);
function issueLink(issue, titel) {
    const label = titel !== undefined ? `#${String(issue)} ${titel}` : `#${String(issue)}`;
    return `[${label}](${ISSUE_URL}/${String(issue)})`;
}
/** Sectie "gebouwd/gemergd": runlog-entries van de afgelopen 24 uur. */
function gebouwdSectie(bronnen) {
    const grens = new Date(bronnen.nu.getTime() - 24 * 3_600_000).toISOString();
    const recent = bronnen.runlog.filter((entry) => entry.moment >= grens);
    if (recent.length === 0)
        return undefined;
    const regels = recent.map((entry) => {
        const kosten = entry.kosten !== undefined ? ` (${entry.kosten})` : '';
        return `- ${issueLink(entry.issue)} · ${entry.app} · ${entry.soort} → ${entry.uitkomst}${kosten}`;
    });
    return { kop: '📦 Gebouwd / gemergd', regels };
}
/** Sectie "wacht op akkoord": items op akkoord-kolommen, min escalaties. */
function wachtOpAkkoordSectie(bronnen) {
    const regels = bronnen.items
        .filter((item) => AKKOORD_KOLOMMEN.has(item.kolom) && !bronnen.escalatieNummers.has(item.issue))
        .map((item) => `- ${issueLink(item.issue, item.titel)} · ${item.kolom}${item.app !== undefined ? ` · ${item.app}` : ''}`);
    if (regels.length === 0)
        return undefined;
    return { kop: '👀 Wacht op jouw akkoord', regels };
}
/** Sectie "geëscaleerd": items met escalatie-label + context. */
function geescaleerdSectie(bronnen) {
    const geescaleerd = bronnen.items.filter((item) => bronnen.escalatieNummers.has(item.issue));
    if (geescaleerd.length === 0)
        return undefined;
    const contextMap = new Map(bronnen.escalatieContext.map((ctx) => [ctx.issue, ctx]));
    const regels = geescaleerd.flatMap((item) => {
        const ctx = contextMap.get(item.issue);
        const hoofd = `- ${issueLink(item.issue, item.titel)}${item.app !== undefined ? ` · ${item.app}` : ''}`;
        if (ctx === undefined)
            return [hoofd];
        return [hoofd, `  Vraag: ${ctx.vraag}`, `  Advies: ${ctx.advies}`];
    });
    return { kop: '🚨 Geëscaleerd', regels };
}
/** Sectie "vastgelopen/stil": items op werkkolommen zonder recente update. */
function vastgelopenSectie(bronnen) {
    const grens = new Date(bronnen.nu.getTime() - STIL_DREMPEL_MS).toISOString();
    const stille = bronnen.items.filter((item) => WERK_KOLOMMEN.has(item.kolom) && item.bijgewerkt !== undefined && item.bijgewerkt < grens);
    if (stille.length === 0)
        return undefined;
    const regels = stille.map((item) => `- ${issueLink(item.issue, item.titel)} · ${item.kolom}${item.app !== undefined ? ` · ${item.app}` : ''} — stil sinds ${item.bijgewerkt !== undefined ? item.bijgewerkt.slice(0, 10) : '?'}`);
    return { kop: '⏸️ Vastgelopen / stil', regels };
}
/** Deploy-status per app, als aanvulling onderaan de brief. */
function deployStatusSectie(bronnen) {
    if (bronnen.deployRuns.length === 0)
        return undefined;
    const regels = bronnen.deployRuns.map((run) => {
        const icoon = run.conclusion === 'success' ? '✅' : '❌';
        return `- ${run.app}: ${icoon} ${run.conclusion} — [run](${run.url})`;
    });
    return { kop: '🚀 Laatste deploy per app', regels };
}
// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------
/**
 * Bouwt de regie-brief als markdown-tekst. Lege secties worden weggelaten;
 * als alles leeg is, levert dit een "niets te melden"-melding.
 */
export function bouwBrief(bronnen) {
    const secties = [
        gebouwdSectie(bronnen),
        wachtOpAkkoordSectie(bronnen),
        geescaleerdSectie(bronnen),
        vastgelopenSectie(bronnen),
        deployStatusSectie(bronnen),
    ].filter((sectie) => sectie !== undefined);
    if (secties.length === 0) {
        return 'Niets te melden — alles stil.';
    }
    return secties.map((sectie) => `### ${sectie.kop}\n${sectie.regels.join('\n')}`).join('\n\n');
}
// ---------------------------------------------------------------------------
// Runlog-parser
// ---------------------------------------------------------------------------
/**
 * Parset één regel uit het orkestrator-runlog.
 *
 * Formaat (uit `logRun`): `<ISO> #<issue> <app> <soort> <uitkomst> <kosten> <beurten> beurten [uitsplitsing]`
 */
export function parseRunlogRegel(regel) {
    // Voorbeeld: 2026-09-04T04:12:00.000Z #91 assistant bouw klaar $2.09 14 beurten
    const match = /^(\S+)\s+#(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+/.exec(regel);
    if (match === null)
        return undefined;
    const [, moment, issueStr, app, soort, uitkomst, kosten] = match;
    if (moment === undefined ||
        issueStr === undefined ||
        app === undefined ||
        soort === undefined ||
        uitkomst === undefined) {
        return undefined;
    }
    const issue = Number.parseInt(issueStr, 10);
    if (!Number.isSafeInteger(issue) || issue <= 0)
        return undefined;
    return { moment, issue, app, soort, uitkomst, ...(kosten === undefined ? {} : { kosten }) };
}
/**
 * Parset het hele runlog en filtert op de afgelopen `urenTerug` uur.
 * Robuust: ongeldige regels worden stilletjes overgeslagen.
 */
export function parseRunlog(inhoud, nu, urenTerug = 24) {
    const grens = new Date(nu.getTime() - urenTerug * 3_600_000).toISOString();
    return inhoud
        .split('\n')
        .map(parseRunlogRegel)
        .filter((entry) => entry !== undefined && entry.moment >= grens);
}
//# sourceMappingURL=regie-brief.js.map