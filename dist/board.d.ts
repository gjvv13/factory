/** De kolommen van het board, in pijplijnvolgorde. Zie WORKFLOW.md. */
export declare const KOLOMMEN: readonly ["Idee", "Functioneel uitwerken", "Klaar voor technische refinement", "Technisch refinen", "Klaar voor Bouwen", "Bouwen", "Uitrollen", "Done"];
export type Kolom = (typeof KOLOMMEN)[number];
/**
 * Het issuenummer waar een branch bij hoort, of undefined als het er geen is.
 * Alleen de slice-vorm telt: `fix/…`, `docs/…` en `chore/factory-…` horen niet bij
 * een backlog-item, en die stil overslaan is het gewenste gedrag — niet een fout.
 */
export declare function issueUitBranch(branch: string): number | undefined;
/**
 * Zet een issue in een kolom. Levert true als er iets veranderd is.
 *
 * Faalt nooit hard: de pijplijn levert software af, en de administratie mag dat niet
 * tegenhouden. Een leeg board, een rate-limit of een ontbrekend item geeft een
 * waarschuwing en gaat door — anders valt een uitrol om op boekhouding.
 */
export declare function zetKolom(issue: number, kolom: Kolom, cwd?: string): boolean;
/**
 * Plaatst één comment op een backlog-issue. Ook dit mag de pijplijn niet ophouden,
 * dus een fout is een waarschuwing.
 */
export declare function plaatsComment(issue: number, tekst: string, cwd?: string): void;
