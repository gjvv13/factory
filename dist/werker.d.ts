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
/**
 * Wat een **bouw**-werker mag (#183). Wél schrijven — dat is de opdracht — maar niet
 * pushen en geen PR openen: de supervisor levert in met `factory inleveren
 * --geen-automerge`, zodat het openen van een PR een beslissing van de factory blijft en
 * niet van het model. Committen mag wel; zonder commit is er niets in te leveren.
 */
export declare const BOUWER_TOEGESTAAN: readonly ["Read", "Grep", "Glob", "Write", "Edit", "Bash(ls:*)", "Bash(cat:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(wc:*)", "Bash(grep:*)", "Bash(echo:*)", "Bash(mkdir:*)", "Bash(mktemp:*)", "Bash(git add:*)", "Bash(git commit:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)", "Bash(git restore:*)", "Bash(pnpm:*)", "Bash(npx:*)", "Bash(node:*)", "Bash(gh issue view:*)", "Bash(gh api:*)"];
/**
 * Wat een bouw-werker nooit mag. `git push` en `gh pr` staan hier omdat de PR de grens
 * is tussen voorstellen en landen; `gh project`/`gh issue edit` omdat het board van de
 * supervisor is. En `git checkout`/`switch`/`rebase` niet: hij werkt op één branch in
 * zijn eigen worktree, en van branch wisselen is per definitie buiten de opdracht.
 *
 * **`rm` staat hier bewust niet bij de toegestane werkwoorden** (#217), anders dan de
 * andere tmp-hulpmiddelen. `Write` kan alleen bestanden maken of overschrijven binnen de
 * werkmap; `rm -rf <pad>` kan de spiegel van een ándere applicatie wissen. "Alleen in
 * zijn eigen tmp-map" is niet in een patroon uit te drukken, want dat pad is per sessie
 * anders. Hij mag zijn rommel in tmp laten staan — het besturingssysteem ruimt die op.
 *
 * **`git -C` ook niet**: `Bash(git -C:*)` zou `git -C <pad> push` toestaan en daarmee
 * precies de grens omzeilen die hierboven staat. Git in zijn eigen werkmap kan hij wel.
 */
export declare const BOUWER_VERBODEN: readonly ["Bash(git push:*)", "Bash(git checkout:*)", "Bash(git switch:*)", "Bash(git rebase:*)", "Bash(git reset:*)", "Bash(gh pr:*)", "Bash(gh issue edit:*)", "Bash(gh issue close:*)", "Bash(gh project:*)", "Bash(gh release:*)"];
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
 * Het verdict van een bouw-run (#183). Het verschil met een refinement zit in het
 * bewijs: per acceptatiecriterium een regel met wat het aantoont. `bewijs` is
 * `min(1)`, dus een criterium zonder bewijs komt niet als `klaar` door de poort — dat
 * is precies de reden dat dit schema bestaat en niet alleen de prompt erom vraagt.
 */
declare const bouwVerdictSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    uitkomst: z.ZodLiteral<"klaar">;
    samenvatting: z.ZodString;
    criteria: z.ZodArray<z.ZodObject<{
        criterium: z.ZodString;
        bewijs: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    uitkomst: z.ZodLiteral<"escalatie">;
    vraag: z.ZodString;
    advies: z.ZodString;
}, z.core.$strip>], "uitkomst">;
export type BouwVerdict = z.infer<typeof bouwVerdictSchema>;
/** Als `VERDICT_JSON_SCHEMA`, maar voor een bouw-run: plat, met de hand, om dezelfde redenen. */
export declare const BOUW_JSON_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly uitkomst: {
            readonly type: "string";
            readonly enum: readonly ["klaar", "escalatie"];
            readonly description: "klaar = gebouwd, poort groen, elk criterium bewezen; escalatie = je hebt een vraag";
        };
        readonly samenvatting: {
            readonly type: "string";
            readonly description: "alleen bij klaar: twee of drie zinnen over wat je deed en wat je aannam";
        };
        readonly criteria: {
            readonly type: "array";
            readonly description: "alleen bij klaar: per acceptatiecriterium het criterium en het bewijs (test of commit). Kun je geen bewijs noemen, escaleer dan.";
            readonly items: {
                readonly type: "object";
                readonly properties: {
                    readonly criterium: {
                        readonly type: "string";
                    };
                    readonly bewijs: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["criterium", "bewijs"];
                readonly additionalProperties: false;
            };
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
     * Kap de run af na zoveel milliseconden (#206). Zonder grens hing een werker de hele
     * nacht: het slot blijft staan, de rij komt niet vooruit, en 's ochtends staat er één
     * regel in het log en verder niets.
     */
    readonly timeoutMs?: number;
    /**
     * De omgeving waarin `claude` draait. Onbemand staat hier de OAuth-token in: die
     * hoort niet in de LaunchAgent-plist (wereldleesbaar) maar in een 0600-bestand dat
     * de run zelf leest — zie `orkestrator-instellingen.ts`. Met de hand blijft dit
     * leeg en gebruikt `claude` de gewone keychain-auth.
     */
    readonly env?: NodeJS.ProcessEnv;
    /** Welke gereedschappen mogen; standaard de lees-alleen-lijst van de refine-werker. */
    readonly toegestaan?: readonly string[];
    /** Welke nooit mogen; standaard de verbodslijst van de refine-werker. */
    readonly verboden?: readonly string[];
    /** Het uitvoerschema dat aan `--json-schema` meegaat; standaard dat van een refinement. */
    readonly jsonSchema?: unknown;
}
export type Afloop = 'klaar' | 'escalatie' | 'mislukt';
/**
 * Alles wat een run oplevert behalve zijn verdict. Gedeeld door de refine- en de
 * bouw-werker: de envelop is dezelfde, alleen de uitkomst-vorm verschilt.
 */
export interface WerkerBasis {
    readonly afloop: Afloop;
    /** Gezet als de sessie niet te hervatten was; dan helpt het antwoord-pad niet meer. */
    readonly sessieWeg?: boolean;
    readonly sessie: string;
    readonly kosten?: number;
    readonly beurten?: number;
    /** Hoe vaak een gereedschap geweigerd werd; 0 bij een schone run. */
    readonly weigeringen: number;
    /**
     * Wélke gereedschappen geweigerd werden, zonder dubbelen. Alleen een aantal is niet
     * bruikbaar: negen keer `git push` betekent dat de grens werkt, negen keer iets wat hij
     * nodig had betekent dat de lijst te krap is — en dat verschil zag je niet (gemeten bij
     * de eerste bouw-run, #87 op 2026-08-20).
     */
    readonly geweigerd?: readonly string[];
    /** Bij `mislukt`: waarom, in één regel die in een comment past. */
    readonly fout?: string;
    /**
     * Na hoeveel minuten de run is afgekapt; afwezig als hij dat niet is (#206).
     *
     * Eén veld in plaats van een losse vlag plus een getal: het runlog moet "afgekapt
     * (30 min)" kunnen schrijven in plaats van het algemene "mislukt", en op de tekst van
     * `fout` snuffelen breekt bij de eerste herformulering.
     */
    readonly afgekaptNaMinuten?: number;
}
export interface WerkerUitkomst extends WerkerBasis {
    readonly verdict?: Verdict;
}
/** De argumenten voor de `claude`-aanroep. Apart, zodat een test ze kan nalopen. */
export declare function werkerArgumenten(opdracht: WerkerOpdracht): string[];
/** Wat een bouw-run oplevert: dezelfde envelop-informatie, een ander verdict. */
export interface BouwUitkomst extends WerkerBasis {
    readonly verdict?: BouwVerdict;
}
/**
 * Draait één bouw-werker (#183) en vertaalt zijn uitvoer naar een uitkomst.
 *
 * Zelfde regels als bij een refinement: de uitkomst komt uit de JSON en nooit uit de
 * exitcode, en geen verdict is een mislukking en geen "waarschijnlijk gelukt". Het
 * verschil is het schema — een criterium zonder bewijs komt er niet als `klaar` door.
 */
export declare function draaiBouwer(opdracht: WerkerOpdracht): BouwUitkomst;
export declare function draaiWerker(opdracht: WerkerOpdracht): WerkerUitkomst;
export {};
