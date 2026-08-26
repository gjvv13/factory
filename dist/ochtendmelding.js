/**
 * De ochtendmelding (#401): na de nachtbouw één POST naar het assistent-endpoint
 * met per vanzelf-gemergde fastlane-PR de issuenummer, de app en de PR-URL.
 *
 * Fire-and-forget: geen merge → geen melding; URL niet gezet → waarschuwing, geen
 * fout. Hetzelfde patroon als de deploy-faalmelding in `deploy.yml`.
 */
import { ok, waarschuwing } from './shell.js';
/**
 * Bouwt het berichttekst op voor de ochtendmelding.
 *
 * Exporteert dit apart zodat de unit-test de inhoud kan controleren zonder
 * daadwerkelijk een HTTP-request te doen.
 */
export function bouwMelding(items) {
    if (items.length === 1) {
        // De lengte-check hierboven garandeert dat er een element is; noUncheckedIndexedAccess
        // weet dat niet, dus asserteer het.
        const item = items[0];
        if (item === undefined)
            return '';
        return (`🚀 Fastlane: #${String(item.issue)} (${item.app}) is vannacht met auto-merge ingeleverd.\n` +
            item.prUrl);
    }
    const regels = items.map((item) => `• #${String(item.issue)} (${item.app}) — ${item.prUrl}`);
    return `🚀 Fastlane: ${String(items.length)} items zijn vannacht met auto-merge ingeleverd.\n${regels.join('\n')}`;
}
/**
 * Stuurt de ochtendmelding als er fastlane-items zijn. Fire-and-forget.
 *
 * - Geen items → geen melding, geen waarschuwing (geen ruis).
 * - URL niet gezet → waarschuwing, geen fout.
 * - Request faalt → waarschuwing, geen fout.
 */
export async function stuurOchtendmelding(items, notifyUrl, notifyToken, verzend = verstuurMelding) {
    if (items.length === 0) {
        return;
    }
    if (notifyUrl === undefined || notifyUrl === '') {
        waarschuwing(`${String(items.length)} fastlane-item(s) ingeleverd, maar DEPLOY_NOTIFY_URL is niet gezet — geen ochtendmelding verstuurd.`);
        return;
    }
    const tekst = bouwMelding(items);
    const gelukt = await verzend(notifyUrl, tekst, notifyToken);
    if (gelukt) {
        ok('ochtendmelding verstuurd.');
    }
    else {
        waarschuwing('ochtendmelding kon niet worden verstuurd.');
    }
}
/**
 * Verstuurt de melding via HTTP POST. Dezelfde vorm als de deploy-faalmelding in
 * `deploy.yml`: JSON body met `tekst`, bearer-token in de header.
 *
 * Geeft `true` terug bij succes, `false` bij een fout. Gooit niet — de melding mag
 * de nachtrun nooit laten falen.
 */
async function verstuurMelding(url, tekst, token) {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (token !== undefined && token !== '') {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const respons = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ tekst }),
            signal: AbortSignal.timeout(10_000),
        });
        return respons.ok;
    }
    catch (fout) {
        waarschuwing(`melding naar ${url} mislukt: ${fout instanceof Error ? fout.message : String(fout)}`);
        return false;
    }
}
//# sourceMappingURL=ochtendmelding.js.map