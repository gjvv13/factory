import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { GebruikersFout } from './shell.js';
export const OMGEVINGEN = ['dev', 'acc', 'prod'];
const appConfigSchema = z.object({
    naam: z
        .string()
        .min(1)
        .regex(/^[a-z][a-z0-9-]*$/, 'gebruik kleine letters, cijfers en streepjes'),
    poorten: z.object({
        dev: z.number().int().min(1).max(65535),
        acc: z.number().int().min(1).max(65535),
        prod: z.number().int().min(1).max(65535),
    }),
    envRoot: z.string().min(1),
    backlog: z.string().min(1),
});
export const APP_CONFIG_BESTAND = 'factory.json';
function absoluut(basis, pad) {
    const uitgevouwen = pad.startsWith('~') ? path.join(os.homedir(), pad.slice(1)) : pad;
    return path.resolve(basis, uitgevouwen);
}
/** Zoekt factory.json vanaf een map omhoog, zodat de CLI ook in submappen werkt. */
export function zoekAppDir(start = process.cwd()) {
    let huidig = path.resolve(start);
    for (;;) {
        if (existsSync(path.join(huidig, APP_CONFIG_BESTAND))) {
            return huidig;
        }
        const ouder = path.dirname(huidig);
        if (ouder === huidig) {
            return undefined;
        }
        huidig = ouder;
    }
}
export function leesAppConfig(appDir) {
    const bestand = path.join(appDir, APP_CONFIG_BESTAND);
    const parsed = appConfigSchema.safeParse(JSON.parse(readFileSync(bestand, 'utf8')));
    if (!parsed.success) {
        const details = parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ');
        throw new GebruikersFout(`${bestand} is ongeldig: ${details}`);
    }
    const config = parsed.data;
    return {
        ...config,
        appDir,
        envRootPad: absoluut(appDir, config.envRoot),
        backlogPad: absoluut(appDir, config.backlog),
    };
}
/**
 * De configuratie van de applicatie waarin de CLI draait.
 * Commando's die per applicatie werken (promote, env, flag) hebben dit nodig.
 */
export function vereisAppConfig() {
    const appDir = zoekAppDir();
    if (appDir === undefined) {
        throw new GebruikersFout(`Geen ${APP_CONFIG_BESTAND} gevonden. Dit commando hoort in een applicatiemap te draaien.`);
    }
    return leesAppConfig(appDir);
}
/** Werkmap van een omgeving: dev is de repo zelf, acc en prod zijn losse clones. */
export function werkmapVan(config, omgeving) {
    return omgeving === 'dev' ? config.appDir : path.join(config.envRootPad, omgeving);
}
export function pm2NaamVan(config, omgeving) {
    return `${config.naam}-${omgeving}`;
}
export function isOmgeving(waarde) {
    return waarde !== undefined && OMGEVINGEN.includes(waarde);
}
export function vereisOmgeving(waarde) {
    if (!isOmgeving(waarde)) {
        throw new GebruikersFout(`Geef een omgeving op: ${OMGEVINGEN.join(', ')}`);
    }
    return waarde;
}
//# sourceMappingURL=app-config.js.map