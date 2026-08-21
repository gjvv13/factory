/**
 * De spiegel-werkplaats waarin een onbemande werker draait (#104).
 *
 * Niet mijn werkkopie in `~/Documents`, om twee redenen die los van elkaar al
 * voldoende zijn. Ten eerste kán het niet: macOS schermt `~/Documents` met TCC af
 * voor achtergrondprocessen — daarom mijdt `factory integreer` die map ook al. Ten
 * tweede mág het niet: er lopen parallelle sessies in die werkkopieën, en een werker
 * die daar iets omzet draait het werk van iemand anders terug.
 *
 * De werkplaats is wegwerpbaar: vóór elke run wordt hij hard teruggezet op
 * `origin/main`. Wat je daar bewaart, ben je kwijt. Dat is geen tekortkoming maar de
 * hele opzet — een werker mag nooit op een half-afgemaakte staat verderbouwen.
 */
/** De wortel van alle werkplaatsen. Ligt in `$HOME`, en dus buiten `~/Documents`. */
export declare const werkplaatsWortel: string;
/**
 * Waar de spiegel van één applicatie staat.
 *
 * `wortel` is er zodat een test met een tijdelijke map kan werken in plaats van met
 * de echte home-map; in productie staat hij altijd op `werkplaatsWortel`.
 */
export declare function werkplaatsVan(app: string, wortel?: string): string;
/**
 * Of een pad buiten `~/Documents` ligt. De werker moet daar aantoonbaar wegblijven,
 * dus dat is een controle en geen aanname — zie het acceptatiecriterium bij #153.
 */
export declare function buitenDocumenten(pad: string): boolean;
/**
 * Zorgt dat de spiegel van `app` bestaat en gelijk is aan `origin/main`.
 *
 * Ontbreekt hij, dan wordt hij gekloond met `gh` (de app-repo's zijn privé, dus dit
 * leunt op de bestaande `gh`-auth). Bestaat hij, dan `fetch` + `reset --hard`: geen
 * merge en geen rebase, want er valt niets te bewaren en een conflict zou de run
 * blokkeren op iets wat niemand ooit wil oplossen.
 *
 * Levert het pad van de werkplaats op.
 */
export declare function versWerkplaats(app: string, eigenaar: string, wortel?: string): string;
/**
 * Het pad waar bron-momentopnames naast een worktree komen.
 *
 * Naast de worktree, niet erin: een map ín de worktree zou door `verify` gelint en
 * opgemaakt worden (`prettier --check .` scant alles) en kan per ongeluk in een commit
 * belanden. `<worktree>-bron` valt er structureel buiten (#238).
 */
export declare function bronMappenVan(worktree: string): string;
/**
 * Zet een wegwerp-momentopname van een bron-app naast de worktree (#238).
 *
 * De spiegel wordt ververst op `origin/main`, en `git archive` levert de bestanden
 * zonder `.git` — er is niets om vanuit de kopie naar te pushen. Faalt de clone of
 * het archive, dan is dat een harde fout vóór de run: half toegang is erger dan geen
 * toegang.
 *
 * Levert het pad van de momentopname op (`<bronWortel>/<bronApp>`).
 */
export declare function bronMomentopname(bronApp: string, bronWortel: string, eigenaar: string, wortel?: string): string;
/**
 * Ruimt de bron-map op. Bewust een eigen functie en niet een inline `rmSync`: de
 * aanroeper moet dit in een `finally` doen, en de intentie mag niet verdrinken in de
 * boilerplate.
 */
export declare function ruimBronMapOp(bronWortel: string): void;
