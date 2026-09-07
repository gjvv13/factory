/**
 * Parser voor het orkestrator-runlog (#544).
 *
 * Het logbestand is platte tekst, append-only, geschreven door `logRun` in
 * `orkestrator-instellingen.ts`. Elke regel heeft het formaat:
 *
 *   <ISO> #<issue> <app> <soort> <uitkomst> <kosten> <beurten> beurten [uitsplitsing] [w:N:tool1,tool2]
 *
 * De wrijvingssuffix `[w:…]` is optioneel en verschijnt alleen bij runs met
 * geweigerde gereedschappen. Oude regels zonder suffix parsen met weigeringen=0.
 */
import { readFileSync } from 'node:fs';
/**
 * Parset één logregel naar een `RunLogRecord`.
 *
 * Retourneert `undefined` bij een ongeldige regel — robuust, zodat een
 * beschadigd logbestand de hele aggregatie niet omgooit.
 */
export function parseRunLogRegel(regel) {
    // Basis: <ISO> #<issue> <app> <soort> <uitkomst> <kosten> <beurten> beurten
    const match = /^(\S+)\s+#(\d+)\s+(\S+)\s+(refine|bouw|accepteer)\s+(\S+)\s+(\S+)\s+(\d+|\?)\s+beurten/.exec(regel);
    if (match === null)
        return undefined;
    const [, momentStr, issueStr, app, soort, uitkomst, kostenStr, beurtenStr] = match;
    if (momentStr === undefined ||
        issueStr === undefined ||
        app === undefined ||
        soort === undefined ||
        uitkomst === undefined) {
        return undefined;
    }
    const moment = new Date(momentStr);
    if (Number.isNaN(moment.getTime()))
        return undefined;
    const issue = Number.parseInt(issueStr, 10);
    if (!Number.isSafeInteger(issue) || issue <= 0)
        return undefined;
    const kosten = kostenStr === undefined || kostenStr === '?'
        ? undefined
        : Number.parseFloat(kostenStr.replace(/^\$/, ''));
    const beurten = beurtenStr === undefined || beurtenStr === '?' ? undefined : Number.parseInt(beurtenStr, 10);
    // Wrijvingssuffix: [w:N:tool1,tool2]
    const wMatch = /\[w:(\d+):([^\]]*)\]/.exec(regel);
    let weigeringen = 0;
    let geweigerd = [];
    if (wMatch !== null) {
        const wCountStr = wMatch[1];
        const toolsStr = wMatch[2];
        if (wCountStr !== undefined) {
            weigeringen = Number.parseInt(wCountStr, 10);
        }
        if (toolsStr !== undefined && toolsStr !== '') {
            // Spaties waren bij schrijven vervangen door `-`; zet ze terug.
            geweigerd = toolsStr.split(',').map((t) => t.replace(/-/g, ' '));
        }
    }
    return {
        moment,
        issue,
        app,
        soort: soort,
        uitkomst,
        ...(kosten === undefined || Number.isNaN(kosten) ? {} : { kosten }),
        ...(beurten === undefined || Number.isNaN(beurten) ? {} : { beurten }),
        weigeringen,
        geweigerd,
    };
}
/**
 * Leest het runlog en retourneert de laatste `n` records.
 *
 * Robuust: een ontbrekend of leeg bestand retourneert []. Ongeldige regels
 * worden overgeslagen.
 */
export function leesRunLog(pad, n) {
    let inhoud;
    try {
        inhoud = readFileSync(pad, 'utf8');
    }
    catch {
        // Bestand mist of onleesbaar — normaal bij een verse installatie.
        return [];
    }
    if (inhoud.trim() === '')
        return [];
    const regels = inhoud.trim().split('\n');
    // Alleen de laatste `n` regels parsen als n is opgegeven (efficiënt bij grote logs).
    const bronRegels = n === undefined ? regels : regels.slice(-n);
    const records = bronRegels
        .map(parseRunLogRegel)
        .filter((r) => r !== undefined);
    return n === undefined ? records : records.slice(-n);
}
//# sourceMappingURL=runlog.js.map