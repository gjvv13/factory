import { z } from 'zod';
import type { AppConfig } from './app-config.js';
/** Het contract dat het `config:sleutels`-script op stdout print. */
declare const sleutelContractSchema: z.ZodObject<{
    verwacht: z.ZodArray<z.ZodString>;
    geheim: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type SleutelContract = z.infer<typeof sleutelContractSchema>;
export interface SleutelToetsResultaat {
    readonly omgeving: string;
    readonly ontbrekend: readonly string[];
    readonly ontbrekendGeheim: readonly string[];
    readonly nietControleerbaar: number;
    readonly leeg: readonly string[];
}
/**
 * Vergelijkt de verwachte sleutels (uit het `config:sleutels`-script) met de
 * env-bestanden van één omgeving. Hergebruikt `configSamenvatting` uit
 * `env-herstart.ts`, die al per omgeving rapporteert welke bestanden er zijn,
 * welke sleutels erin staan en welke leeg zijn.
 */
export declare function vergelijkSleutels(appDir: string, omgeving: 'acc' | 'prod', contract: SleutelContract): SleutelToetsResultaat;
/**
 * Draait het `config:sleutels`-script en parst de uitvoer. Geeft `undefined` als
 * de uitvoer niet geldig is — dan is het script kapot, niet de config.
 */
export declare function leesSleutelContract(repoDir: string): SleutelContract | undefined;
/**
 * De config-sleuteltoets: controleert per omgeving of de env-bestanden de sleutels
 * bevatten die de code verwacht. Draait alleen bij de volledige poort (niet bij
 * `--snel` of `--pre-commit`), net als audit.
 */
export declare function toetsConfigSleutels(repoDir: string, config: AppConfig | undefined, scripts: ReadonlySet<string>): void;
export {};
