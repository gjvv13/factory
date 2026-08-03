export interface NieuwOpties {
    /** Koppel de factory via link:../factory in plaats van de git-tag; voor ontwikkelen aan de factory zelf. */
    readonly link?: boolean;
}
/** Zet een nieuwe applicatie op basis van het skeleton, met een eigen poortblok. */
export declare function nieuw(naam: string | undefined, opties?: NieuwOpties): void;
