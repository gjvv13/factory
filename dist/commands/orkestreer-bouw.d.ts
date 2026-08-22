import { type BacklogItem } from '../board.js';
import { type RunRegel, type OrkestratorPaden } from '../orkestrator-instellingen.js';
import { type BouwUitkomst, type ReviewUitkomst } from '../werker.js';
import { type InleverenOpties } from './inleveren.js';
/** Een item dat een bouw-werker aankan: het `App`-veld moet gezet zijn. */
export interface Bouwitem extends BacklogItem {
    readonly app: string;
}
/**
 * Waar de bouw-werker zijn worktree neerzet.
 *
 * Niet `factory werkplek`'s pad (`../<repo>-wt/<issue>`, naast de werkkopie), want dat
 * ligt in `~/Documents` en daar komt een onbemande werker niet — TCC houdt hem buiten en
 * er lopen parallelle sessies in. Vandaar dezelfde wortel als de spiegels, met `-wt`
 * erachter zodat een worktree nooit met een spiegel te verwarren is.
 */
export declare function bouwWerkplek(app: string, issue: number, wortel?: string): string;
/** De branch die de werker zou maken; `-1` zoals #128 hem herkent. */
export declare function bouwBranch(issue: number): string;
/**
 * De bouw-wachtrij uit één board-lezing: open items op **Klaar voor Bouwen** die klein
 * genoeg zijn, niet geclaimd en niet geëscaleerd.
 *
 * Een slice onder een epic hoort hier wél in. Tot #232 viel die eruit, met het argument
 * dat een slice in de volgorde van zijn epic gebouwd hoort te worden. Dat spreekt #131
 * tegen: de kolom is de bron van waarheid, en een item staat alleen op Klaar voor Bouwen
 * omdat iemand het daar heeft neergezet. Gemeten op 2026-08-21 hield dat filter #184
 * tegen nadat het juist voor de bouw was vrijgegeven — het overruled de beslissing die
 * het board vastlegt. Een epic zélf valt nog steeds af: `type:epic` staat niet in
 * BOUWBARE_SOORTEN.
 *
 * Alles komt uit dezelfde lezing — labels en de ouder-relatie zitten sinds #182 in de
 * board-query. Een filter dat per item een tweede aanroep doet zou het GraphQL-budget
 * opeten dat #104 juist bewaakt.
 */
export declare function bouwWachtrij(items: readonly BacklogItem[]): Bouwitem[];
/** Waarom een item niet in de bouw-wachtrij staat. */
export interface BuitenDeRij {
    readonly grond: 'kolom' | 'soort' | 'escalatie' | 'geen-app';
    /** Eén zin, bedoeld om achter "#123 staat niet in de bouw-wachtrij: " te zetten. */
    readonly zin: string;
}
/**
 * De uitsluitingsgrond van één item, of `undefined` als het in de rij hoort.
 *
 * Eén functie voor het filter én voor de melding van `--issue`, en niet twee keer
 * dezelfde kennis. De vorige vorm was een reeks kale `continue`-regels: die kon geen
 * reden noemen, en toen het filter in #232 veranderde bleef de documentatie erover
 * achter zonder dat iets rood werd. Wie hier een grond toevoegt, levert de uitleg mee.
 */
export declare function redenBuitenDeRij(item: BacklogItem): BuitenDeRij | undefined;
/**
 * Het item waar deze run over gaat: de kop van de rij, of het gevraagde issue.
 *
 * Een gevraagd issue dat niet in de rij staat is een fout mét de reden. `--issue`
 * filtert de rij die de filters al gemaakt hebben; hij bouwt geen tweede rij, dus hij
 * kan een item dat niet mag ook niet laten bouwen.
 */
export declare function kiesItem(wachtrij: readonly Bouwitem[], alles: readonly BacklogItem[], issue: number | undefined, cwd: string): Bouwitem | undefined;
/**
 * Leest de `bron:<app>`-labels van een item, ontdubbeld (#238).
 *
 * Een label naar de eigen app van het item is een waarschuwing en verder een no-op:
 * die code staat al in de worktree. Levert een lege lijst als er geen bron-labels zijn.
 */
export declare function bronAppsVan(item: Bouwitem): string[];
export interface BouwOpties {
    readonly dry?: boolean;
    /** Bouwt één item en stopt. */
    readonly eenmalig?: boolean;
    /** Bouwt een reeks af: een aantal van de kop, of precies deze items (#265). */
    readonly reeks?: ReeksKeuze;
    /**
     * Richt de run op dit issue in plaats van op de kop van de rij (#210). Staat het niet
     * in de wachtrij, dan faalt de run met de reden — de filters blijven gelden.
     */
    readonly issue?: number;
    /** Injecteerbaar voor tests; in productie de echte wortel in `$HOME`. */
    readonly werkplaatsWortel?: string;
    readonly paden?: OrkestratorPaden;
    /**
     * Hoe er ingeleverd wordt. Geen CLI-vlag: `inleveren` draait de volledige poort, en
     * een test hoort prettier, eslint en vitest niet vanuit zichzélf te starten.
     */
    readonly leverIn?: (opties: InleverenOpties) => void;
}
/**
 * Draait de bouw-taaksoort. In deze slice bestaat alleen `--dry`: alles wat er te zien
 * valt vóórdat er iets gebeurt.
 */
export declare function orkestreerBouw(opties?: BouwOpties): Promise<void>;
/**
 * Het resultaat van `bouwAf`: de bouw-uitkomst plus de optionele review-uitkomst als
 * wrapper, zodat `beschrijfBouw` de kosten van beide fasen kan optellen (#298).
 */
export interface BouwAfResultaat {
    readonly bouw: BouwUitkomst;
    readonly review?: ReviewUitkomst;
}
/**
 * Wat er van een bouw-run in het log komt.
 *
 * Somt de kosten en beurten van bouw + review op tot één totaal, met een uitsplitsing
 * als de review gedraaid heeft (#298). Zonder review is de logregel ongewijzigd.
 */
export declare function beschrijfBouw(resultaat: BouwAfResultaat): RunRegel;
/** De prompt voor de bouw-werker: het sjabloon met de feiten die hij niet mag opzoeken. */
export declare function bouwPrompt(item: Bouwitem, werkmap: string, factoryMap: string, bronMappen?: readonly string[], apps?: readonly string[]): string;
/** De prompt voor de review-werker: het sjabloon met dezelfde feiten als de bouwer. */
export declare function reviewPrompt(item: Bouwitem, werkmap: string, factoryMap: string, apps?: readonly string[]): string;
/** Of het opgegeven `--soort` bestaat, en welke. Onbekend is een fout, geen stille default. */
/** Wat `--reeks` kan zijn: een aantal van de kop, of precies deze items. */
export type ReeksKeuze = {
    readonly soort: 'aantal';
    readonly aantal: number;
} | {
    readonly soort: 'lijst';
    readonly issues: readonly number[];
};
/**
 * Leest `--reeks`: een aantal (`--reeks 4`) of een lijst (`--reeks 126,186,263`).
 *
 * Twee vormen op één vlag, en niet een aparte vlag voor de lijst: de vraag is dezelfde
 * ("werk deze reeks af"), alleen het antwoord op *welke* items verschilt. `--issue`
 * blijft wat het was — één item voor `--eenmalig` of `--dry` — zodat elke vlag één
 * betekenis houdt.
 *
 * Een bovengrens van 20 op het aantal: dit start werkers die geld kosten, en een
 * typefout van één nul is dan duur. Wie meer wil doet het twee keer.
 */
export declare function leesReeks(waarde: string | undefined): ReeksKeuze | undefined;
/**
 * Leest `--issue`: een positief geheel getal, of niets.
 *
 * Bewust een fout vóór de board-lezing. `--issue abc` zou anders een lezing kosten om
 * daarna niets te vinden, en de melding zou over de wachtrij gaan in plaats van over
 * de typefout.
 */
export declare function leesIssue(waarde: string | undefined): number | undefined;
export declare function leesSoort(waarde: string | undefined): 'refine' | 'bouw';
