import { type BacklogItem } from '../board.js';
import { type OrkestratorPaden } from '../orkestrator-instellingen.js';
import { type InleverenOpties } from './inleveren.js';
/** Een item dat een bouw-werker aankan: het `App`-veld moet gezet zijn. */
export interface Bouwitem extends BacklogItem {
    readonly app: string;
}
/**
 * Waar de bouw-werker zijn worktree neerzet.
 *
 * Niet `factory werkplek`'s pad (`../<repo>-wt/<issue>`, naast de werkkopie), want dat
 * ligt in `~/Documents` en daar komt een onbemande werker niet — TCC houdt hem buiten en
 * er lopen parallelle sessies in. Vandaar dezelfde wortel als de spiegels, met `-wt`
 * erachter zodat een worktree nooit met een spiegel te verwarren is.
 */
export declare function bouwWerkplek(app: string, issue: number, wortel?: string): string;
/** De branch die de werker zou maken; `-1` zoals #128 hem herkent. */
export declare function bouwBranch(issue: number): string;
/**
 * De bouw-wachtrij uit één board-lezing: open items op **Klaar voor Bouwen** die klein
 * genoeg zijn, niet geclaimd, niet geëscaleerd en geen slice onder een epic.
 *
 * Alles komt uit dezelfde lezing — labels en de ouder-relatie zitten sinds #182 in de
 * board-query. Een filter dat per item een tweede aanroep doet zou het GraphQL-budget
 * opeten dat #104 juist bewaakt.
 */
export declare function bouwWachtrij(items: readonly BacklogItem[]): Bouwitem[];
export interface BouwOpties {
    readonly dry?: boolean;
    /** Bouwt één item en stopt. */
    readonly eenmalig?: boolean;
    /** Injecteerbaar voor tests; in productie de echte wortel in `$HOME`. */
    readonly werkplaatsWortel?: string;
    readonly paden?: OrkestratorPaden;
    /**
     * Hoe er ingeleverd wordt. Geen CLI-vlag: `inleveren` draait de volledige poort, en
     * een test hoort prettier, eslint en vitest niet vanuit zichzélf te starten.
     */
    readonly leverIn?: (opties: InleverenOpties) => void;
}
/**
 * Draait de bouw-taaksoort. In deze slice bestaat alleen `--dry`: alles wat er te zien
 * valt vóórdat er iets gebeurt.
 */
export declare function orkestreerBouw(opties?: BouwOpties): void;
/** De prompt voor de bouw-werker: het sjabloon met de feiten die hij niet mag opzoeken. */
export declare function bouwPrompt(item: Bouwitem, werkmap: string, factoryMap: string): string;
/** Of het opgegeven `--soort` bestaat, en welke. Onbekend is een fout, geen stille default. */
export declare function leesSoort(waarde: string | undefined): 'refine' | 'bouw';
