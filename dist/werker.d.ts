import { z } from 'zod';
/**
 * De onbemande werker: één `claude -p`-aanroep, en de vertaling van zijn uitvoer naar
 * een uitkomst waar de orkestrator op kan sturen (#104).
 *
 * Twee dingen liggen hier vast, en allebei omdat ze in de praktijk misgingen.
 *
 * **De uitkomst komt uit de JSON, nooit uit de exitcode.** Gemeten op 2026-08-19 met
 * `claude` 2.1.233: een run die zijn opdracht niet uitvoerde omdat elk schrijfrecht
 * geweigerd werd, eindigde met `exit 0`, `is_error: false` én `subtype: "success"`.
 * Een run die zijn budget overschreed eindigde juist mét `exit 1`. De exitcode zegt
 * dus in beide richtingen niets; het verdict zegt alles.
 *
 * **De werker schrijft niets.** Hij leest code en het issue, en levert de uitwerking
 * terug als data (`--json-schema`). De orkestrator zet die op GitHub. Daarmee heeft de
 * werker geen enkel schrijfrecht nodig — niet in de werkmap, niet op GitHub — en is
 * "hij kan niets kapotmaken" geen belofte maar een eigenschap van de aanroep.
 */
/**
 * Wat de werker mag. Bewust een toestemmingslijst en niet alleen een verbodslijst:
 * met alléén `Write` en `Edit` verboden schrijft het model gewoon via
 * `Bash(echo … > bestand)` — dat is precies wat de proefrun deed. In een `-p`-sessie
 * kan niets goedgekeurd worden wat hier niet in staat, dus deze lijst ís de grens.
 */
export declare const WERKER_TOEGESTAAN: readonly ["Read", "Grep", "Glob", "Bash(gh issue view:*)", "Bash(gh api:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git diff:*)", "Bash(git status:*)"];
/** Wat de werker sowieso niet mag, ook niet als de lijst hierboven ooit uitdijt. */
export declare const WERKER_VERBODEN: readonly ["Write", "Edit", "NotebookEdit", "Bash(git push:*)", "Bash(git commit:*)", "Bash(gh pr:*)", "Bash(gh issue edit:*)", "Bash(gh issue close:*)", "Bash(gh project:*)"];
/**
 * Het verdict, afgedwongen met `--json-schema` zodat de uitkomst niet uit proza
 * geraden hoeft te worden. `body` is de complete nieuwe issue-body; de orkestrator
 * schrijft hem, de werker niet.
 */
declare const verdictSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    uitkomst: z.ZodLiteral<"klaar">;
    samenvatting: z.ZodString;
    slices: z.ZodNumber;
    body: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    uitkomst: z.ZodLiteral<"escalatie">;
    vraag: z.ZodString;
    advies: z.ZodString;
}, z.core.$strip>], "uitkomst">;
export type Verdict = z.infer<typeof verdictSchema>;
/**
 * Het schema dat aan `claude --json-schema` meegaat — met de hand geschreven, en niet
 * `z.toJSONSchema(verdictSchema)`.
 *
 * Twee keer gemeten tegen de echte API (2026-08-19). `z.toJSONSchema` zet er een
 * `$schema`-sleutel in die de CLI weigert ("no schema with key or ref …"), en een
 * discriminated union wordt een kale `oneOf` zonder top-level `type` — dat geeft
 * HTTP 400 (`input_schema.type: Field required`). Dit schema is daarom plat: het
 * stuurt het model, en `verdictSchema` hierboven is de echte poort.
 */
export declare const VERDICT_JSON_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly uitkomst: {
            readonly type: "string";
            readonly enum: readonly ["klaar", "escalatie"];
            readonly description: "klaar = de uitwerking is af; escalatie = je hebt een vraag";
        };
        readonly samenvatting: {
            readonly type: "string";
            readonly description: "alleen bij klaar: twee of drie zinnen over wat je deed en wat je aannam";
        };
        readonly slices: {
            readonly type: "integer";
            readonly description: "alleen bij klaar: het aantal slices";
        };
        readonly body: {
            readonly type: "string";
            readonly description: "alleen bij klaar: de complete nieuwe issue-body in markdown";
        };
        readonly vraag: {
            readonly type: "string";
            readonly description: "alleen bij escalatie: wat je precies wilt weten";
        };
        readonly advies: {
            readonly type: "string";
            readonly description: "alleen bij escalatie: wat jij zou doen en waarom";
        };
    };
    readonly required: readonly ["uitkomst"];
    readonly additionalProperties: false;
};
export interface WerkerOpdracht {
    readonly prompt: string;
    /** De werkmap: de spiegel van de applicatie, buiten `~/Documents`. */
    readonly werkmap: string;
    /** De sessie-id die de supervisor zelf toekent, zodat hervatten later kan. */
    readonly sessie: string;
    /**
     * Hervat een bestaande sessie in plaats van een nieuwe te beginnen.
     *
     * Gemeten op 2026-08-19: hervatten kostte $0,02 tegen $0,32 voor een verse run —
     * de context zit in de cache. Het werk tot de escalatie blijft dus staan, en het
     * antwoord is bijna gratis. Anders dan #104 aannam is hervatten **niet**
     * map-gebonden: het lukte ook vanuit een andere map. De werkmap blijft wel de
     * juiste plek om het te doen, want de werker leest daar de code.
     */
    readonly hervat?: boolean;
    /** Extra leesbare mappen, bijvoorbeeld de factory-spiegel met de templates. */
    readonly extraMappen?: readonly string[];
    readonly budgetUsd: number;
    readonly model: string;
    /**
     * De omgeving waarin `claude` draait. Onbemand staat hier de OAuth-token in: die
     * hoort niet in de LaunchAgent-plist (wereldleesbaar) maar in een 0600-bestand dat
     * de run zelf leest — zie `orkestrator-instellingen.ts`. Met de hand blijft dit
     * leeg en gebruikt `claude` de gewone keychain-auth.
     */
    readonly env?: NodeJS.ProcessEnv;
}
export type Afloop = 'klaar' | 'escalatie' | 'mislukt';
export interface WerkerUitkomst {
    readonly afloop: Afloop;
    /** Gezet als de sessie niet te hervatten was; dan helpt het antwoord-pad niet meer. */
    readonly sessieWeg?: boolean;
    readonly sessie: string;
    readonly kosten?: number;
    readonly beurten?: number;
    /** Hoe vaak een gereedschap geweigerd werd; 0 bij een schone run. */
    readonly weigeringen: number;
    readonly verdict?: Verdict;
    /** Bij `mislukt`: waarom, in één regel die in een comment past. */
    readonly fout?: string;
}
/** De argumenten voor de `claude`-aanroep. Apart, zodat een test ze kan nalopen. */
export declare function werkerArgumenten(opdracht: WerkerOpdracht): string[];
/**
 * Draait één werker en vertaalt zijn uitvoer naar een uitkomst.
 *
 * Elke uitkomst die `claude` teruggeeft levert een `WerkerUitkomst`, ook een kapotte:
 * de orkestrator moet de reden in een comment kunnen zetten en door naar het volgende
 * item. Eén ding gooit wél — een `claude` die niet te starten is. Dat is geen probleem
 * van dít item maar van de machine, en het escaleren van één issue zou dat verbergen
 * terwijl elke volgende run er net zo goed op stukloopt.
 */
export declare function draaiWerker(opdracht: WerkerOpdracht): WerkerUitkomst;
export {};
