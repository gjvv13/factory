/** Het label waaraan de factory-wachtrij een in te leveren PR herkent. */
export declare const WACHTRIJ_LABEL = "wachtrij";
/** Maakt het `wachtrij`-label aan als het nog niet bestaat (idempotent, faalt niet als het er al is). */
export declare function zorgVoorWachtrijLabel(repoDir: string): void;
export interface PlistOpzet {
    readonly naam: string;
    /** Absoluut pad naar de globaal geïnstalleerde factory-bin (buiten ~/Documents). */
    readonly bin: string;
    /** `<owner>/<naam>` waar `gh` op wordt gericht. */
    readonly repo: string;
    /** TCC-vrije werkmap (bijv. de home-map). */
    readonly werkmap: string;
    /** TCC-vrij logpad. */
    readonly logPad: string;
}
/**
 * Bouwt de LaunchAgent-plist die `factory integreer --repo <repo>` periodiek draait.
 * Alles wijst buiten `~/Documents` (globale bin, home als werkmap, log in ~/Library/Logs),
 * zodat macOS TCC de launchd-agent niet blokkeert.
 */
export declare function bouwPlist(opzet: PlistOpzet): string;
/**
 * Zet de factory-git-dep (`git+https://…/factory.git#vX.Y.Z`) om in een codeload-
 * tarball-URL + kale versie. We installeren globaal via de tarball en niet via de
 * git-URL: `npm install -g git+https` symlinkt op npm 10 naar een cache-tmp die
 * daarna wordt opgeruimd (dood symlink, geen werkende bin); de tarball kopieert wél.
 */
export declare function tarballVanDep(dep: string): {
    url: string;
    versie: string;
};
/** `a >= b`, per numeriek versie-onderdeel (vX.Y.Z). */
export declare function minstensVersie(a: string, b: string): boolean;
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
