import { run, uitvoerVan, waarschuwing } from './shell.js';

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
  return uitkomst.code === 0 ? uitkomst.stdout.trim() : undefined;
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
  'Uitrollen',
  'Done',
] as const;

export type Kolom = (typeof KOLOMMEN)[number];

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

interface Doelwit {
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

/**
 * Zet een issue in een kolom. Levert true als er iets veranderd is.
 *
 * Faalt nooit hard: de pijplijn levert software af, en de administratie mag dat niet
 * tegenhouden. Een leeg board, een rate-limit of een ontbrekend item geeft een
 * waarschuwing en gaat door — anders valt een uitrol om op boekhouding.
 */
export function zetKolom(issue: number, kolom: Kolom, cwd?: string): boolean {
  const omgeving = ghOmgeving();
  if (!omgeving.kan) {
    waarschuwing(
      `geen PROJECT_TOKEN in deze workflow — #${String(issue)} niet naar '${kolom}' gezet.`,
    );
    return false;
  }
  const doelwit = zoekDoelwit(issue, kolom, cwd, omgeving.env);
  if (doelwit === undefined) {
    waarschuwing(`kon #${String(issue)} niet op het board vinden — kolom niet gezet.`);
    return false;
  }
  if (doelwit.huidig === kolom) {
    return false;
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
    waarschuwing(`kon #${String(issue)} niet naar '${kolom}' verplaatsen op het board.`);
    return false;
  }
  return true;
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
 * De backlog-issues die tussen twee tags zijn gemerged, uit de merge-commits.
 *
 * GitHub schrijft de branchnaam in het onderwerp van een merge-commit
 * ("Merge pull request #140 from gjvv13/slice/128-1"), dus de koppeling issue↔release
 * ligt al vast in de git-historie en hoeft nergens apart bijgehouden te worden.
 * Branches zonder slice-vorm leveren niets op — dat is bedoeld: van de tien merges in
 * v1.15.1 waren er vijf een fix- of docs-branch.
 */
export function issuesUitBereik(vorigeTag: string, tag: string, cwd?: string): number[] {
  const log = uitvoerVan('git', ['log', '--format=%s', `${vorigeTag}..${tag}`], cwd);
  if (log === undefined || log === '') {
    return [];
  }
  const gevonden = new Set<number>();
  for (const regel of log.split('\n')) {
    const match = /^Merge pull request #\d+ from [^/]+\/slice\/(\d+)-\d+$/.exec(regel.trim());
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

/**
 * Het issuenummer van de ouder-epic, of undefined als dit issue er geen heeft.
 *
 * REST geeft `parent_issue_url` (een API-url die op het nummer eindigt). Dat is
 * goedkoper dan de GraphQL-variant én het telt tegen de andere pot — zie #104.
 */
export function ouderVan(issue: number, cwd?: string): number | undefined {
  const url = issueVeld(issue, '.parent_issue_url', cwd);
  if (url === undefined) {
    return undefined;
  }
  const match = /\/(\d+)$/.exec(url.trim());
  if (match?.[1] === undefined) {
    return undefined;
  }
  const nummer = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(nummer) && nummer > 0 ? nummer : undefined;
}

/**
 * Of alle slices van een epic dicht zijn. `sub_issues_summary` telt de gesloten
 * kinderen, dus dit is één aanroep in plaats van de kinderen langslopen.
 * False bij een issue zonder kinderen: dan valt er niets af te ronden.
 */
export function alleKinderenDicht(ouder: number, cwd?: string): boolean {
  const ruw = issueVeld(ouder, '.sub_issues_summary | "\\(.completed)/\\(.total)"', cwd);
  if (ruw === undefined) {
    return false;
  }
  const [gedaan, totaal] = ruw.trim().split('/').map(Number);
  return totaal !== undefined && totaal > 0 && gedaan === totaal;
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
}

const WACHTRIJ_QUERY = `query($eigenaar:String!,$project:Int!,$na:String){
  user(login:$eigenaar){ projectV2(number:$project){
    items(first:100, after:$na){
      pageInfo{ hasNextPage endCursor }
      nodes{
        status: fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }
        app: fieldValueByName(name:"App"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }
        content{ ... on Issue { number title state createdAt } } } } } }
}`;

interface WachtrijAntwoord {
  readonly data?: {
    readonly user?: {
      readonly projectV2?: {
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
            } | null;
          }[];
        };
      };
    };
  };
}

/**
 * Alle open items in één kolom, oudste eerst.
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
export function wachtrijVan(kolom: Kolom, cwd?: string): BacklogItem[] | undefined {
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
    const items = antwoord.data?.user?.projectV2?.items;
    if (items === undefined) {
      return undefined;
    }
    for (const knoop of items.nodes ?? []) {
      const inhoud = knoop.content;
      const nummer = inhoud?.number;
      if (nummer === undefined || inhoud?.state !== 'OPEN' || knoop.status?.name !== kolom) {
        continue;
      }
      const app = knoop.app?.name;
      gevonden.push({
        issue: nummer,
        titel: inhoud.title ?? '',
        kolom,
        aangemaakt: inhoud.createdAt ?? '',
        ...(app === undefined ? {} : { app }),
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
