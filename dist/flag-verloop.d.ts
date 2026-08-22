import { z } from 'zod';
export declare const FLAG_META_BESTAND = "flag-meta.json";
declare const flagMetaSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    verlooptOp: z.ZodOptional<z.ZodString>;
    permanent: z.ZodOptional<z.ZodLiteral<true>>;
    beschrijving: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export type FlagMeta = z.infer<typeof flagMetaSchema>;
export interface FlagStatus {
    readonly naam: string;
    readonly soort: 'verlopen' | 'permanent' | 'actief';
    /** ISO-datum, alleen bij soort 'verlopen' of 'actief'. */
    readonly verlooptOp: string | undefined;
    /** Positief = dagen geleden verlopen, 0 = vandaag, negatief = dagen tot verloop. */
    readonly dagen: number | undefined;
}
/**
 * Leest en valideert `flag-meta.json` uit de opgegeven map. Geeft `undefined` als
 * het bestand niet bestaat — dat is een stille no-op, geen fout. Een bestaand maar
 * ongeldig bestand gooit wél: wie het neerzet, moet het goed doen.
 */
export declare function leesFlagMeta(dir: string): FlagMeta | undefined;
/**
 * Beoordeelt elke flag uit de metadata tegen de opgegeven datum. De datum is
 * injecteerbaar zodat tests niet van de kalender afhangen.
 */
export declare function beoordeelFlagVerloop(meta: FlagMeta, vandaag: Date): FlagStatus[];
/** Menselijke beschrijving van de vervalstatus, voor gebruik in verify en flag-lijsten. */
export declare function beschrijfVervalstatus(status: FlagStatus): string;
/**
 * Toetst de feature-flag-vervaldata in de opgegeven map. Draait als stap in
 * `factory verify`, na de dekkings-ratchet en vóór de afhankelijkheden-audit.
 *
 * Zonder `flag-meta.json` is dit een stille no-op. Met verlopen flags:
 * `waarschuw` meldt geel, `blokkeer` gooit een `GebruikersFout`.
 */
export declare function toetsFlagVerloop(dir: string, stand: 'waarschuw' | 'blokkeer', vandaag: Date): void;
export {};
