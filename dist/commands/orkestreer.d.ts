import { type BacklogItem } from '../board.js';
import { type OrkestratorPaden } from '../orkestrator-instellingen.js';
import { type ReeksKeuze } from './orkestreer-bouw.js';
import { type WerkerBasis } from '../werker.js';
/**
 * Probeert het slot te nemen. Schrijft het eigen pid in het slotbestand.
 *
 * - Bestaat er een slot met een pid dat nog leeft, dan wordt het nooit opgeruimd — ook
 *   niet als het ouder is dan `LOCK_VERVALT_MS`. Een levend pid weegt zwaarder dan de
 *   leeftijd, want precies dat scenario (een lange run) was het probleem.
 * - Bevat het slot geen pid (oudere versie) of is het pid dood, dan geldt de bestaande
 *   leeftijdsgrens: ouder dan `LOCK_VERVALT_MS` = opruimen.
 * - `lockInfo` geeft na een gefaalde poging de pad- en pid-informatie terug voor de
 *   foutmelding.
 */
export declare function neemLock(): boolean;
/** Leest het pid uit het huidige slotbestand, voor de foutmelding. */
export declare function lockInfo(): string;
export declare function geefLockVrij(): void;
export interface OrkestreerOpties {
    /** Toont de wachtrij en wat er zou gebeuren, en schrijft niets. */
    readonly dry?: boolean;
    /** Werkt één item af en stopt. */
    readonly eenmalig?: boolean;
    /** Werkt de wachtrij af tot het dagmaximum of tot hij leeg is — de onbemande modus. */
    readonly nacht?: boolean;
    /**
     * Werkt een reeks af, met dezelfde vangnetten als de nacht (#265): een aantal van de
     * kop van de wachtrij, of precies de opgegeven items. Wat je hier meegeeft is de rem —
     * hierop staat geen dagmaximum, want jij zegt bij het starten hoeveel het mag zijn.
     */
    readonly reeks?: ReeksKeuze;
    /** Zet de LaunchAgent op die `--nacht` één keer per nacht draait. */
    readonly installeer?: boolean;
    /** Haalt die LaunchAgent weg. */
    readonly verwijder?: boolean;
    /**
     * De wortel van de werkplaatsen. Geen CLI-vlag: dit staat er zodat een test met een
     * tijdelijke map kan werken in plaats van in de home-map te schrijven.
     */
    readonly werkplaatsWortel?: string;
    /**
     * Waar de instellingen, de dagteller en het log staan. Ook geen CLI-vlag, en om
     * dezelfde reden: een test hoort niet in de echte home-map te schrijven.
     */
    readonly paden?: OrkestratorPaden;
    /** Het moment waarop deze run valt. Injecteerbaar zodat een dagovergang te testen is. */
    readonly nu?: Date;
    /**
     * Richt de run op dit issue in plaats van op de kop van de rij (#210). Staat het niet
     * in de wachtrij, dan faalt de run met de reden — de filters blijven gelden.
     */
    readonly issue?: number;
}
/** Een item uit de wachtrij dat een werker aankan: het `App`-veld moet gezet zijn. */
interface Opdrachtitem extends BacklogItem {
    readonly app: string;
}
/** De prompt voor de werker: het sjabloon met de feiten die hij niet mag opzoeken. */
export declare function bouwPrompt(item: Opdrachtitem, werkmap: string, factoryMap: string, apps?: readonly string[]): string;
/** Draait de supervisor. Zie `factory help` voor de vlaggen. */
export declare function orkestreer(opties?: OrkestreerOpties): Promise<void>;
/** Het soort werker dat escaleerde — bepaalt welk pad `antwoord` neemt. */
export type EscalatieSoort = 'refine' | 'bouw';
/** Wat er uit een escalatie-comment terug te lezen valt. */
export interface Escalatie {
    readonly vraag: string;
    readonly advies: string;
    readonly sessie: string;
    readonly werkmap: string;
    /** Ontbreekt in oude comments; dat is altijd `'refine'`. */
    readonly soort: EscalatieSoort;
    /** De app waar het item bij hoort — nodig om het bouw-antwoordpad te hervatten. */
    readonly app?: string;
}
/**
 * Bouwt de escalatie-comment: leesbaar voor jou, terugleesbaar voor `antwoord`.
 *
 * De markeringen zijn HTML-comments, dus onzichtbaar in de gerenderde issue. Zonder
 * die grenzen zou `status` de vraag uit opgemaakte tekst moeten vissen, en dan breekt
 * het zodra iemand de comment bijwerkt of de opmaak verandert.
 */
export declare function escalatieComment(issue: number, vraag: string, advies: string, uitkomst: WerkerBasis, werkmap: string, soort?: EscalatieSoort, app?: string): string;
/**
 * De laatste escalatie op een issue, of undefined.
 *
 * Zoekt van achter naar voren naar een comment die écht als escalatie te lezen is.
 * Alleen "de laatste orkestrator-comment" pakken gaat mis zodra er daarna nog iets
 * gebeurde — een mislukte run schrijft ook een comment mét sessie-markering maar
 * zonder vraag, en dan zou de vraag een comment hoger onvindbaar worden.
 */
export declare function laatsteEscalatie(issue: number, cwd: string): Escalatie | undefined;
/**
 * Leest een escalatie terug uit de comment die `escalatieComment` schreef.
 *
 * Optionele velden `soort` en `app` staan vóór `sessie`; ontbreken ze (oude comments),
 * dan is `soort` altijd `'refine'` — voor #306 bestond er geen bouw-escalatie die het
 * antwoordpad kon bereiken.
 */
export declare function leesEscalatie(comment: string): Escalatie | undefined;
/**
 * Toont in één blik waar iedereen op wacht: op jou, op een antwoord, of op een werker.
 *
 * Eén board-lezing voor alle drie de blokken; het escalatie-blok haalt zijn vraag en
 * advies uit de comment die de orkestrator zelf schreef.
 */
export declare function orkestreerStatus(cwd: string, opties?: {
    readonly paden?: OrkestratorPaden;
}): void;
/** Eén check uit de statusCheckRollup; CheckRuns én legacy StatusContexts. */
export interface RollupCheck {
    readonly state?: string;
    readonly status?: string;
    readonly conclusion?: string;
}
/**
 * Vat een statusCheckRollup samen tot 'groen' | 'rood' | 'lopend' | '' (geen checks).
 * Slechtste resultaat wint: één rode check kleurt het geheel rood; groen pas als élke
 * check afgerond én groen is; al het overige is nog lopend. CheckRuns (GitHub Actions)
 * dragen status/conclusion, legacy StatusContexts state — allebei worden gelezen.
 */
export declare function ciSamenvatting(checks: readonly RollupCheck[]): string;
export interface AntwoordOpties {
    /** Begin een verse sessie in plaats van de bestaande te hervatten. */
    readonly opnieuw?: boolean;
    readonly werkplaatsWortel?: string;
    /** Waar de instellingen staan; geen CLI-vlag, zie `OrkestreerOpties.paden`. */
    readonly paden?: OrkestratorPaden;
}
/**
 * Beantwoordt een escalatie: het antwoord gaat terug de bestaande sessie in.
 *
 * Hervatten is niet alleen sneller maar veel goedkoper — gemeten op 2026-08-19 kostte
 * een hervatting $0,02 tegen $0,32 voor een verse run, want de context zit in de
 * cache. Het werk tot de escalatie blijft dus staan; de werker begint niet opnieuw.
 */
export declare function orkestreerAntwoord(issueArgument: string | undefined, tekst: string | undefined, opties?: AntwoordOpties, cwd?: string): Promise<void>;
/** De prompt waarmee de sessie hervat wordt: jouw antwoord, en verder niets nieuws. */
export declare function vervolgPrompt(escalatie: Escalatie, tekst: string): string;
/** Het uur waarop de bouw-nacht draait — 05:30, ná de refine-nacht (#343). */
export declare const BOUW_NACHT_UUR = 5;
export declare const BOUW_NACHT_MINUUT = 30;
export interface OrkestreerPlistOpzet {
    /** Absoluut pad naar de globaal geïnstalleerde factory-bin (buiten ~/Documents). */
    readonly bin: string;
    /** TCC-vrije werkmap; in productie de home-map. */
    readonly werkmap: string;
    /** TCC-vrij logpad, hetzelfde bestand waar de runregels in gaan. */
    readonly logPad: string;
    /**
     * Het launchd-label. Refine en bouw hebben elk hun eigen label, zodat beide agents
     * naast elkaar geïnstalleerd kunnen zijn (#343).
     */
    readonly label: string;
    /** Het uur van `StartCalendarInterval`. */
    readonly uur: number;
    /** De minuut van `StartCalendarInterval`. */
    readonly minuut: number;
    /** Het `exec`-commando waarmee de nacht start. */
    readonly nachtCommando: string;
}
/**
 * Bouwt de plist die `factory orkestreer --nacht` één keer per nacht draait.
 *
 * Vier keuzes die een lezer zou willen aanvechten:
 *
 * **`StartCalendarInterval` en niet `StartInterval`.** De integreer-agent tikt elke
 * minuut een wachtrij af; die kost niets. Deze start werkers die geld kosten, dus hij
 * hoort op een moment te draaien en niet op een frequentie.
 *
 * **Geen `RunAtLoad`.** Anders begint `--installeer` meteen aan een nacht werk, en dan
 * is het installeren van de automatiek zelf de verrassing die de hele opzet wil
 * vermijden. De eerste run is vannacht.
 *
 * **Geen token in de plist.** Een plist in `~/Library/LaunchAgents` is gewoon
 * leesbaar; de token staat in een 0600-bestand dat de run zelf leest.
 *
 * **De install-stap vóór `--nacht`, niet erin (#237).** De plist draait een shellscript
 * dat eerst de nieuwste tag globaal installeert en dan `exec` doet naar `--nacht`. Zo
 * vervangt de run nooit zijn eigen bin terwijl hij draait: `exec` vervangt het proces
 * pas als de installatie al klaar is. Faalt het bijwerken, dan draait de nacht alsnog
 * op de oude bin, met een waarschuwing in het log.
 */
export declare function bouwOrkestreerPlist(opzet: OrkestreerPlistOpzet): string;
/**
 * Het shellscript dat de LaunchAgent draait: eerst bijwerken, dan de nacht starten.
 *
 * Drie dingen zijn bewust zo:
 *
 * - **`git ls-remote` in plaats van `git -C`.** De vorige versie deed een `git -C` naar
 *   de factory-repo onder `~/Documents`, die macOS TCC blokkeert voor
 *   achtergrondprocessen (#332). `ls-remote` heeft geen lokale repo nodig.
 * - **`exec` als laatste regel.** Zo draait `--nacht` als hetzelfde PID en krijgt
 *   launchd de exitcode; zonder `exec` zou de shell na het kind afsluiten en zou een
 *   afgebroken nacht als een schoon exit terugkomen.
 * - **Geen `set -e`.** Het bijwerken mag falen zonder de hele nacht te stoppen; de
 *   if/else handelt dat af, en `exec` draait altijd.
 *
 * Het script vermijdt `&` in de tekst: die is XML-speciaal en zou in de plist als
 * `&amp;` moeten, wat de leesbaarheid van de bron en het log kapotmaakt. Vandaar
 * if/then/else in plaats van `&&`/`||`.
 *
 * `FACTORY_VERWACHTE_VERSIE` wordt gezet zodra de tag opgehaald is, zodat `draaiNacht`
 * een mismatch kan detecteren en loggen wanneer het bijwerken faalde.
 */
export declare function bouwNachtScript(opzet: OrkestreerPlistOpzet): string;
/**
 * De versie van de draaiende factory-bin, uit het eigen `package.json`.
 *
 * Dit is het antwoord op "met welke versie draaide de nacht" (#237): het staat in
 * het runlog, zodat je 's ochtends in één blik ziet of het bijwerken gewerkt heeft.
 * Een onleesbare versie is geen reden om de nacht over te slaan; vandaar 'onbekend'.
 */
export declare function eigenVersie(): string;
/**
 * De nieuwste release-tag van de factory, waaruit de globale bin geïnstalleerd wordt.
 *
 * De tag en niet `package.json` op main: de tag is de bron van waarheid over "wat is
 * de laatste release", en main's versie kan tijdelijk achterlopen terwijl de
 * release-PR nog in de lucht is (dezelfde reden als in `release.yml`, zie #132).
 */
export declare function nieuwsteTag(cwd: string): string;
/**
 * Weigert een agent te plannen op een bin die `--nacht` niet kent.
 *
 * De globale bin komt uit de nieuwste **tag**, en die loopt per definitie achter op de
 * branch waarin `--nacht` net gebouwd is: installeer je voordat deze slice gereleased
 * is, dan staat er een agent klaar die om 04:00 afketst op "Onbekend commando" — in een
 * log dat je pas dagen later leest. Dit is precies het soort stille misstand als het
 * ontbrekende `PROJECT_TOKEN` uit #195, dus hij hoort hier hard te falen.
 */
export declare function vereisNachtModus(bin: string): void;
export {};
