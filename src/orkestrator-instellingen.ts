import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { GebruikersFout, waarschuwing } from './shell.js';

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
export function standaardPaden(home?: string): OrkestratorPaden {
  const wortel = home ?? os.homedir();
  // De echte home is in een test verboden. `test/setup.ts` zet daar een tijdelijke home
  // voor; deze grens is het vangnet als die opzet stuk is. Zonder dat vangnet schreef de
  // suite in het runlog en de dagteller van de gebruiker: 369 regels ruis en een teller
  // op 93 van 4, waarna een nachtrun op diezelfde dag niets meer zou doen (#278).
  if (process.env['VITEST'] !== undefined && wortel === process.env['FACTORY_ECHTE_HOME']) {
    throw new Error(
      `standaardPaden() wees naar de echte home (${wortel}) tijdens een test — zie test/setup.ts (#278).`,
    );
  }
  return {
    envPad: path.join(wortel, '.config', 'factory', 'orkestrator.env'),
    staatPad: path.join(wortel, 'Library', 'Application Support', 'factory', 'orkestrator.json'),
    logPad: path.join(wortel, 'Library', 'Logs', 'nl.factory.orkestreer.log'),
    agentPad: path.join(wortel, 'Library', 'LaunchAgents', `${LAUNCH_LABEL}.plist`),
  };
}

/** Het launchd-label van de nachtelijke agent; ook de basis van zijn plist-naam. */
export const LAUNCH_LABEL = 'nl.factory.orkestreer';

/** De omgevingsvariabele waarmee de `claude`-CLI zich onbemand aanmeldt. */
export const TOKEN_SLEUTEL = 'CLAUDE_CODE_OAUTH_TOKEN';

const instellingenSchema = z.object({
  /** Hoeveel werkers er per kalenderdag mogen starten. Default 4, zie #104. */
  FACTORY_DAGMAXIMUM: z.coerce.number().int().min(1).max(50).default(4),
  /** Harde kostenrem per run, als `--max-budget-usd`. Default 5. */
  FACTORY_BUDGET_USD: z.coerce.number().positive().max(100).default(5),
  /**
   * Kostenrem voor een bouw-run (#182). Ruimer dan een refinement: bouwen is lezen,
   * schrijven, de poort draaien en op rood opnieuw — dat zijn simpelweg meer beurten.
   */
  FACTORY_BOUW_BUDGET_USD: z.coerce.number().positive().max(100).default(10),
  /**
   * Kostenrem voor een review-run (#184). Lager dan een bouw-run: de reviewer leest
   * en beoordeelt, hij schrijft niet.
   */
  FACTORY_REVIEW_BUDGET_USD: z.coerce.number().positive().max(100).default(3),
  /**
   * Tijdsgrens per werker-run in minuten (#206). Default 30.
   *
   * De bovengrens is niet willekeurig: hij moet ónder de slotgeldigheid van de
   * orkestrator (`LOCK_VERVALT_MS`, één uur) blijven. Een run die langer mag leven dan
   * het slot geldig is, kan zijn eigen slot zien verlopen — en dan start er een tweede
   * orkestrator naast de eerste. 55 minuten laat marge voor het opruimen erna.
   */
  FACTORY_RUN_TIMEOUT_MIN: z.coerce.number().int().min(1).max(55).default(30),
  /**
   * De reasoning-effort van elke werker (#290), als `--effort`. Default `medium`: bij
   * een goed-gerefined item is bouwen vaak mechanisch, en `high` betekent veel
   * denk-tokens per beurt. De echte kostenmeting draait deze knop; de instelling maakt
   * hem, reversibel via het env-bestand.
   */
  FACTORY_WERKER_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'),
  [TOKEN_SLEUTEL]: z.string().min(1).optional(),
});

export interface Instellingen {
  readonly dagmaximum: number;
  readonly budgetPerRun: number;
  readonly bouwBudgetPerRun: number;
  /** Kostenrem voor een review-run (#184). */
  readonly reviewBudgetPerRun: number;
  /** Tijdsgrens per werker-run, in milliseconden (#206). */
  readonly runTimeoutMs: number;
  /** Reasoning-effort van elke werker, als `--effort` (#290). */
  readonly werkerEffort: 'low' | 'medium' | 'high';
  /** Undefined als er (nog) geen token in het bestand staat. */
  readonly token?: string;
}

/** Regels in `sleutel=waarde`-vorm, zoals de env-bestanden van de apps. */
function leesEnvBestand(bestand: string): Record<string, string> {
  const waarden: Record<string, string> = {};
  for (const regel of readFileSync(bestand, 'utf8').split('\n')) {
    const getrimd = regel.trim();
    if (getrimd === '' || getrimd.startsWith('#')) {
      continue;
    }
    const scheiding = getrimd.indexOf('=');
    if (scheiding === -1) {
      continue;
    }
    const waarde = getrimd.slice(scheiding + 1).trim();
    // Een leeg rechterlid is "niet ingevuld", niet "ingevuld met niets". Zonder deze
    // regel zou het skelet dat `--installeer` neerzet (`FACTORY_DAGMAXIMUM=`) als
    // ongeldige waarde 0 langs Zod komen in plaats van als afwezig.
    if (waarde === '') {
      continue;
    }
    waarden[getrimd.slice(0, scheiding).trim()] = waarde;
  }
  return waarden;
}

/**
 * Leest de instellingen, of levert de standaardwaarden als er nog geen bestand is.
 *
 * Een ongeldige waarde is een luide fout: draaien met een stil gecorrigeerd
 * dagmaximum is erger dan niet draaien, want juist die rem is de reden dat er
 * überhaupt onbemand gewerkt mag worden.
 */
export function leesInstellingen(paden: OrkestratorPaden): Instellingen {
  if (!existsSync(paden.envPad)) {
    return {
      dagmaximum: 4,
      budgetPerRun: 5,
      bouwBudgetPerRun: 10,
      reviewBudgetPerRun: 3,
      runTimeoutMs: 30 * 60_000,
      werkerEffort: 'medium',
    };
  }
  waarschuwBijSlappeRechten(paden.envPad);
  const gelezen = instellingenSchema.safeParse(leesEnvBestand(paden.envPad));
  if (!gelezen.success) {
    const details = gelezen.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new GebruikersFout(`${paden.envPad} is ongeldig: ${details}`);
  }
  const token = gelezen.data[TOKEN_SLEUTEL];
  return {
    dagmaximum: gelezen.data.FACTORY_DAGMAXIMUM,
    budgetPerRun: gelezen.data.FACTORY_BUDGET_USD,
    bouwBudgetPerRun: gelezen.data.FACTORY_BOUW_BUDGET_USD,
    reviewBudgetPerRun: gelezen.data.FACTORY_REVIEW_BUDGET_USD,
    runTimeoutMs: gelezen.data.FACTORY_RUN_TIMEOUT_MIN * 60_000,
    werkerEffort: gelezen.data.FACTORY_WERKER_EFFORT,
    ...(token === undefined ? {} : { token }),
  };
}

/**
 * Meldt het als het tokenbestand breder leesbaar is dan 0600. Geen fout: de run
 * afkappen om een rechtenbit zou een nacht kosten zonder iets veiliger te maken —
 * de token is dan al gelekt. Maar stil is het ook niet, want dit is het enige
 * geheim op deze machine dat een werker kan gebruiken.
 */
function waarschuwBijSlappeRechten(bestand: string): void {
  const modus = statSync(bestand).mode & 0o777;
  if ((modus & 0o077) !== 0) {
    waarschuwing(
      `${bestand} heeft rechten ${modus.toString(8).padStart(3, '0')}; 600 verwacht. Herstel met: chmod 600 ${bestand}`,
    );
  }
}

/**
 * De token, of een fout die zegt wat te doen.
 *
 * Onbemand draaien zonder token levert een `claude` die om een login vraagt en
 * daarna in stilte niets doet; dan is een duidelijke fout vóór de eerste run het
 * enige nuttige gedrag.
 */
export function vereisToken(instellingen: Instellingen, paden: OrkestratorPaden): string {
  if (instellingen.token !== undefined) {
    return instellingen.token;
  }
  throw new GebruikersFout(
    `Geen ${TOKEN_SLEUTEL} in ${paden.envPad}; onbemand draaien kan niet zonder.\n` +
      '  Maak er een aan en zet hem erin:\n' +
      '    claude setup-token\n' +
      `    printf '${TOKEN_SLEUTEL}=%s\\n' "<het afgedrukte token>" >> ${paden.envPad}\n` +
      `    chmod 600 ${paden.envPad}\n` +
      '  De token staat bewust niet in de plist: die is voor iedereen leesbaar.',
  );
}

/**
 * Zet het instellingenbestand klaar met 0600-rechten en een skelet, als het er nog
 * niet is. Raakt een bestaand bestand niet aan — daar staat de token in.
 */
export function zorgVoorEnvBestand(paden: OrkestratorPaden): void {
  if (existsSync(paden.envPad)) {
    return;
  }
  mkdirSync(path.dirname(paden.envPad), { recursive: true });
  writeFileSync(
    paden.envPad,
    '# Instellingen van de onbemande orkestrator (factory orkestreer --nacht).\n' +
      '# Dit bestand hoort rechten 600 te hebben: er staat een token in.\n' +
      `${TOKEN_SLEUTEL}=\n` +
      'FACTORY_DAGMAXIMUM=4\n' +
      'FACTORY_BUDGET_USD=5\n' +
      'FACTORY_WERKER_EFFORT=medium\n',
    { mode: 0o600 },
  );
}

// --- De dagteller: wat GitHub niet weet --------------------------------------

const staatSchema = z.object({
  dag: z.string().min(1),
  /** Runs die de LaunchAgent vannacht gestart heeft; hierop staat het dagmaximum. */
  gestart: z.number().int().nonnegative(),
  /**
   * Runs die je zelf gestart hebt vandaag. Een eigen teller, zodat een middag
   * experimenteren de nacht niet leegtrekt (#264). Hier staat geen maximum op: het
   * aantal geef je mee bij het starten, en dat is de rem.
   *
   * `.default(0)` zodat een staatbestand van vóór deze splitsing gewoon leesbaar blijft.
   */
  interactief: z.number().int().nonnegative().default(0),
  laatsteRun: z.string().optional(),
});

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
export function kalenderdag(nu: Date): string {
  const maand = String(nu.getMonth() + 1).padStart(2, '0');
  const dag = String(nu.getDate()).padStart(2, '0');
  return `${String(nu.getFullYear())}-${maand}-${dag}`;
}

/**
 * Hoeveel runs er vandaag al gestart zijn.
 *
 * Een onleesbaar of kapot bestand telt als "vandaag nog niets": het ergste gevolg is
 * dat er één nacht opnieuw tot het dagmaximum gedraaid wordt (#104), en dat is minder
 * erg dan een orkestrator die na één beschadigde byte nooit meer draait.
 */
export function leesStaat(paden: OrkestratorPaden, nu: Date): OrkestratorStaat {
  const vandaag = kalenderdag(nu);
  if (!existsSync(paden.staatPad)) {
    return { dag: vandaag, gestart: 0, interactief: 0 };
  }
  let gelezen: unknown;
  try {
    gelezen = JSON.parse(readFileSync(paden.staatPad, 'utf8'));
  } catch {
    waarschuwing(`${paden.staatPad} is niet te lezen; de dagteller begint vandaag opnieuw.`);
    return { dag: vandaag, gestart: 0, interactief: 0 };
  }
  const staat = staatSchema.safeParse(gelezen);
  if (!staat.success) {
    waarschuwing(`${paden.staatPad} wijkt af; de dagteller begint vandaag opnieuw.`);
    return { dag: vandaag, gestart: 0, interactief: 0 };
  }
  // Een andere dag betekent een schone lei — daarom staat de dag in het bestand en
  // niet alleen een teller.
  return staat.data.dag === vandaag ? staat.data : { dag: vandaag, gestart: 0, interactief: 0 };
}

/**
 * Boekt één gestarte run en levert de nieuwe stand.
 *
 * Boeken gebeurt vóór de run en niet erna: valt een run om, dan heeft hij wél geld
 * gekost, en een teller die alleen geslaagde runs telt is geen rem maar een
 * aanmoediging om te blijven proberen.
 */
export function boekRun(paden: OrkestratorPaden, nu: Date, pot: RunPot): number {
  const staat = leesStaat(paden, nu);
  const gestart = pot === 'nacht' ? staat.gestart + 1 : staat.gestart;
  const interactief = pot === 'interactief' ? staat.interactief + 1 : staat.interactief;
  mkdirSync(path.dirname(paden.staatPad), { recursive: true });
  writeFileSync(
    paden.staatPad,
    `${JSON.stringify({ dag: kalenderdag(nu), gestart, interactief, laatsteRun: new Date(nu.getTime()).toISOString() }, null, 2)}\n`,
  );
  return pot === 'nacht' ? gestart : interactief;
}

/**
 * Eén regel in het runlog: wat er met welk issue gebeurde, en wat het kostte.
 *
 * `moment` is het moment van schrijven en niet het begin van de nacht: vier regels met
 * hetzelfde tijdstempel zeggen niets over hoe lang een run duurde, en juist dat wil je
 * 's ochtends kunnen zien.
 */
export function logRun(
  paden: OrkestratorPaden,
  moment: Date,
  regel: {
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
  },
): void {
  const kosten = regel.kosten === undefined ? '?' : `$${regel.kosten.toFixed(2)}`;
  const beurten = regel.beurten === undefined ? '?' : String(regel.beurten);
  schrijfLog(
    paden,
    `${new Date(moment.getTime()).toISOString()} #${String(regel.issue)} ${regel.app} ${regel.soort} ${regel.uitkomst} ${kosten} ${beurten} beurten`,
  );
}

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
export function metBoekhouding<T>(
  opzet: {
    readonly paden: OrkestratorPaden;
    readonly nu: Date;
    readonly soort: WerkerSoort;
    /** Nacht of interactief; bepaalt welke teller omhoog gaat. */
    readonly pot: RunPot;
    readonly item: { readonly issue: number; readonly app: string };
  },
  draai: () => T,
  beschrijf: (uitkomst: T) => RunRegel,
): { readonly uitkomst: T; readonly gestart: number } {
  const { paden, nu, soort, item } = opzet;
  const gestart = boekRun(paden, nu, opzet.pot);
  let uitkomst: T;
  try {
    uitkomst = draai();
  } catch (fout) {
    logRun(paden, new Date(Date.now()), {
      issue: item.issue,
      app: item.app,
      soort,
      uitkomst: `afgebroken (${fout instanceof Error ? (fout.message.split('\n')[0] ?? '') : String(fout)})`,
    });
    throw fout;
  }
  logRun(paden, new Date(Date.now()), {
    issue: item.issue,
    app: item.app,
    soort,
    ...beschrijf(uitkomst),
  });
  return { uitkomst, gestart };
}

/**
 * Voegt een regel toe aan het runlog.
 *
 * Het log is niet alleen de stdout van de LaunchAgent: dat zou betekenen dat een run
 * die je met de hand start nergens wordt vastgelegd, en dat je pas na een nacht
 * ontdekt dat er niets staat. De plist wijst er wél óók naar, zodat een crash die de
 * code niet meer haalt in hetzelfde bestand landt.
 */
export function schrijfLog(paden: OrkestratorPaden, regel: string): void {
  try {
    mkdirSync(path.dirname(paden.logPad), { recursive: true });
    appendFileSync(paden.logPad, `${regel}\n`);
  } catch (fout) {
    // Een onschrijfbaar log mag een nacht werk niet tegenhouden, maar stil is het niet.
    waarschuwing(
      `kon niet naar ${paden.logPad} schrijven: ${fout instanceof Error ? fout.message : String(fout)}`,
    );
  }
}
