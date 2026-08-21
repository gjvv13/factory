import { z } from 'zod';
/**
 * Wat de orkestrator over zichzelf moet weten als er niemand kijkt (#155): de rem
 * (dagmaximum en budget), de token waarmee een onbemande werker inlogt, en hoeveel
 * runs er vandaag al waren.
 *
 * **Waarom de instellingen hier staan en niet in `factory.json`.** #104 en #155 zetten
 * het `orkestrator`-blok in `factory.json`. Dat kan niet werken, om twee redenen die
 * los van elkaar al genoeg zijn. De factory zelf *heeft* geen `factory.json` — dat
 * bestand beschrijft een uitrolbare applicatie (naam, poorten, envRoot) en de CLI is
 * er geen. En de LaunchAgent draait met `$HOME` als werkmap, buiten elke repo, want
 * macOS TCC houdt een achtergrondproces uit `~/Documents`. Een knop in een repo-lokaal
 * bestand zou de onbemande run dus nooit bereiken: hij zou er staan, hij zou uitzien
 * alsof hij werkt, en hij zou stil niets doen. Dat is precies de storing die #195
 * vanavond opleverde, en die valkuil bouwen we niet nog een keer.
 *
 * Daarom één bestand dat beide paden wél kunnen lezen: `~/.config/factory/orkestrator.env`,
 * met rechten 0600, waar de token toch al hoort te staan.
 */
/** De paden buiten `~/Documents` waar de orkestrator zijn eigen staat bewaart. */
/** De twee werkersoorten. Staat hier omdat het runlog en de dagteller ze beide kennen. */
export type WerkerSoort = 'refine' | 'bouw';
export interface OrkestratorPaden {
    /** Instellingen én token: `~/.config/factory/orkestrator.env`, rechten 0600. */
    readonly envPad: string;
    /** Wat GitHub niet weet: hoeveel runs er vandaag waren (#104). */
    readonly staatPad: string;
    /** Eén regel per run: issue, uitkomst, kosten, beurten. */
    readonly logPad: string;
    /** De LaunchAgent-plist die de nacht aftrapt. */
    readonly agentPad: string;
}
/**
 * De echte paden. `home` is er zodat een test met een tijdelijke map kan werken in
 * plaats van in de home-map te schrijven; in productie staat hij altijd op `os.homedir()`.
 */
export declare function standaardPaden(home?: string): OrkestratorPaden;
/** Het launchd-label van de nachtelijke agent; ook de basis van zijn plist-naam. */
export declare const LAUNCH_LABEL = "nl.factory.orkestreer";
/** De omgevingsvariabele waarmee de `claude`-CLI zich onbemand aanmeldt. */
export declare const TOKEN_SLEUTEL = "CLAUDE_CODE_OAUTH_TOKEN";
export interface Instellingen {
    readonly dagmaximum: number;
    readonly budgetPerRun: number;
    readonly bouwBudgetPerRun: number;
    /** Tijdsgrens per werker-run, in milliseconden (#206). */
    readonly runTimeoutMs: number;
    /** Undefined als er (nog) geen token in het bestand staat. */
    readonly token?: string;
}
/**
 * Leest de instellingen, of levert de standaardwaarden als er nog geen bestand is.
 *
 * Een ongeldige waarde is een luide fout: draaien met een stil gecorrigeerd
 * dagmaximum is erger dan niet draaien, want juist die rem is de reden dat er
 * überhaupt onbemand gewerkt mag worden.
 */
export declare function leesInstellingen(paden: OrkestratorPaden): Instellingen;
/**
 * De token, of een fout die zegt wat te doen.
 *
 * Onbemand draaien zonder token levert een `claude` die om een login vraagt en
 * daarna in stilte niets doet; dan is een duidelijke fout vóór de eerste run het
 * enige nuttige gedrag.
 */
export declare function vereisToken(instellingen: Instellingen, paden: OrkestratorPaden): string;
/**
 * Zet het instellingenbestand klaar met 0600-rechten en een skelet, als het er nog
 * niet is. Raakt een bestaand bestand niet aan — daar staat de token in.
 */
export declare function zorgVoorEnvBestand(paden: OrkestratorPaden): void;
declare const staatSchema: z.ZodObject<{
    dag: z.ZodString;
    gestart: z.ZodNumber;
    interactief: z.ZodDefault<z.ZodNumber>;
    laatsteRun: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Uit welke pot een run geboekt wordt. */
export type RunPot = 'nacht' | 'interactief';
export type OrkestratorStaat = z.infer<typeof staatSchema>;
/**
 * De kalenderdag in lokale tijd, als `YYYY-MM-DD`.
 *
 * Lokaal en niet UTC: het dagmaximum is een afspraak over *nachten* zoals ik ze
 * beleef, en een run om 01:00 hier valt in UTC al op de vorige dag. Met de hand
 * opgebouwd en niet via `toISOString`, want die rekent altijd in UTC.
 */
export declare function kalenderdag(nu: Date): string;
/**
 * Hoeveel runs er vandaag al gestart zijn.
 *
 * Een onleesbaar of kapot bestand telt als "vandaag nog niets": het ergste gevolg is
 * dat er één nacht opnieuw tot het dagmaximum gedraaid wordt (#104), en dat is minder
 * erg dan een orkestrator die na één beschadigde byte nooit meer draait.
 */
export declare function leesStaat(paden: OrkestratorPaden, nu: Date): OrkestratorStaat;
/**
 * Boekt één gestarte run en levert de nieuwe stand.
 *
 * Boeken gebeurt vóór de run en niet erna: valt een run om, dan heeft hij wél geld
 * gekost, en een teller die alleen geslaagde runs telt is geen rem maar een
 * aanmoediging om te blijven proberen.
 */
export declare function boekRun(paden: OrkestratorPaden, nu: Date, pot: RunPot): number;
/**
 * Eén regel in het runlog: wat er met welk issue gebeurde, en wat het kostte.
 *
 * `moment` is het moment van schrijven en niet het begin van de nacht: vier regels met
 * hetzelfde tijdstempel zeggen niets over hoe lang een run duurde, en juist dat wil je
 * 's ochtends kunnen zien.
 */
export declare function logRun(paden: OrkestratorPaden, moment: Date, regel: {
    readonly issue: number;
    readonly app: string;
    /**
     * Refine of bouw. Zonder dit veld is een gemiddelde over het log misleidend: een
     * refine-run heeft $5 budget en een bouw-run $10, en op 2026-08-21 stonden er
     * twaalf refine-runs in het log en nul bouw-runs (#264).
     */
    readonly soort: WerkerSoort;
    readonly uitkomst: string;
    readonly kosten?: number;
    readonly beurten?: number;
}): void;
/** Wat er van een afgeronde run in het log komt; per soort anders opgebouwd. */
export interface RunRegel {
    readonly uitkomst: string;
    readonly kosten?: number;
    readonly beurten?: number;
}
/**
 * Boekt één run en logt hem, ook als hij omvalt.
 *
 * Dit stond in de nacht-lus, en daarom telde een `--eenmalig`-run niet mee in het
 * dagmaximum en liet hij geen spoor na; een bouw-run kwam helemaal niet in het log
 * (#264). De geldrem was daarmee te omzeilen zonder dat iemand iets omzeilde: toen de
 * teller vol zat (9 van 4) werkte de wachtrij zich verder af met losse aanroepen, en
 * die boekten niet.
 *
 * Boeken gebeurt vóór de run, niet erna: een run die omvalt heeft wél geld gekost. En
 * ook zo'n run krijgt zijn logregel, want een teller op 1 met een leeg log is precies
 * de stilte die je 's ochtends niet kunt lezen.
 */
export declare function metBoekhouding<T>(opzet: {
    readonly paden: OrkestratorPaden;
    readonly nu: Date;
    readonly soort: WerkerSoort;
    /** Nacht of interactief; bepaalt welke teller omhoog gaat. */
    readonly pot: RunPot;
    readonly item: {
        readonly issue: number;
        readonly app: string;
    };
}, draai: () => T, beschrijf: (uitkomst: T) => RunRegel): {
    readonly uitkomst: T;
    readonly gestart: number;
};
/**
 * Voegt een regel toe aan het runlog.
 *
 * Het log is niet alleen de stdout van de LaunchAgent: dat zou betekenen dat een run
 * die je met de hand start nergens wordt vastgelegd, en dat je pas na een nacht
 * ontdekt dat er niets staat. De plist wijst er wél óók naar, zodat een crash die de
 * code niet meer haalt in hetzelfde bestand landt.
 */
export declare function schrijfLog(paden: OrkestratorPaden, regel: string): void;
export {};
