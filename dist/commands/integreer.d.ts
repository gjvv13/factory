import { type AppConfig } from '../app-config.js';
/** Het label waaraan de factory-wachtrij een in te leveren PR herkent. */
export declare const WACHTRIJ_LABEL = "wachtrij";
/** Maakt het `wachtrij`-label aan als het nog niet bestaat (idempotent, faalt niet als het er al is). */
export declare function zorgVoorWachtrijLabel(repoDir: string): void;
/** Bouwt de LaunchAgent-plist die `factory integreer` periodiek in de app-map draait. */
export declare function bouwPlist(config: AppConfig): string;
export interface IntegreerOpties {
    /** Installeert de LaunchAgent die `integreer` periodiek draait. */
    readonly installeer?: boolean;
    /** Verwijdert die LaunchAgent. */
    readonly verwijder?: boolean;
    /**
     * Richt `gh` op deze `<owner>/<naam>` i.p.v. de git-remote van de huidige map. Zo
     * draait de drain zonder de repo-map te lezen — nodig om de LaunchAgent buiten
     * `~/Documents` (macOS TCC) te kunnen draaien.
     */
    readonly repo?: string;
}
/**
 * Werkt de factory-wachtrij af: neemt de oudste open `wachtrij`-PR, toetst hem via de
 * CI-poort en merget of koppelt terug — serieel, één tegelijk (mini-lock). Draait op
 * de mini; raakt de werkmap niet aan, alleen GitHub via `gh`. Met `--installeer` /
 * `--verwijder` zet je de LaunchAgent op of weg die dit periodiek doet.
 */
export declare function integreer(opties?: IntegreerOpties): void;
