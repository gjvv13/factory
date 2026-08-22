import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { leesAppConfig, zoekAppDir } from './app-config.js';
import { GebruikersFout } from './shell.js';
export const DEKKING_CONFIG_BESTAND = 'dekking.json';
/**
 * Schema voor `dekking.json`: de lichtere dekkingsconfiguratie voor repo's zonder
 * `factory.json` (de factory zelf). De validatie spiegelt de dekkingsvelden in
 * `appConfigSchema` (`app-config.ts`); een wijziging aan bereik of defaults moet
 * op beide plekken landen.
 */
const dekkingsConfigSchema = z.object({
    dekkingsMinimum: z.number().min(0).max(100).optional(),
    dekkingsRatchet: z.enum(['uit', 'waarschuw', 'blokkeer']).default('waarschuw'),
    dekkingsTolerantie: z.number().min(0).max(5).default(0.5),
});
/**
 * Leest de dekkingsconfiguratie uit de repo. Zoekt eerst `factory.json` (de volledige
 * app-config; extraheert de dekkingsvelden), dan `dekking.json` in de repo-root. Zonder
 * beide: `undefined` — er is geen dekkingsconfiguratie en de ratchet draait niet.
 */
export function leesDekkingsConfig(repoDir) {
    // Pad 1: volledige app-config (factory.json) — apps gebruiken dit.
    const appDir = zoekAppDir(repoDir);
    if (appDir !== undefined) {
        const appConfig = leesAppConfig(appDir);
        return {
            dir: appConfig.appDir,
            dekkingsMinimum: appConfig.dekkingsMinimum,
            dekkingsRatchet: appConfig.dekkingsRatchet,
            dekkingsTolerantie: appConfig.dekkingsTolerantie,
        };
    }
    // Pad 2: lichtere dekking-only config (dekking.json) — de factory zelf.
    const bestand = path.join(repoDir, DEKKING_CONFIG_BESTAND);
    if (!existsSync(bestand)) {
        return undefined;
    }
    let inhoud;
    try {
        inhoud = JSON.parse(readFileSync(bestand, 'utf8'));
    }
    catch {
        throw new GebruikersFout(`${bestand} is geen geldige JSON.`);
    }
    const parsed = dekkingsConfigSchema.safeParse(inhoud);
    if (!parsed.success) {
        const details = parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ');
        throw new GebruikersFout(`${bestand} is ongeldig: ${details}`);
    }
    return { dir: repoDir, ...parsed.data };
}
//# sourceMappingURL=dekking-config.js.map