import { type OpsMeldingConfig, type ReviewReden } from '../code-review.js';
/**
 * Positie in een bouw-reeks (#327): voegt een vermelding toe aan de PR-body die de
 * stacking-relatie zichtbaar maakt, zodat een mens 's ochtends de stapel begrijpt.
 */
export interface ReeksInfo {
    /** Positie in de reeks (1-based, over alle apps heen). */
    readonly positie: number;
    /** Het maximumaantal items in deze reeks. */
    readonly totaal: number;
    /** De branch waarvan dit item vertakt. */
    readonly basisBranch: string;
    /** Het issue waarvan de basis-branch afkomstig is. */
    readonly basisIssue: number;
}
export interface InleverenOpties {
    /** Titel voor de PR; zonder dit vult gh de titel uit de commits (`--fill`). */
    readonly titel?: string;
    /**
     * Levert in zonder auto-merge: de PR wordt geopend en blijft staan tot iemand hem
     * merget (#183). Voor een onbemande bouw-werker: die mag code voorstellen, niet
     * landen. Op een app met de lokale wachtrij betekent het dat het `wachtrij`-label
     * niet gezet wordt, want dat label ís de opdracht om te mergen.
     */
    readonly geenAutomerge?: boolean;
    /**
     * Zet auto-merge aan voor een fastlane-item (#401): de PR merget zichzelf zodra de
     * poort groen is. Bewuste, afgebakende afwijking van akkoord-voor-inleveren — alleen
     * voor losstaande bugs en gelabelde tasks in de fastlane-baan.
     *
     * `fastlane` en `geenAutomerge` sluiten elkaar uit; `geenAutomerge` wint als beide
     * gezet zijn (veiligste default).
     */
    readonly fastlane?: boolean;
    /**
     * Slaat de AI-code-review-gate over, ongeacht de `codeReview`-instelling in
     * `factory.json`. Escape hatch voor situaties waar de review niet gewenst is.
     */
    readonly geenReview?: boolean;
    /**
     * Ops-room-meldingsconfiguratie (#586). Wordt doorgegeven aan de code-review-gate,
     * die bij gate-falen een melding stuurt. Zonder config (attended gebruik) stuurt de
     * gate niets.
     */
    readonly opsMelding?: OpsMeldingConfig;
    /** De repo waarin ingeleverd wordt; de bouw-werker (#183) levert in vanuit een worktree. */
    readonly cwd?: string;
    /** Info over de positie in een bouw-reeks; voegt een reeks-vermelding toe aan de PR-body (#327). */
    readonly reeksInfo?: ReeksInfo;
}
/**
 * Label-gebaseerde auto-merge (#573): een PR merget alleen met dit label op het
 * issue én een schone code-review-gate. Geen label = mens-poort. Het label wordt
 * door een mens gezet (tijdens grooming), niet door een werker.
 */
export declare const AUTO_MERGE_OK_LABEL = "auto-merge-ok";
/**
 * Het resultaat van `inleveren()` (#586). Geeft de code-review-reden terug zodat
 * de orkestrator onderscheid kan maken tussen "niets gevonden" en "kon niet
 * reviewen" en de juiste kanalen kan bedienen (PR-comment, ops-room).
 */
export interface InleverenResultaat {
    /** De reden-discriminant van de code-review-gate, of undefined als de review niet draaide. */
    readonly reviewReden?: ReviewReden;
}
/**
 * Parseert de JSON-uitvoer van `gh pr view --json url,state` tot url + state.
 * Een lege string (geen PR voor deze branch) geeft undefined.
 */
export declare function parsePrView(json: string): {
    url: string;
    state: string;
} | undefined;
/**
 * Levert de huidige slice-branch in: lockfile in lijn brengen, de poort draaien,
 * de branch pushen, een PR naar main openen en die in de merge-queue zetten. De
 * queue integreert branches daarna serieel en conflictvrij naar main, dus de sessie
 * kan meteen aan de volgende slice beginnen.
 */
export declare function inleveren(opties?: InleverenOpties): InleverenResultaat;
