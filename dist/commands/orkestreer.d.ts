import { type BacklogItem } from '../board.js';
import { type WerkerUitkomst } from '../werker.js';
export interface OrkestreerOpties {
    /** Toont de wachtrij en wat er zou gebeuren, en schrijft niets. */
    readonly dry?: boolean;
    /** Werkt één item af en stopt. */
    readonly eenmalig?: boolean;
    /**
     * De wortel van de werkplaatsen. Geen CLI-vlag: dit staat er zodat een test met een
     * tijdelijke map kan werken in plaats van in de home-map te schrijven.
     */
    readonly werkplaatsWortel?: string;
}
/** Een item uit de wachtrij dat een werker aankan: het `App`-veld moet gezet zijn. */
interface Opdrachtitem extends BacklogItem {
    readonly app: string;
}
/** De prompt voor de werker: het sjabloon met de feiten die hij niet mag opzoeken. */
export declare function bouwPrompt(item: Opdrachtitem, werkmap: string, factoryMap: string): string;
/** Draait de supervisor. Zie `factory help` voor de vlaggen. */
export declare function orkestreer(opties?: OrkestreerOpties): void;
/** Wat er uit een escalatie-comment terug te lezen valt. */
export interface Escalatie {
    readonly vraag: string;
    readonly advies: string;
    readonly sessie: string;
    readonly werkmap: string;
}
/**
 * Bouwt de escalatie-comment: leesbaar voor jou, terugleesbaar voor `antwoord`.
 *
 * De markeringen zijn HTML-comments, dus onzichtbaar in de gerenderde issue. Zonder
 * die grenzen zou `status` de vraag uit opgemaakte tekst moeten vissen, en dan breekt
 * het zodra iemand de comment bijwerkt of de opmaak verandert.
 */
export declare function escalatieComment(issue: number, vraag: string, advies: string, uitkomst: WerkerUitkomst, werkmap: string): string;
/**
 * De laatste escalatie op een issue, of undefined.
 *
 * Zoekt van achter naar voren naar een comment die écht als escalatie te lezen is.
 * Alleen "de laatste orkestrator-comment" pakken gaat mis zodra er daarna nog iets
 * gebeurde — een mislukte run schrijft ook een comment mét sessie-markering maar
 * zonder vraag, en dan zou de vraag een comment hoger onvindbaar worden.
 */
export declare function laatsteEscalatie(issue: number, cwd: string): Escalatie | undefined;
/** Leest een escalatie terug uit de comment die `escalatieComment` schreef. */
export declare function leesEscalatie(comment: string): Escalatie | undefined;
/**
 * Toont in één blik waar iedereen op wacht: op jou, op een antwoord, of op een werker.
 *
 * Eén board-lezing voor alle drie de blokken; het escalatie-blok haalt zijn vraag en
 * advies uit de comment die de orkestrator zelf schreef.
 */
export declare function orkestreerStatus(cwd: string): void;
export interface AntwoordOpties {
    /** Begin een verse sessie in plaats van de bestaande te hervatten. */
    readonly opnieuw?: boolean;
    readonly werkplaatsWortel?: string;
}
/**
 * Beantwoordt een escalatie: het antwoord gaat terug de bestaande sessie in.
 *
 * Hervatten is niet alleen sneller maar veel goedkoper — gemeten op 2026-08-19 kostte
 * een hervatting $0,02 tegen $0,32 voor een verse run, want de context zit in de
 * cache. Het werk tot de escalatie blijft dus staan; de werker begint niet opnieuw.
 */
export declare function orkestreerAntwoord(issueArgument: string | undefined, tekst: string | undefined, opties?: AntwoordOpties, cwd?: string): void;
export {};
