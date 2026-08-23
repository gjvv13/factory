import { type BacklogItem } from '../board.js';
import { type OrkestratorPaden } from '../orkestrator-instellingen.js';
import { type AccepteerUitkomst } from '../werker.js';
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
/**
 * Zoekt de oudste release-tag die de merge van een issue bevat.
 *
 * Strategie: zoek in de git-log van de app-repo naar een merge-commit die
 * `slice/<issue>-` in het onderwerp heeft, en bepaal met
 * `git tag --contains <commit> --sort=v:refname` de oudste tag die hem bevat.
 */
export declare function verwachteTag(issue: number, appCwd: string): string | undefined;
/**
 * Vergelijkt twee versiestrings (met of zonder v-prefix) als semver.
 * Geeft true als `draaiend` ≥ `verwacht`.
 */
export declare function versieDekt(draaiend: string, verwacht: string): boolean;
export interface AccepteerOpties {
    readonly dry?: boolean;
    /** Accepteert één item en stopt. */
    readonly eenmalig?: boolean;
    /** Richt de run op dit issue in plaats van op de kop van de rij. */
    readonly issue?: number;
    /** Injecteerbaar voor tests; in productie de echte wortel in $HOME. */
    readonly werkplaatsWortel?: string;
    readonly paden?: OrkestratorPaden;
}
/**
 * Draait de accepteer-taaksoort.
 *
 * - `--dry`: toont de wachtrij en de acc-preconditie, schrijft niets.
 * - `--eenmalig`: oefent de criteria van één item uit op acc en plaatst bij
 *   alles-waargenomen een bewijs-comment.
 */
export declare function orkestreerAccepteer(opties?: AccepteerOpties): Promise<void>;
/** Het resultaat van `accepteerAf`, voor het log. */
export interface AccepteerAfResultaat {
    readonly accepteer: AccepteerUitkomst;
}
/** De prompt voor de accepteer-werker: het sjabloon met de feiten die hij niet mag opzoeken. */
export declare function accepteerPrompt(item: Accepteeritem, accPoort: number, factoryMap: string): string;
/**
 * Vertaalt de uitkomst van de accepteer-werker naar wat er op GitHub gebeurt.
 *
 * - Alles `waargenomen` → bewijs-comment mét ACCEPTEER_MARKERING; item blijft staan.
 * - Iets `gefaald` of `niet-waarneembaar` → rapport-comment zonder markering.
 * - Escalatie of mislukt → blokkeer met escalatie-label.
 */
export declare function verwerkAcceptatie(item: Accepteeritem, uitkomst: AccepteerUitkomst, cwd: string): void;
