import { type BacklogItem } from '../board.js';
/** De markering waaraan een bewijs-comment van de accepteer-werker te herkennen is. */
export declare const ACCEPTEER_MARKERING = "<!-- accepteer:bewijs -->";
/** Een item dat geaccepteerd kan worden: het `App`-veld moet gezet zijn. */
export interface Accepteeritem extends BacklogItem {
    readonly app: string;
}
/**
 * De accepteer-wachtrij uit één board-lezing: open items op **Uitrollen** die nog geen
 * bewijs-comment van de accepteer-werker dragen, oudste eerst.
 *
 * Het bewijs-commentfilter maakt de wachtrij idempotent: een al geaccepteerd item valt
 * eruit. De comments worden via REST gelezen (aparte pot), niet via het board; het
 * board zelf wordt precies één keer gelezen (#153).
 */
export declare function accepteerWachtrij(items: readonly BacklogItem[], cwd?: string): Accepteeritem[];
/**
 * Leest de acc-poort van een app uit haar factory.json.
 *
 * Gebruikt de spiegel in de werkplaats, niet de app-map zelf: de orkestrator draait
 * buiten ~/Documents en heeft de spiegels als leesmap.
 */
export declare function accPoortVan(app: string, wortel?: string): number | undefined;
/** Het resultaat van de acc-versiecontrole. */
export interface AccVersieInfo {
    /** De poort waarop acc van deze app draait. */
    readonly poort: number;
    /** De door /health gemelde versie, of undefined als health niet bereikbaar was. */
    readonly draaiend?: string;
    /** De volledige health-body, of undefined als niet bereikbaar. */
    readonly healthBody?: string;
}
/**
 * Vraagt de draaiende versie op van acc via /health.
 *
 * Dit is een read-only aanroep: alleen een GET op /health, geen schrijvende actie.
 */
export declare function accVersie(poort: number): Promise<AccVersieInfo>;
export interface AccepteerOpties {
    readonly dry?: boolean;
    /** Richt de run op dit issue in plaats van op de kop van de rij. */
    readonly issue?: number;
    /** Injecteerbaar voor tests; in productie de echte wortel in $HOME. */
    readonly werkplaatsWortel?: string;
}
/**
 * Draait de accepteer-taaksoort. In deze slice bestaat alleen `--dry`: alles wat er
 * te zien valt vóórdat er iets gebeurt.
 */
export declare function orkestreerAccepteer(opties?: AccepteerOpties): Promise<void>;
