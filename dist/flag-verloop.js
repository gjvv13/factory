import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { GebruikersFout, kop, ok, waarschuwing } from './shell.js';
export const FLAG_META_BESTAND = 'flag-meta.json';
const flagMetaEntrySchema = z
    .object({
    verlooptOp: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'verwacht JJJJ-MM-DD')
        .refine((s) => !isNaN(new Date(`${s}T00:00:00`).getTime()), 'geen geldige datum')
        .optional(),
    permanent: z.literal(true).optional(),
    beschrijving: z.string().optional(),
})
    .refine((e) => {
    const heeftVerloop = e.verlooptOp !== undefined;
    const heeftPermanent = e.permanent === true;
    // Precies één van beide moet gezet zijn, niet allebei en niet geen van beide.
    return heeftVerloop !== heeftPermanent;
}, 'een flag heeft óf verlooptOp óf permanent: true, niet allebei en niet geen van beide');
const flagMetaSchema = z.record(z.string(), flagMetaEntrySchema);
/**
 * Leest en valideert `flag-meta.json` uit de opgegeven map. Geeft `undefined` als
 * het bestand niet bestaat — dat is een stille no-op, geen fout. Een bestaand maar
 * ongeldig bestand gooit wél: wie het neerzet, moet het goed doen.
 */
export function leesFlagMeta(dir) {
    const bestand = path.join(dir, FLAG_META_BESTAND);
    if (!existsSync(bestand))
        return undefined;
    let inhoud;
    try {
        inhoud = readFileSync(bestand, 'utf8');
    }
    catch {
        return undefined;
    }
    let data;
    try {
        data = JSON.parse(inhoud);
    }
    catch {
        throw new GebruikersFout(`${bestand} bevat geen geldige JSON.`);
    }
    const resultaat = flagMetaSchema.safeParse(data);
    if (!resultaat.success) {
        const details = resultaat.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
        throw new GebruikersFout(`${bestand} is ongeldig: ${details}`);
    }
    return resultaat.data;
}
/**
 * Beoordeelt elke flag uit de metadata tegen de opgegeven datum. De datum is
 * injecteerbaar zodat tests niet van de kalender afhangen.
 */
export function beoordeelFlagVerloop(meta, vandaag) {
    const vandaagStart = new Date(vandaag.getFullYear(), vandaag.getMonth(), vandaag.getDate());
    const statussen = [];
    for (const [naam, entry] of Object.entries(meta)) {
        if (entry.permanent === true) {
            statussen.push({ naam, soort: 'permanent', verlooptOp: undefined, dagen: undefined });
            continue;
        }
        if (entry.verlooptOp !== undefined) {
            const verloopDatum = new Date(`${entry.verlooptOp}T00:00:00`);
            const verschilMs = vandaagStart.getTime() - verloopDatum.getTime();
            // Math.round vangt eventuele DST-drift op (23- of 25-uursdagen).
            const dagen = Math.round(verschilMs / (1000 * 60 * 60 * 24));
            statussen.push({
                naam,
                soort: dagen >= 0 ? 'verlopen' : 'actief',
                verlooptOp: entry.verlooptOp,
                dagen,
            });
        }
    }
    return statussen;
}
/** Menselijke beschrijving van de vervalstatus, voor gebruik in verify en flag-lijsten. */
export function beschrijfVervalstatus(status) {
    if (status.soort === 'permanent')
        return 'permanent';
    if (status.verlooptOp === undefined || status.dagen === undefined)
        return '';
    if (status.dagen === 0)
        return `mocht weg op ${status.verlooptOp} (vandaag)`;
    if (status.dagen > 0) {
        const tekst = status.dagen === 1 ? '1 dag geleden' : `${String(status.dagen)} dagen geleden`;
        return `mocht weg op ${status.verlooptOp} (${tekst})`;
    }
    const resterend = -status.dagen;
    const tekst = resterend === 1 ? '1 dag' : `${String(resterend)} dagen`;
    return `verloopt op ${status.verlooptOp} (${tekst})`;
}
/**
 * Toetst de feature-flag-vervaldata in de opgegeven map. Draait als stap in
 * `factory verify`, na de dekkings-ratchet en vóór de afhankelijkheden-audit.
 *
 * Zonder `flag-meta.json` is dit een stille no-op. Met verlopen flags:
 * `waarschuw` meldt geel, `blokkeer` gooit een `GebruikersFout`.
 */
export function toetsFlagVerloop(dir, stand, vandaag) {
    const meta = leesFlagMeta(dir);
    if (meta === undefined)
        return;
    const statussen = beoordeelFlagVerloop(meta, vandaag);
    if (statussen.length === 0)
        return;
    kop('Feature flags');
    const verlopen = [];
    for (const s of statussen) {
        if (s.soort === 'verlopen') {
            verlopen.push(s);
            waarschuwing(`${s.naam} — ${beschrijfVervalstatus(s)}`);
        }
        else {
            ok(`${s.naam} — ${beschrijfVervalstatus(s)}`);
        }
    }
    if (verlopen.length > 0 && stand === 'blokkeer') {
        const namen = verlopen.map((v) => v.naam).join(', ');
        throw new GebruikersFout(`${String(verlopen.length)} verlopen feature flag${verlopen.length === 1 ? '' : 's'}: ${namen}. Verwijder de flag${verlopen.length === 1 ? '' : 's'} of pas de datum aan in ${FLAG_META_BESTAND}.`);
    }
}
//# sourceMappingURL=flag-verloop.js.map