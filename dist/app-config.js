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
    // Paden (relatief aan de app-map) die `factory sync --check` bewust niet als
    // drift meldt. Zonder deze sleutel in het schema zou Zod hem stil strippen.
    syncNegeer: z.array(z.string()).optional(),
    /** Optionele ondergrens (0–100) waaronder `factory verify` faalt op te weinig dekking. */
    dekkingsMinimum: z.number().min(0).max(100).optional(),
    /**
     * Gedrag van de dekkings-ratchet: de bewegende lat die de dekking vergelijkt met het
     * hoogste punt dat de app ooit haalde (vastgelegd in `dekking-basislijn.json`). `waarschuw`
     * meldt een daling geel maar laat de poort groen; `blokkeer` laat `verify` falen; `uit` zet
     * de ratchet stil. Default `waarschuw`: advies-eerst, zonder een app meteen rood te zetten.
     */
    dekkingsRatchet: z.enum(['uit', 'waarschuw', 'blokkeer']).default('waarschuw'),
    /**
     * Speling in procentpunten waarmee de ratchet rekent, tegen de kleine run-op-run-ruis van
     * v8-coverage. Een daling kleiner dan dit telt niet als regressie; pas boven deze marge
     * beweegt de basislijn omhoog. Default 0.5.
     */
    dekkingsTolerantie: z.number().min(0).max(5).default(0.5),
    /**
     * Hoe `factory inleveren` een branch integreert. `merge-queue` (default) gebruikt de
     * GitHub merge-queue (werkt op de publieke factory-repo). `lokaal` gebruikt de
     * factory-eigen wachtrij: de PR krijgt het label `wachtrij` en `factory integreer`
     * op de mini werkt die rij serieel af — voor de private apps waar de merge-queue niet
     * beschikbaar is.
     */
    integratie: z.enum(['merge-queue', 'lokaal']).default('merge-queue'),
    /**
     * Gedrag van de afhankelijkheden-audit in de volledige `factory verify`. `waarschuw`
     * (default) meldt kwetsbare pakketten geel en houdt de poort groen; `blokkeer` laat
     * verify falen; `uit` slaat de stap over. Advies-eerst, net als de dekkings-ratchet:
     * een advisory in een transitieve dev-dependency mag een release niet gijzelen
     * zolang je hem nog niet beoordeeld hebt.
     */
    audit: z.enum(['uit', 'waarschuw', 'blokkeer']).default('waarschuw'),
    /** Vanaf welke ernst de audit meetelt. Default `high`: lager is in de praktijk ruis. */
    auditNiveau: z.enum(['low', 'moderate', 'high', 'critical']).default('high'),
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
function leesEnvBestand(bestand) {
    if (!existsSync(bestand)) {
        return {};
    }
    const resultaat = {};
    for (const regel of readFileSync(bestand, 'utf8').split('\n')) {
        const getrimd = regel.trim();
        if (getrimd === '' || getrimd.startsWith('#')) {
            continue;
        }
        const scheiding = getrimd.indexOf('=');
        if (scheiding === -1) {
            continue;
        }
        // Splitsen op de eerste `=`: waarden mogen zelf een `=` of spaties bevatten.
        resultaat[getrimd.slice(0, scheiding)] = getrimd.slice(scheiding + 1);
    }
    return resultaat;
}
/**
 * Leest de omgevingswaarden zoals de pm2-ecosystem dat doet: eerst `<omgeving>.env`,
 * dan `<omgeving>.secrets.env` eroverheen. Zo draaien migrate en seed met dezelfde
 * `DATABASE_FILE` (en de rest) als de draaiende omgeving, in plaats van terug te
 * vallen op de standaardwaarden uit de config.
 */
export function leesOmgevingsWaarden(appDir, omgeving) {
    const map = path.join(appDir, 'environments');
    return {
        ...leesEnvBestand(path.join(map, `${omgeving}.env`)),
        ...leesEnvBestand(path.join(map, `${omgeving}.secrets.env`)),
    };
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