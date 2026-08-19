import { type BacklogItem } from '../board.js';
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
export {};
