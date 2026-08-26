/**
 * De wortel van het factory-pakket zelf. Vanuit dist/ is dat één map hoger;
 * hiermee vinden we skeleton/, templates/ en claude-commands/ terug, ook als
 * het pakket in node_modules van een applicatie zit.
 */
export declare const factoryPakketDir: string;
export declare const skeletonDir: string;
export declare const templatesDir: string;
export declare const claudeCommandsDir: string;
export declare const hooksDir: string;
export declare const workflowsDir: string;
export declare const skillsDir: string;
/**
 * Bestanden die `factory sync` als losse 1:1-kopie naar een app zet, naast de
 * directory-spiegels. Bron is relatief aan de factory-pakketwortel, doel is
 * relatief aan de app-map. Een directory-mapping `github/` → `.github/` zou
 * de `overbodig`-detectie breken door overlap met `workflows/` → `.github/workflows/`.
 */
export declare const syncBestanden: {
    readonly bron: string;
    readonly doel: string;
}[];
