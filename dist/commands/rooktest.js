import { vereisAppConfig, vereisOmgeving } from '../app-config.js';
import { GebruikersFout, kop, ok, waarschuwing } from '../shell.js';
/** Hoe lang (ms) we op één rooktest-aanroep wachten voordat we hem als mislukt zien. */
const TIME_OUT_MS = 10_000;
/** Aantal pogingen: de omgeving is net gezond bevonden, maar geef 'm even lucht. */
const POGINGEN = 3;
/** Doet één rooktest-aanroep en beoordeelt status én (optioneel) de inhoud. */
async function voerUit(url, methode, body, verwachteStatus, bevat) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort();
    }, TIME_OUT_MS);
    try {
        const antwoord = await fetch(url, {
            method: methode,
            signal: controller.signal,
            ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body }),
        });
        if (antwoord.status !== verwachteStatus) {
            return {
                goed: false,
                reden: `status ${String(antwoord.status)} i.p.v. ${String(verwachteStatus)}`,
            };
        }
        if (bevat !== undefined) {
            const tekst = await antwoord.text();
            if (!tekst.includes(bevat)) {
                return { goed: false, reden: `antwoord bevat '${bevat}' niet` };
            }
        }
        return { goed: true };
    }
    catch (error) {
        return { goed: false, reden: error instanceof Error ? error.message : String(error) };
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Draait de in `factory.json` beschreven rooktest tegen een omgeving: één echte,
 * read-only aanroep door de kern na een uitrol (#121). Slaagt hij niet, dan faalt dit
 * commando luid — de deploy-job wordt rood (en dat meldt zich via de gefaalde-deploy-
 * melding, #112) — met een expliciet terugrol-voorstel. We rollen bewust **niet**
 * automatisch terug: dat kan verrassender zijn dan het probleem. Zonder een
 * geconfigureerde rooktest is dit een no-op, zodat de deploy-workflow 'm altijd mag
 * aanroepen.
 */
export async function rooktest(omgevingArgument) {
    const omgeving = vereisOmgeving(omgevingArgument);
    const config = vereisAppConfig();
    const rt = config.rooktest;
    if (rt === undefined) {
        ok(`geen rooktest geconfigureerd voor ${config.naam} — overgeslagen.`);
        return;
    }
    const poort = config.poorten[omgeving];
    const url = `http://127.0.0.1:${String(poort)}${rt.pad}`;
    kop(`Rooktest ${omgeving} (${config.naam})`);
    let laatste = { goed: false, reden: 'niet uitgevoerd' };
    for (let poging = 0; poging < POGINGEN; poging += 1) {
        laatste = await voerUit(url, rt.methode, rt.body, rt.verwachteStatus, rt.bevat);
        if (laatste.goed) {
            ok(`prod-kern antwoordt: ${rt.methode} ${rt.pad} → ${String(rt.verwachteStatus)}`);
            return;
        }
        if (poging < POGINGEN - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
    // Gefaald: geen automatische terugrol, wél een duidelijke melding met de terugweg.
    waarschuwing(`Rooktest ${omgeving} faalde: ${laatste.reden ?? 'onbekende reden'}.`);
    throw new GebruikersFout(`Rooktest ${omgeving} faalde (${laatste.reden ?? 'onbekende reden'}). ` +
        `${omgeving} draait de nieuwe versie, maar de kern antwoordt niet zoals verwacht. ` +
        `Rol zo nodig terug met \`factory terugrol ${omgeving}\` (of \`factory promote ${omgeving} <vorige tag>\`).`);
}
//# sourceMappingURL=rooktest.js.map