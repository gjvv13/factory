export interface NieuwOpties {
    /** Koppel de factory via link:../factory in plaats van de git-tag; voor ontwikkelen aan de factory zelf. */
    readonly link?: boolean;
}
export declare function nieuw(naam: string | undefined, opties?: NieuwOpties): void;
