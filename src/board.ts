import { ok, run, uitvoerVan, waarschuwing } from './shell.js';

/**
 * De backlog staat als GitHub Issues in één repo, met het board als bron van waarheid
 * voor de fase (#131). Dit is de enige plek die dat board aanraakt.
 *
 * Alles loopt via `gh api graphql` en niet via `gh project item-list`/`field-list`.
 * Dat is geen stijlkeuze maar een kostenkeuze: GitHub geeft 5000 GraphQL-punten per
 * uur, gedeeld over álles wat er op het account draait. Gemeten op 2026-08-19:
 * een `item-list` van 83 items kost 102 punten en een `field-list` ook, terwijl de
 * gerichte opzoeking hieronder — item-id, veld-id, optie-ids én de huidige kolom in
 * één document — er 1 kost. Een uitrol mag de rest van de dag niet opeten.
 */

/** Als `uitvoerVan`, maar met een eigen omgeving — nodig voor de PAT in een workflow. */
/**
 * De eerste betekenisvolle regel van wat `gh` zei toen het misging, ingekort.
 *
 * Kort houden is het punt: één regel die in een waarschuwing past. Zonder dit stond er
 * alleen "kon het niet" en kostte elke oorzaak — te smalle scope, rate-limit, netwerkblip —
 * een hele release om te achterhalen (#195, v1.15.15 en v1.15.16).
 */
function ghReden(stderr: string): string {
  const regel = stderr
    .split('\n')
    .map((r) => r.trim())
    .find((r) => r !== '');
  if (regel === undefined) {
    return 'geen foutmelding van gh';
  }
  return regel.length > 200 ? `${regel.slice(0, 197)}...` : regel;
}

function uitvoerMetEnv(
  commando: string,
  argumenten: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): string | undefined {
  const uitkomst = run(commando, argumenten, {
    ...(cwd === undefined ? {} : { cwd }),
    ...(env === undefined ? {} : { env }),
    capture: true,
    toleranter: true,
  });
  if (uitkomst.code === 0) {
    return uitkomst.stdout.trim();
  }
  // Elke aanroeper hierboven leest een niet-nul code als "kon niet lezen" en geeft
  // undefined door; zonder deze regel verdwijnt de enige plek waar de échte oorzaak staat.
  waarschuwing(
    `gh ${argumenten.slice(0, 2).join(' ')} faalde (code ${String(uitkomst.code)}): ` +
      ghReden(uitkomst.stderr),
  );
  return undefined;
}

const EIGENAAR = 'gjvv13';
const BACKLOG_REPO = 'factory';
const PROJECT_NUMMER = 2;

/** De kolommen van het board, in pijplijnvolgorde. Zie WORKFLOW.md. */
export const KOLOMMEN = [
  'Idee',
  'Functioneel uitwerken',
  'Klaar voor technische refinement',
  'Technisch refinen',
  'Klaar voor Bouwen',
  'Bouwen',
  'Wacht op merge',
  'Uitrollen',
  'Done',
] as const;

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
export function isBacklogRepo(cwd?: string): boolean {
  const url = uitvoerVan('git', ['remote', 'get-url', 'origin'], cwd);
  if (url === undefined) {
    return false;
  }
  return new RegExp(`[:/]${EIGENAAR}/${BACKLOG_REPO}(\\.git)?/?$`).test(url.trim());
}

/**
 * Het issuenummer waar een branch bij hoort, of undefined als het er geen is.
 * Alleen de slice-vorm telt: `fix/…`, `docs/…` en `chore/factory-…` horen niet bij
 * een backlog-item, en die stil overslaan is het gewenste gedrag — niet een fout.
 */
export function issueUitBranch(branch: string): number | undefined {
  const match = /^slice\/(\d+)-\d+$/.exec(branch);
  if (match?.[1] === undefined) {
    return undefined;
  }
  const nummer = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(nummer) && nummer > 0 ? nummer : undefined;
}

/**
 * De omgeving waarin `gh` het board mag aanraken, of undefined als dat niet kan.
 *
 * Lokaal is dat de gewone `gh`-auth van de gebruiker. In een workflow niet: het
 * ingebouwde `GITHUB_TOKEN` is repo-gebonden en komt niet bij een board dat onder een
 * persoonlijk account hangt — en de backlog staat bovendien in een ánder repo dan de
 * app die uitrolt. Daarvoor is een PAT nodig (`PROJECT_TOKEN`, scope `project` plus
 * lees/schrijf op de backlog-repo).
 */
function ghOmgeving(): { readonly kan: boolean; readonly env?: NodeJS.ProcessEnv } {
  const pat = process.env['PROJECT_TOKEN'];
  if (pat !== undefined && pat !== '') {
    // gh leest GH_TOKEN; de PAT overschrijft het workflow-token voor deze aanroep.
    return { kan: true, env: { ...process.env, GH_TOKEN: pat } };
  }
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    return { kan: false };
  }
  return { kan: true };
}

/**
 * Of het board in deze omgeving te schrijven is.
 *
 * Voor aanroepers die niet één item verplaatsen maar een reeks: die willen kunnen
 * mélden dat er niets gebeurde in plaats van het per item te herhalen (#195).
 */
export function bordBereikbaar(): boolean {
  return ghOmgeving().kan;
}

export interface Doelwit {
  readonly itemId: string;
  readonly projectId: string;
  readonly veldId: string;
  readonly optieId: string;
  /** De kolom waar het item nu staat; undefined als er nog geen waarde staat. */
  readonly huidig?: string;
}

const OPZOEK_QUERY = `query($eigenaar:String!,$repo:String!,$project:Int!,$nummer:Int!){
  user(login:$eigenaar){ projectV2(number:$project){ id
    field(name:"Status"){ ... on ProjectV2SingleSelectField { id options { id name } } } } }
  repository(owner:$eigenaar,name:$repo){ issue(number:$nummer){
    projectItems(first:10){ nodes { id project { number }
      fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } }
}`;

interface OpzoekAntwoord {
  readonly data?: {
    readonly user?: {
      readonly projectV2?: {
        readonly id?: string;
        readonly field?: {
          readonly id?: string;
          readonly options?: { id: string; name: string }[];
        };
      };
    };
    readonly repository?: {
      readonly issue?: {
        readonly projectItems?: {
          readonly nodes?: {
            id?: string;
            project?: { number?: number };
            fieldValueByName?: { name?: string } | null;
          }[];
        };
      };
    };
  };
}

/**
 * Parset het ruwe JSON-antwoord van de opzoek-query tot een Doelwit, of undefined
 * als de structuur afwijkt van wat de query oplevert. Geëxporteerd zodat de
 * contract-tests de GraphQL-interpretatie kunnen vastpinnen tegen een opgenomen
 * respons, los van de gh-aanroep.
 */
export function parseOpzoekAntwoord(ruw: string, kolom: Kolom): Doelwit | undefined {
  let antwoord: OpzoekAntwoord;
  try {
    antwoord = JSON.parse(ruw) as OpzoekAntwoord;
  } catch {
    return undefined;
  }
  const project = antwoord.data?.user?.projectV2;
  const projectId = project?.id;
  const veldId = project?.field?.id;
  const optieId = project?.field?.options?.find((optie) => optie.name === kolom)?.id;
  const knoop = antwoord.data?.repository?.issue?.projectItems?.nodes?.find(
    (node) => node.project?.number === PROJECT_NUMMER,
  );
  const itemId = knoop?.id;
  if (
    projectId === undefined ||
    veldId === undefined ||
    optieId === undefined ||
    itemId === undefined
  ) {
    return undefined;
  }
  const huidig = knoop?.fieldValueByName?.name;
  return { itemId, projectId, veldId, optieId, ...(huidig === undefined ? {} : { huidig }) };
}

/** Zoekt in één aanroep alles op wat nodig is om de kolom te kunnen zetten. */
function zoekDoelwit(
  issue: number,
  kolom: Kolom,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): Doelwit | undefined {
  const ruw = uitvoerMetEnv(
    'gh',
    [
      'api',
      'graphql',
      '-f',
      `query=${OPZOEK_QUERY}`,
      '-f',
      `eigenaar=${EIGENAAR}`,
      '-f',
      `repo=${BACKLOG_REPO}`,
      '-F',
      `project=${String(PROJECT_NUMMER)}`,
      '-F',
      `nummer=${String(issue)}`,
    ],
    cwd,
    env,
  );
  if (ruw === undefined || ruw === '') {
    return undefined;
  }
  return parseOpzoekAntwoord(ruw, kolom);
}

/**
 * Zet een issue in een kolom. Levert true als er iets veranderd is.
 *
 * Faalt nooit hard: de pijplijn levert software af, en de administratie mag dat niet
 * tegenhouden. Een leeg board, een rate-limit of een ontbrekend item geeft een
 * waarschuwing en gaat door — anders valt een uitrol om op boekhouding.
 */
/**
 * Op welke kolom een issue nu staat, of `undefined` als dat niet te bepalen is.
 *
 * Dit is de gerichte opzoeking (1 à 2 punten), niet de volledige board-lezing. Hij
 * bestaat voor de foutmelding van `--issue` (#210): `bordItems` laat items zonder
 * Status-waarde en gesloten items weg, dus "hij zit niet in de lezing" is daar geen
 * verklaring. Alleen op het foutpad aanroepen — de gewone doorloop leest het board
 * één keer en heeft dit niet nodig.
 */
export function kolomVan(issue: number, cwd?: string): string | undefined {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return undefined;
  }
  // De kolom komt mee bij het opzoeken van élk doelwit; welke kolom we meegeven doet
  // voor het antwoord niet uit, dus nemen we de eerste van de pijplijn.
  return zoekDoelwit(issue, 'Idee', cwd, omgeving.env)?.huidig;
}

/**
 * Wat een poging tot verplaatsen opleverde.
 *
 * `al-goed` en `mislukt` zijn allebei "niet verzet", maar ze vragen het tegenovergestelde:
 * het eerste is de idempotente rust van een tweede run, het tweede is een gat waar iemand
 * naar moet kijken (#195). Ze in één `false` samenvatten was precies waarom een release
 * stil groen kon blijven terwijl de kolom achterliep.
 */
export type KolomUitkomst = 'verzet' | 'al-goed' | 'mislukt';

/** Zet de kolom en vertel welke van de drie uitkomsten het was. */
export function zetKolomUitkomst(issue: number, kolom: Kolom, cwd?: string): KolomUitkomst {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    waarschuwing(
      `geen PROJECT_TOKEN in deze workflow — #${String(issue)} niet naar '${kolom}' gezet.`,
    );
    return 'mislukt';
  }
  const doelwit = zoekDoelwit(issue, kolom, cwd, omgeving.env);
  if (doelwit === undefined) {
    waarschuwing(
      `kon #${String(issue)} niet op het board vinden — kolom niet gezet. ` +
        `Staat het item wél op het board, dan mag PROJECT_TOKEN het niet lezen: ` +
        `dat vraagt een classic PAT met de scope 'project'.`,
    );
    return 'mislukt';
  }
  if (doelwit.huidig === kolom) {
    return 'al-goed';
  }
  const uitkomst = run(
    'gh',
    [
      'project',
      'item-edit',
      '--id',
      doelwit.itemId,
      '--project-id',
      doelwit.projectId,
      '--field-id',
      doelwit.veldId,
      '--single-select-option-id',
      doelwit.optieId,
    ],
    {
      ...(cwd === undefined ? {} : { cwd }),
      ...(omgeving.env === undefined ? {} : { env: omgeving.env }),
      capture: true,
      toleranter: true,
    },
  );
  if (uitkomst.code !== 0) {
    waarschuwing(
      `kon #${String(issue)} niet naar '${kolom}' verplaatsen op het board: ` +
        ghReden(uitkomst.stderr),
    );
    return 'mislukt';
  }
  return 'verzet';
}

/**
 * Zet de kolom; `true` als het item daadwerkelijk verplaatst is.
 *
 * De bestaande aanroepers willen precies deze vraag beantwoord ("heb ik iets veranderd?"),
 * dus die houden hun boolean. Wie het verschil tussen "stond al goed" en "mislukt" nodig
 * heeft, gebruikt `zetKolomUitkomst`.
 */
export function zetKolom(issue: number, kolom: Kolom, cwd?: string): boolean {
  return zetKolomUitkomst(issue, kolom, cwd) === 'verzet';
}

/**
 * Plaatst één comment op een backlog-issue. Ook dit mag de pijplijn niet ophouden,
 * dus een fout is een waarschuwing.
 */
export function plaatsComment(issue: number, tekst: string, cwd?: string): void {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return;
  }
  const uitkomst = run(
    'gh',
    ['issue', 'comment', String(issue), '--repo', `${EIGENAAR}/${BACKLOG_REPO}`, '--body', tekst],
    {
      ...(cwd === undefined ? {} : { cwd }),
      ...(omgeving.env === undefined ? {} : { env: omgeving.env }),
      capture: true,
      toleranter: true,
    },
  );
  if (uitkomst.code !== 0) {
    waarschuwing(`kon geen comment op #${String(issue)} plaatsen.`);
  }
}

/**
 * De backlog-issues die tussen twee tags zijn gemerged, uit de merge-commits en
 * trailers.
 *
 * GitHub schrijft de branchnaam in het onderwerp van een merge-commit
 * ("Merge pull request #140 from gjvv13/slice/128-1"), dus de koppeling issue↔release
 * ligt al vast in de git-historie en hoeft nergens apart bijgehouden te worden.
 * Branches zonder slice-vorm leveren niets op — dat is bedoeld: van de tien merges in
 * v1.15.1 waren er vijf een fix- of docs-branch.
 *
 * Sinds #222 leest `parseIssuesUitLog` ook `Refs/Closes/Fixes #N`-trailers aan het
 * begin van een regel. Zo komen items die via een trailer in een commit staan (maar
 * niet in de branchnaam) ook mee naar Done bij een release.
 */
/**
 * Parset ruwe `git log --format=%B`-uitvoer naar ontdubbelde, gesorteerde
 * issuenummers. Herkent twee bronnen:
 *
 * 1. Merge-onderwerpregels: `Merge pull request #N from …/slice/<issue>-<n>`
 * 2. Trailers aan het begin van een regel: `Refs/Closes/Fixes[:]  #<issue>`
 *    (case-insensitief, met en zonder dubbele punt).
 *
 * Een `#N` midden in een zin (geen regelbegin) wordt bewust genegeerd — alleen
 * expliciete trailers tellen, zodat toevallige vermeldingen geen board-actie
 * triggeren (#222).
 *
 * Geëxporteerd zodat de contract-tests de git-log-interpretatie kunnen
 * vastpinnen tegen een opgenomen uitvoer, los van het git-commando.
 */
export function parseIssuesUitLog(log: string): number[] {
  const MERGE_RE = /^Merge pull request #\d+ from [^/]+\/slice\/(\d+)-\d+$/;
  const TRAILER_RE = /^(?:Refs|Closes|Fixes):?\s+#(\d+)/i;

  const gevonden = new Set<number>();
  for (const regel of log.split('\n')) {
    const getrimd = regel.trim();
    const match = MERGE_RE.exec(getrimd) ?? TRAILER_RE.exec(getrimd);
    if (match?.[1] === undefined) {
      continue;
    }
    const nummer = Number.parseInt(match[1], 10);
    if (Number.isSafeInteger(nummer) && nummer > 0) {
      gevonden.add(nummer);
    }
  }
  return [...gevonden].sort((a, b) => a - b);
}

export function issuesUitBereik(vorigeTag: string, tag: string, cwd?: string): number[] {
  const log = uitvoerVan('git', ['log', '--format=%B', `${vorigeTag}..${tag}`], cwd);
  if (log === undefined || log === '') {
    return [];
  }
  return parseIssuesUitLog(log);
}

/** Leest één veld van een backlog-issue via REST; undefined als het er niet is. */
function issueVeld(issue: number, jq: string, cwd?: string): string | undefined {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return undefined;
  }
  const ruw = uitvoerMetEnv(
    'gh',
    ['api', `repos/${EIGENAAR}/${BACKLOG_REPO}/issues/${String(issue)}`, '--jq', jq],
    cwd,
    omgeving.env,
  );
  return ruw === undefined || ruw === '' || ruw === 'null' ? undefined : ruw;
}

/** De jq-expressie waarmee `ouderVan` het oudernummer uit een issue leest. */
export const JQ_OUDER = '.parent_issue_url';

/**
 * Parset de ruwe jq-uitvoer van `JQ_OUDER` tot een issuenummer. Geëxporteerd
 * zodat de contract-tests de interpretatie kunnen vastpinnen.
 */
export function parseOuderAntwoord(ruw: string): number | undefined {
  const match = /\/(\d+)$/.exec(ruw.trim());
  if (match?.[1] === undefined) {
    return undefined;
  }
  const nummer = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(nummer) && nummer > 0 ? nummer : undefined;
}

/**
 * Het issuenummer van de ouder-epic, of undefined als dit issue er geen heeft.
 *
 * REST geeft `parent_issue_url` (een API-url die op het nummer eindigt). Dat is
 * goedkoper dan de GraphQL-variant én het telt tegen de andere pot — zie #104.
 */
export function ouderVan(issue: number, cwd?: string): number | undefined {
  const url = issueVeld(issue, JQ_OUDER, cwd);
  if (url === undefined) {
    return undefined;
  }
  return parseOuderAntwoord(url);
}

/**
 * De jq-expressie waarmee `alleKinderenDicht` de voortgang van een epic leest.
 * De interpolatie (`\(…)`) moet escapen naar `\\(…)` in de TypeScript-string zodat
 * jq de werkelijke veldwaarde invult, niet de letterlijke tekst.
 */
export const JQ_KINDEREN = '.sub_issues_summary | "\\(.completed)/\\(.total)"';

/**
 * Parset de ruwe jq-uitvoer van `JQ_KINDEREN` tot een boolean. Geëxporteerd
 * zodat de contract-tests de interpretatie kunnen vastpinnen.
 */
export function parseKinderenAntwoord(ruw: string): boolean {
  const [gedaan, totaal] = ruw.trim().split('/').map(Number);
  return totaal !== undefined && totaal > 0 && gedaan === totaal;
}

/**
 * Parset de ruwe jq-uitvoer van `JQ_KINDEREN` tot het aantal open kinderen.
 * 0 als er geen kinderen zijn of alle kinderen dicht zijn — in beide gevallen
 * mag het issue gesloten worden. Geëxporteerd zodat de contract-tests de
 * interpretatie kunnen vastpinnen.
 */
export function parseOpenKinderen(ruw: string): number {
  const [gedaan, totaal] = ruw.trim().split('/').map(Number);
  if (totaal === undefined || gedaan === undefined || totaal <= 0) {
    return 0;
  }
  return Math.max(0, totaal - gedaan);
}

/**
 * Of alle slices van een epic dicht zijn. `sub_issues_summary` telt de gesloten
 * kinderen, dus dit is één aanroep in plaats van de kinderen langslopen.
 * False bij een issue zonder kinderen: dan valt er niets af te ronden.
 */
export function alleKinderenDicht(ouder: number, cwd?: string): boolean {
  const ruw = issueVeld(ouder, JQ_KINDEREN, cwd);
  if (ruw === undefined) {
    return false;
  }
  return parseKinderenAntwoord(ruw);
}

/**
 * Het aantal open kinderen van een issue, of 0 als er geen (sub-)issues zijn.
 * Gebruikt dezelfde jq-expressie als `alleKinderenDicht`, maar onderscheidt
 * "geen kinderen" (0 → mag dicht) van "open kinderen" (>0 → nog niet sluiten).
 */
export function openKinderenAantal(issue: number, cwd?: string): number {
  const ruw = issueVeld(issue, JQ_KINDEREN, cwd);
  if (ruw === undefined) {
    return 0;
  }
  return parseOpenKinderen(ruw);
}

/** Sluit een backlog-issue. Faalt zacht, net als de rest van dit bestand. */
export function sluitIssue(issue: number, cwd?: string): void {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return;
  }
  const uitkomst = run(
    'gh',
    ['issue', 'close', String(issue), '--repo', `${EIGENAAR}/${BACKLOG_REPO}`],
    {
      ...(cwd === undefined ? {} : { cwd }),
      ...(omgeving.env === undefined ? {} : { env: omgeving.env }),
      capture: true,
      toleranter: true,
    },
  );
  if (uitkomst.code !== 0) {
    waarschuwing(`kon #${String(issue)} niet sluiten.`);
  }
}

// --- De wachtrij: welke items staan in een kolom -----------------------------

/** Eén item op het board, met alles wat een werker nodig heeft om te beginnen. */
export interface BacklogItem {
  readonly issue: number;
  readonly titel: string;
  /** Het `App`-veld; undefined als het niet gezet is (dan weet de werker niet waar hij moet kijken). */
  readonly app?: string;
  readonly kolom: string;
  readonly aangemaakt: string;
  /**
   * De labels van het issue. Komen mee in dezelfde board-lezing (#182): de bouw-wachtrij
   * filtert op `type:bug`/`type:task` en op `escalatie`, en dat mag geen tweede
   * aanroep per item kosten — zie de kostenparagraaf in #104.
   */
  readonly labels: readonly string[];
  /** Het ouder-issue (sub-issue-relatie), als dit item er een heeft. */
  readonly ouder?: number;
}

const WACHTRIJ_QUERY = `query($eigenaar:String!,$project:Int!,$na:String){
  user(login:$eigenaar){ projectV2(number:$project){
    appVeld: field(name:"App"){ ... on ProjectV2SingleSelectField { options { name } } }
    items(first:100, after:$na){
      pageInfo{ hasNextPage endCursor }
      nodes{
        status: fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }
        app: fieldValueByName(name:"App"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }
        content{ ... on Issue { number title state createdAt
          labels(first:20){ nodes{ name } }
          parent{ number } } } } } } }
}`;

interface WachtrijAntwoord {
  readonly data?: {
    readonly user?: {
      readonly projectV2?: {
        readonly appVeld?: {
          readonly options?: readonly { readonly name?: string }[];
        } | null;
        readonly items?: {
          readonly pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          readonly nodes?: {
            status?: { name?: string } | null;
            app?: { name?: string } | null;
            content?: {
              number?: number;
              title?: string;
              state?: string;
              createdAt?: string;
              labels?: { nodes?: ({ name?: string } | null)[] } | null;
              parent?: { number?: number } | null;
            } | null;
          }[];
        };
      };
    };
  };
}

/** Alle open items in één kolom, oudste eerst. Een filter op `bordItems`. */
export function wachtrijVan(kolom: Kolom, cwd?: string): BacklogItem[] | undefined {
  return bordItems(cwd)?.filter((item) => item.kolom === kolom);
}

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
export function bordItems(cwd?: string): BacklogItem[] | undefined {
  laatsteAppOpties = undefined;
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return undefined;
  }
  const gevonden: BacklogItem[] = [];
  let na: string | undefined;
  // Ruime bovengrens: 50 pagina's is 5000 items, ver boven alles wat deze backlog ooit
  // wordt. De grens staat er zodat een kapotte `endCursor` geen oneindige lus wordt.
  for (let pagina = 0; pagina < 50; pagina += 1) {
    const ruw = uitvoerMetEnv(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${WACHTRIJ_QUERY}`,
        '-f',
        `eigenaar=${EIGENAAR}`,
        '-F',
        `project=${String(PROJECT_NUMMER)}`,
        ...(na === undefined ? [] : ['-f', `na=${na}`]),
      ],
      cwd,
      omgeving.env,
    );
    if (ruw === undefined || ruw === '') {
      return undefined;
    }
    let antwoord: WachtrijAntwoord;
    try {
      antwoord = JSON.parse(ruw) as WachtrijAntwoord;
    } catch {
      return undefined;
    }
    // De veldopties zitten op projectniveau en zijn op elke pagina gelijk; lees ze
    // alleen bij de eerste pagina om de parse niet te herhalen.
    if (pagina === 0) {
      const opties = antwoord.data?.user?.projectV2?.appVeld?.options;
      laatsteAppOpties =
        opties === undefined
          ? []
          : opties
              .map((optie) => optie.name)
              .filter((naam): naam is string => naam !== undefined)
              .sort();
    }
    const items = antwoord.data?.user?.projectV2?.items;
    if (items === undefined) {
      return undefined;
    }
    for (const knoop of items.nodes ?? []) {
      const inhoud = knoop.content;
      const nummer = inhoud?.number;
      const kolom = knoop.status?.name;
      if (nummer === undefined || inhoud?.state !== 'OPEN' || kolom === undefined) {
        continue;
      }
      const app = knoop.app?.name;
      const ouder = inhoud.parent?.number;
      const labels = (inhoud.labels?.nodes ?? [])
        .map((label) => label?.name)
        .filter((naam): naam is string => naam !== undefined);
      gevonden.push({
        issue: nummer,
        titel: inhoud.title ?? '',
        kolom,
        aangemaakt: inhoud.createdAt ?? '',
        labels,
        ...(app === undefined ? {} : { app }),
        ...(ouder === undefined ? {} : { ouder }),
      });
    }
    const volgende = items.pageInfo?.endCursor;
    if (items.pageInfo?.hasNextPage !== true || volgende === undefined || volgende === null) {
      return gevonden.sort((a, b) => a.aangemaakt.localeCompare(b.aangemaakt) || a.issue - b.issue);
    }
    na = volgende;
  }
  waarschuwing('board heeft meer dan 50 paginas; wachtrij mogelijk onvolledig.');
  return gevonden.sort((a, b) => a.aangemaakt.localeCompare(b.aangemaakt) || a.issue - b.issue);
}

/**
 * De opties van het App-veld op het board, uit de meest recente `bordItems`-lezing.
 *
 * Dit is het register van bestaande applicaties: veldopties staan er altijd, ook als
 * geen enkel item die app draagt. Levert `undefined` als het board niet gelezen kon
 * worden (net als `bordItems` zelf), en een lege array als het veld geen opties heeft.
 *
 * Geen tweede API-aanroep: de opties zitten in dezelfde query als de items en worden
 * bij de eerste pagina uitgelezen. Roep `bordItems` aan vóór `appOpties` — zonder een
 * eerdere lezing is er niets om terug te geven.
 */
export function appOpties(): string[] | undefined {
  return laatsteAppOpties;
}

// Gevuld door `bordItems` bij de eerste pagina; `undefined` tot de eerste lezing.
let laatsteAppOpties: string[] | undefined;

/** Het label waaraan een geëscaleerd item te herkennen is. */
export const ESCALATIE_LABEL = 'escalatie';

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
export function escalaties(cwd?: string): Set<number> | undefined {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return undefined;
  }
  const ruw = uitvoerMetEnv(
    'gh',
    [
      'api',
      `repos/${EIGENAAR}/${BACKLOG_REPO}/issues?state=open&labels=${ESCALATIE_LABEL}&per_page=100`,
      '--jq',
      '.[].number',
    ],
    cwd,
    omgeving.env,
  );
  if (ruw === undefined) {
    return undefined;
  }
  if (ruw === '') {
    // Wél gelezen, niets gevonden: dat is een geldige lege wachtrij.
    return new Set();
  }
  const nummers = ruw
    .split('\n')
    .map((regel) => Number.parseInt(regel.trim(), 10))
    .filter((nummer) => Number.isSafeInteger(nummer) && nummer > 0);
  return new Set(nummers);
}

/**
 * Maakt het escalatie-label aan als het nog niet bestaat (idempotent).
 *
 * `gh issue edit --add-label` faalt op een label dat niet bestaat, en `zetLabel` faalt
 * zacht — samen zou dat betekenen dat een escalatie stil niet gemarkeerd wordt en het
 * item elke run opnieuw opgepakt wordt. Zelfde patroon als `zorgVoorWachtrijLabel`.
 */
export function zorgVoorEscalatieLabel(cwd?: string): void {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return;
  }
  run(
    'gh',
    [
      'label',
      'create',
      ESCALATIE_LABEL,
      '--repo',
      `${EIGENAAR}/${BACKLOG_REPO}`,
      '--description',
      'Werker is gestopt met een vraag, of de run mislukte',
      '--color',
      'D93F0B',
    ],
    {
      ...(cwd === undefined ? {} : { cwd }),
      ...(omgeving.env === undefined ? {} : { env: omgeving.env }),
      capture: true,
      toleranter: true,
    },
  );
}

/** Zet een label op een backlog-issue. Faalt zacht, net als de rest van dit bestand. */
export function zetLabel(issue: number, label: string, cwd?: string): void {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return;
  }
  const uitkomst = run(
    'gh',
    ['issue', 'edit', String(issue), '--repo', `${EIGENAAR}/${BACKLOG_REPO}`, '--add-label', label],
    {
      ...(cwd === undefined ? {} : { cwd }),
      ...(omgeving.env === undefined ? {} : { env: omgeving.env }),
      capture: true,
      toleranter: true,
    },
  );
  if (uitkomst.code !== 0) {
    waarschuwing(`kon label '${label}' niet op #${String(issue)} zetten.`);
  }
}

/** Haalt een label van een backlog-issue af. Faalt zacht, net als {@link zetLabel}. */
export function verwijderLabel(issue: number, label: string, cwd?: string): void {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return;
  }
  const uitkomst = run(
    'gh',
    [
      'issue',
      'edit',
      String(issue),
      '--repo',
      `${EIGENAAR}/${BACKLOG_REPO}`,
      '--remove-label',
      label,
    ],
    {
      ...(cwd === undefined ? {} : { cwd }),
      ...(omgeving.env === undefined ? {} : { env: omgeving.env }),
      capture: true,
      toleranter: true,
    },
  );
  if (uitkomst.code !== 0) {
    waarschuwing(`kon label '${label}' niet van #${String(issue)} verwijderen.`);
  }
}

/** Schrijft de body van een backlog-issue uit een bestand. Faalt zacht. */
export function schrijfBody(issue: number, bodyBestand: string, cwd?: string): boolean {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return false;
  }
  const uitkomst = run(
    'gh',
    [
      'issue',
      'edit',
      String(issue),
      '--repo',
      `${EIGENAAR}/${BACKLOG_REPO}`,
      '--body-file',
      bodyBestand,
    ],
    {
      ...(cwd === undefined ? {} : { cwd }),
      ...(omgeving.env === undefined ? {} : { env: omgeving.env }),
      capture: true,
      toleranter: true,
    },
  );
  if (uitkomst.code !== 0) {
    waarschuwing(`kon de body van #${String(issue)} niet bijwerken.`);
    return false;
  }
  return true;
}

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
 * dat scheelt een waarschuwing per issue. Lukt een enkele beweging niet — token zonder
 * project-scope, item niet op het board, geweigerde mutatie — dan komt dat item er ook bij.
 * De aanroeper krijgt de nummers terug zodat hij ze kan mélden (#195): een stille overslag
 * met exit 0 liet de kolom Uitrollen vollopen zonder dat iemand het zag.
 */
export function zetItemsUitBereikOpDone(
  vanaf: string,
  tag: string,
  itemMelding: string,
  ouderMelding: string,
  cwd?: string,
): AfrondUitkomst {
  const issues = [...issuesUitBereik(vanaf, tag, cwd)];
  // Een bereik zonder items is geen overslag: dan valt er niets te melden en hoort het
  // stil te blijven, ook zonder token. Anders wordt elke patch-release een bericht.
  if (issues.length === 0) {
    return { verzet: [], overgeslagen: [] };
  }
  if (!bordBereikbaar()) {
    waarschuwing(
      `geen PROJECT_TOKEN in deze workflow — niet naar 'Done' gezet: ` +
        `${issues.map((i) => `#${String(i)}`).join(', ')}.`,
    );
    return { verzet: [], overgeslagen: issues };
  }
  const verzet: number[] = [];
  const overgeslagen: number[] = [];
  for (const issue of issues) {
    // Guard: sluit een issue met open kinderen niet — het is een epic waar nog
    // slices openstaan (#348).
    const aantalOpen = openKinderenAantal(issue, cwd);
    if (aantalOpen > 0) {
      waarschuwing(
        `#${String(issue)} heeft nog ${String(aantalOpen)} open ` +
          `sub-issue${aantalOpen === 1 ? '' : 's'} — niet naar Done gezet`,
      );
      overgeslagen.push(issue);
      continue;
    }

    const beweging = zetKolomUitkomst(issue, 'Done', cwd);
    if (beweging === 'mislukt') {
      // Niet alleen een ontbrekend token laat een item liggen: een token dat het board niet
      // mág lezen, een weggehaald bord-item of een geweigerde mutatie doen hetzelfde. Alle
      // drie horen in de melding (#195, gezien op release v1.15.15).
      overgeslagen.push(issue);
      continue;
    }
    if (beweging === 'al-goed') {
      continue;
    }
    verzet.push(issue);
    plaatsComment(issue, itemMelding, cwd);
    sluitIssue(issue, cwd);
    ok(`#${String(issue)} staat op Done`);

    // Was dit de laatste slice, dan is de epic zelf ook af.
    const ouder = ouderVan(issue, cwd);
    if (ouder !== undefined && alleKinderenDicht(ouder, cwd)) {
      plaatsComment(ouder, ouderMelding, cwd);
      sluitIssue(ouder, cwd);
      ok(`#${String(ouder)} is afgerond — alle slices zijn af`);
    }
  }
  return { verzet, overgeslagen };
}

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
export function orkestratorComments(issue: number, markering: string, cwd?: string): string[] {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return [];
  }
  const ruw = uitvoerMetEnv(
    'gh',
    [
      'api',
      `repos/${EIGENAAR}/${BACKLOG_REPO}/issues/${String(issue)}/comments?per_page=100`,
      '--jq',
      '[.[].body] | @base64',
    ],
    cwd,
    omgeving.env,
  );
  if (ruw === undefined || ruw === '') {
    return [];
  }
  // Base64 omdat comment-bodies zelf newlines bevatten; anders is er geen scheiding
  // tussen twee comments in de uitvoer van jq.
  let bodies: unknown;
  try {
    bodies = JSON.parse(Buffer.from(ruw.trim(), 'base64').toString('utf8')) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(bodies)) {
    return [];
  }
  return bodies.filter(
    (body): body is string => typeof body === 'string' && body.includes(markering),
  );
}

/** Haalt een label van een backlog-issue. Faalt zacht. */
export function haalLabelWeg(issue: number, label: string, cwd?: string): void {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    return;
  }
  const uitkomst = run(
    'gh',
    [
      'issue',
      'edit',
      String(issue),
      '--repo',
      `${EIGENAAR}/${BACKLOG_REPO}`,
      '--remove-label',
      label,
    ],
    {
      ...(cwd === undefined ? {} : { cwd }),
      ...(omgeving.env === undefined ? {} : { env: omgeving.env }),
      capture: true,
      toleranter: true,
    },
  );
  if (uitkomst.code !== 0) {
    waarschuwing(`kon label '${label}' niet van #${String(issue)} halen.`);
  }
}
