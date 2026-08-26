interface Stap {
    readonly script: string;
    readonly titel: string;
    readonly snel: boolean;
    readonly preCommit: boolean;
    /** Gezet bij teststappen die coverage kunnen meten; bepaalt de rapportmap. */
    readonly coverageNaam?: string;
}
/**
 * De vaste volgorde van de kwaliteitspoort. Een stap die de repo niet heeft
 * wordt overgeslagen, zodat dezelfde poort werkt in de factory (die geen
 * e2e-tests heeft) en in een applicatie (die ze wel heeft).
 */
export declare const STAPPEN: readonly Stap[];
export declare function beschikbareScripts(repoDir: string): Set<string>;
/**
 * Bepaalt of de gemeten dekking onder de drempel zakt. De "totaal" is bij voorkeur het
 * gemergede cijfer (de echte gecombineerde dekking); ontbreekt dat, dan valt hij terug op
 * de hoogste losse soort — een veilige ondergrens. Zonder drempel, of zonder enige meting,
 * geven we geen oordeel.
 */
export declare function beoordeelDekking(dekkingen: readonly number[], minimum: number | undefined, gecombineerd?: number): {
    totaal: number;
    faalt: boolean;
} | undefined;
export interface AuditTelling {
    /** Aantal kwetsbaarheden op of boven het drempelniveau. */
    readonly aantal: number;
    /** Per niveau het aantal, alleen voor de niveaus die meetellen. */
    readonly perNiveau: Readonly<Record<string, number>>;
}
/**
 * Telt de kwetsbaarheden vanaf een drempelniveau uit de json-uitvoer van
 * `pnpm audit`.
 *
 * Geeft `undefined` als de uitvoer niet te lezen is. Dat betekent "de audit kon
 * niet draaien" — meestal geen netwerk (zie #99) — en dat is iets anders dan
 * "niets gevonden". De poort mag niet groen kleuren op een controle die niet
 * heeft plaatsgevonden, en ook niet omvallen op een netwerkhapering die los
 * staat van de wijziging.
 */
export declare function telKwetsbaarheden(uitvoer: string, vanaf: string): AuditTelling | undefined;
export interface VerifyOpties {
    /** Slaat de e2e-tests over: handig tijdens ontwikkelen. */
    readonly snel?: boolean;
    /** Alleen de snelle stappen, voor de pre-commit hook. */
    readonly preCommit?: boolean;
    /**
     * De map waarin de poort draait. Zonder dit gebruikt verify `process.cwd()`,
     * wat correct is voor interactief gebruik maar fout als de aanroeper (inleveren,
     * release) in een andere map draait dan de worktree — precies het geval bij de
     * bouw-nacht (#379).
     */
    readonly cwd?: string;
}
export declare function verify(opties?: VerifyOpties): void;
export {};
