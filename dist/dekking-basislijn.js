import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
/**
 * De dekkings-ratchet legt het hoogste dekkingsniveau dat een app ooit haalde vast in een
 * gecommit bestand, en vergelijkt elke `factory verify` daarmee. Zo kan de dekking niet stil
 * wegzakken tot de vaste ondergrens (`dekkingsMinimum`): de lat beweegt met de app mee omhoog
 * en nooit omlaag. Dit bestand bevat de pure logica (lezen, beoordelen, de nieuwe basislijn
 * bepalen); `verify` bedient het en verzorgt de terminaluitvoer.
 */
/** De vier metrics in vaste volgorde, zodat lezen, schrijven en melden gelijk lopen. */
export const METRICS = ['lines', 'statements', 'functions', 'branches'];
/** Bestandsnaam van de basislijn, in de app-root en in versiebeheer. */
export const BASISLIJN_BESTAND = 'dekking-basislijn.json';
const basislijnSchema = z.object({
    lines: z.number().min(0).max(100),
    statements: z.number().min(0).max(100),
    functions: z.number().min(0).max(100),
    branches: z.number().min(0).max(100),
});
/**
 * Leest de basislijn van schijf, of undefined als die er (nog) niet is of onleesbaar is.
 * Een kapot bestand mag de poort niet laten omvallen: dan behandelen we het als afwezig en
 * legt de eerstvolgende volledige verify een verse basislijn vast.
 */
export function leesBasislijn(appDir) {
    const bestand = path.join(appDir, BASISLIJN_BESTAND);
    if (!existsSync(bestand)) {
        return undefined;
    }
    try {
        const parsed = basislijnSchema.safeParse(JSON.parse(readFileSync(bestand, 'utf8')));
        return parsed.success ? parsed.data : undefined;
    }
    catch {
        return undefined;
    }
}
/** Schrijft de basislijn met vaste sleutelvolgorde en een sluitende nieuwe regel. */
export function schrijfBasislijn(appDir, cijfers) {
    const geordend = Object.fromEntries(METRICS.map((m) => [m, cijfers[m]]));
    writeFileSync(path.join(appDir, BASISLIJN_BESTAND), `${JSON.stringify(geordend, null, 2)}\n`);
}
/**
 * Beoordeelt de gemeten dekking tegen de basislijn. Zonder basislijn is het een bootstrap: we
 * geven de meting terug als vast te leggen basislijn en oordelen niet. Met basislijn geldt per
 * metric: zakt hij verder dan `tolerantie` onder de vastgelegde waarde, dan is het een
 * regressie; komt hij er verder dan `tolerantie` bovenuit, dan schuift die metric omhoog. De
 * tolerantie vangt de kleine run-op-run-ruis van v8 en houdt de basislijn stabiel. De nieuwe
 * basislijn neemt per metric het maximum van oud en nu, dus hij daalt nooit.
 */
export function beoordeelRatchet(nu, basislijn, tolerantie) {
    if (basislijn === undefined) {
        return { bootstrap: true, regressies: [], verhogingen: [], nieuweBasislijn: nu };
    }
    const regressies = [];
    const verhogingen = [];
    for (const naam of METRICS) {
        const verschil = { naam, nu: nu[naam], was: basislijn[naam] };
        if (nu[naam] < basislijn[naam] - tolerantie) {
            regressies.push(verschil);
        }
        else if (nu[naam] > basislijn[naam] + tolerantie) {
            verhogingen.push(verschil);
        }
    }
    const nieuweBasislijn = verhogingen.length > 0
        ? Object.fromEntries(METRICS.map((m) => [m, Math.max(basislijn[m], nu[m])]))
        : undefined;
    return { bootstrap: false, regressies, verhogingen, nieuweBasislijn };
}
//# sourceMappingURL=dekking-basislijn.js.map