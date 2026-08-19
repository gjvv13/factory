/** De kolommen van het board, in pijplijnvolgorde. Zie WORKFLOW.md. */
export declare const KOLOMMEN: readonly ["Idee", "Functioneel uitwerken", "Klaar voor technische refinement", "Technisch refinen", "Klaar voor Bouwen", "Bouwen", "Uitrollen", "Done"];
export type Kolom = (typeof KOLOMMEN)[number];
/**
 * Of de huidige repo de backlog-repo (`gjvv13/factory`) zelf is.
 *
 * De board-beweging naar Done leest de lokale git-historie; buiten de backlog-repo
 * zou hij backlog-items verplaatsen op grond van een ándere repo's merges. Deze guard
 * houdt `factory afronden` (#185) beperkt tot de factory zelf — een app bereikt Done
 * langs `promote prod`. We kijken naar de `origin`-remote, niet naar een API: dat is
 * goedkoop en werkt ook zonder netwerk.
 */
export declare function isBacklogRepo(cwd?: string): boolean;
/**
 * Het issuenummer waar een branch bij hoort, of undefined als het er geen is.
 * Alleen de slice-vorm telt: `fix/…`, `docs/…` en `chore/factory-…` horen niet bij
 * een backlog-item, en die stil overslaan is het gewenste gedrag — niet een fout.
 */
export declare function issueUitBranch(branch: string): number | undefined;
/**
 * Of het board in deze omgeving te schrijven is.
 *
 * Voor aanroepers die niet één item verplaatsen maar een reeks: die willen kunnen
 * mélden dat er niets gebeurde in plaats van het per item te herhalen (#195).
 */
export declare function bordBereikbaar(): boolean;
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
/**
 * De backlog-issues die tussen twee tags zijn gemerged, uit de merge-commits.
 *
 * GitHub schrijft de branchnaam in het onderwerp van een merge-commit
 * ("Merge pull request #140 from gjvv13/slice/128-1"), dus de koppeling issue↔release
 * ligt al vast in de git-historie en hoeft nergens apart bijgehouden te worden.
 * Branches zonder slice-vorm leveren niets op — dat is bedoeld: van de tien merges in
 * v1.15.1 waren er vijf een fix- of docs-branch.
 */
export declare function issuesUitBereik(vorigeTag: string, tag: string, cwd?: string): number[];
/**
 * Het issuenummer van de ouder-epic, of undefined als dit issue er geen heeft.
 *
 * REST geeft `parent_issue_url` (een API-url die op het nummer eindigt). Dat is
 * goedkoper dan de GraphQL-variant én het telt tegen de andere pot — zie #104.
 */
export declare function ouderVan(issue: number, cwd?: string): number | undefined;
/**
 * Of alle slices van een epic dicht zijn. `sub_issues_summary` telt de gesloten
 * kinderen, dus dit is één aanroep in plaats van de kinderen langslopen.
 * False bij een issue zonder kinderen: dan valt er niets af te ronden.
 */
export declare function alleKinderenDicht(ouder: number, cwd?: string): boolean;
/** Sluit een backlog-issue. Faalt zacht, net als de rest van dit bestand. */
export declare function sluitIssue(issue: number, cwd?: string): void;
/** Eén item op het board, met alles wat een werker nodig heeft om te beginnen. */
export interface BacklogItem {
    readonly issue: number;
    readonly titel: string;
    /** Het `App`-veld; undefined als het niet gezet is (dan weet de werker niet waar hij moet kijken). */
    readonly app?: string;
    readonly kolom: string;
    readonly aangemaakt: string;
}
/** Alle open items in één kolom, oudste eerst. Een filter op `bordItems`. */
export declare function wachtrijVan(kolom: Kolom, cwd?: string): BacklogItem[] | undefined;
/**
 * Alle open items op het board, met hun kolom, oudste eerst — in één query.
 *
 * Eén ophaalpunt voor élke vraag over het board: de wachtrij is er een filter op, en
 * `orkestreer status` heeft drie kolommen tegelijk nodig. Twee keer lezen omdat je
 * twee kolommen wilt is precies de verspilling die #104 wegneemt.
 *
 * Dit is de dure kant van het board, en daarom **één document per pagina** in plaats
 * van `gh project item-list`: gemeten op 2026-08-19 kost deze query 2 punten en die
 * andere 102. Voor een onbemande batch is dat het verschil tussen "past ruim" en "het
 * account ligt een uur plat" — zie #104.
 *
 * De pagina's worden echt doorgelopen. Het board had op 2026-08-19 al meer dan 100
 * items, dus stoppen bij de eerste pagina zou stilletjes items overslaan, en een
 * wachtrij die iets weglaat ziet er precies uit als een lege wachtrij.
 *
 * Levert undefined als het board niet gelezen kon worden — dat is iets anders dan
 * "er staat niets in", en de aanroeper hoort dat verschil te merken.
 */
export declare function bordItems(cwd?: string): BacklogItem[] | undefined;
/** Het label waaraan een geëscaleerd item te herkennen is. */
export declare const ESCALATIE_LABEL = "escalatie";
/**
 * De open backlog-issues met het escalatie-label, of undefined als het niet gelezen
 * kon worden.
 *
 * Dat verschil is niet academisch. Een lege verzameling bij een mislukte aanroep zou
 * betekenen dat de escalatie-rem stil wegvalt: een item dat gisteren een vraag stelde
 * wordt dan opnieuw opgepakt, stelt dezelfde vraag, en kost weer een run. #104 sluit
 * dat expliciet uit.
 *
 * Via REST, niet via het board: labels lezen kan prima met `gh api repos/...`, en dat
 * telt tegen de aparte REST-pot die vrijwel ongebruikt blijft. De GraphQL-punten
 * bewaren we voor Projects v2, dat geen alternatief heeft.
 */
export declare function escalaties(cwd?: string): Set<number> | undefined;
/**
 * Maakt het escalatie-label aan als het nog niet bestaat (idempotent).
 *
 * `gh issue edit --add-label` faalt op een label dat niet bestaat, en `zetLabel` faalt
 * zacht — samen zou dat betekenen dat een escalatie stil niet gemarkeerd wordt en het
 * item elke run opnieuw opgepakt wordt. Zelfde patroon als `zorgVoorWachtrijLabel`.
 */
export declare function zorgVoorEscalatieLabel(cwd?: string): void;
/** Zet een label op een backlog-issue. Faalt zacht, net als de rest van dit bestand. */
export declare function zetLabel(issue: number, label: string, cwd?: string): void;
/** Schrijft de body van een backlog-issue uit een bestand. Faalt zacht. */
export declare function schrijfBody(issue: number, bodyBestand: string, cwd?: string): boolean;
/** Wat een afrondronde over een tagbereik heeft opgeleverd. */
export interface AfrondUitkomst {
    /** Items die daadwerkelijk naar Done zijn verplaatst. */
    readonly verzet: readonly number[];
    /** Items die bleven liggen omdat het board niet te schrijven was. */
    readonly overgeslagen: readonly number[];
}
/**
 * Zet elk backlog-item uit een tagbereik op **Done**, plaatst een comment en sluit het;
 * sluit de ouder-epic mee zodra al zijn slices dicht zijn.
 *
 * Dit is de beweging die `promote prod` (#128) al deed, hier uitgetrokken zodat ook de
 * factory-release (#185) hem kan aanroepen — de factory draait geen `promote`, maar haar
 * tag ís haar productie. `zetKolom` is idempotent (een item dat al op Done staat levert
 * niets op), dus twee runs over hetzelfde bereik zijn veilig. Faalt zacht als de rest van
 * dit bestand: een bordfout houdt een uitrol of release nooit tegen.
 *
 * Ontbreekt het token, dan gaat de reeks in één keer over de kop in plaats van per item:
 * dat scheelt een waarschuwing per issue, en de aanroeper krijgt de nummers terug zodat
 * hij ze kan mélden (#195) — een stille overslag met exit 0 liet de kolom Uitrollen
 * vollopen zonder dat iemand het zag.
 */
export declare function zetItemsUitBereikOpDone(vanaf: string, tag: string, itemMelding: string, ouderMelding: string, cwd?: string): AfrondUitkomst;
/**
 * Alle comments op een issue die van de orkestrator komen, oudste eerst.
 *
 * Bewust álle, niet alleen de laatste: elke orkestrator-comment draagt de markering,
 * ook "run mislukt" en "technisch uitgewerkt". Alleen de laatste pakken zou betekenen
 * dat een escalatie onvindbaar wordt zodra er daarna nog iets gebeurde, terwijl de
 * vraag gewoon een comment hoger staat. De aanroeper kiest de laatste die hij kan lezen.
 *
 * Via REST (aparte pot), want GitHub is de waarheid van de backlog: de vraag én de weg
 * terug staan bij het onderwerp waar ze over gaan.
 */
export declare function orkestratorComments(issue: number, markering: string, cwd?: string): string[];
/** Haalt een label van een backlog-issue. Faalt zacht. */
export declare function haalLabelWeg(issue: number, label: string, cwd?: string): void;
