import { z } from 'zod';
export declare const OMGEVINGEN: readonly ["dev", "acc", "prod"];
export type Omgeving = (typeof OMGEVINGEN)[number];
declare const appConfigSchema: z.ZodObject<{
    naam: z.ZodString;
    poorten: z.ZodObject<{
        dev: z.ZodNumber;
        acc: z.ZodNumber;
        prod: z.ZodNumber;
    }, z.core.$strip>;
    envRoot: z.ZodString;
    syncNegeer: z.ZodOptional<z.ZodArray<z.ZodString>>;
    dekkingsMinimum: z.ZodOptional<z.ZodNumber>;
    dekkingsRatchet: z.ZodDefault<z.ZodEnum<{
        uit: "uit";
        waarschuw: "waarschuw";
        blokkeer: "blokkeer";
    }>>;
    dekkingsTolerantie: z.ZodDefault<z.ZodNumber>;
    integratie: z.ZodDefault<z.ZodEnum<{
        "merge-queue": "merge-queue";
        lokaal: "lokaal";
    }>>;
    audit: z.ZodDefault<z.ZodEnum<{
        uit: "uit";
        waarschuw: "waarschuw";
        blokkeer: "blokkeer";
    }>>;
    auditNiveau: z.ZodDefault<z.ZodEnum<{
        low: "low";
        moderate: "moderate";
        high: "high";
        critical: "critical";
    }>>;
    rooktest: z.ZodOptional<z.ZodObject<{
        pad: z.ZodString;
        methode: z.ZodDefault<z.ZodEnum<{
            GET: "GET";
            POST: "POST";
        }>>;
        body: z.ZodOptional<z.ZodString>;
        verwachteStatus: z.ZodDefault<z.ZodNumber>;
        bevat: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AppConfigBestand = z.infer<typeof appConfigSchema>;
export interface AppConfig extends AppConfigBestand {
    /** Map van de applicatie zelf (waar factory.json staat). */
    readonly appDir: string;
    /** Absoluut pad naar de map met de acc- en prod-clones. */
    readonly envRootPad: string;
}
export declare const APP_CONFIG_BESTAND = "factory.json";
/** Zoekt factory.json vanaf een map omhoog, zodat de CLI ook in submappen werkt. */
export declare function zoekAppDir(start?: string): string | undefined;
export declare function leesAppConfig(appDir: string): AppConfig;
/**
 * De configuratie van de applicatie waarin de CLI draait.
 * Commando's die per applicatie werken (promote, env, flag) hebben dit nodig.
 */
export declare function vereisAppConfig(): AppConfig;
/** Werkmap van een omgeving: dev is de repo zelf, acc en prod zijn losse clones. */
export declare function werkmapVan(config: AppConfig, omgeving: Omgeving): string;
export declare function pm2NaamVan(config: AppConfig, omgeving: Omgeving): string;
/**
 * Leest de omgevingswaarden zoals de pm2-ecosystem dat doet: eerst `<omgeving>.env`,
 * dan `<omgeving>.secrets.env` eroverheen. Zo draaien migrate en seed met dezelfde
 * `DATABASE_FILE` (en de rest) als de draaiende omgeving, in plaats van terug te
 * vallen op de standaardwaarden uit de config.
 */
export declare function leesOmgevingsWaarden(appDir: string, omgeving: Omgeving): Record<string, string>;
export declare function isOmgeving(waarde: string | undefined): waarde is Omgeving;
export declare function vereisOmgeving(waarde: string | undefined): Omgeving;
export {};
