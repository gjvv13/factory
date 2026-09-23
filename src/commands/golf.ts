/**
 * `factory golf` — een golf aan bouwactiviteiten dispatchen vanuit de coördinatie-chat (#434).
 *
 * De actie-tweeling van `factory brief` (#404): brief láát zien, golf láát handelen. Golf
 * leest de bouw-wachtrij over alle apps heen, vraagt één kostenakkoord, en dispatcht de
 * gekozen items serieel als losse bouw-runs. Dispatch ≠ merge: elke run opent hooguit een
 * PR zonder auto-merge; mergen blijft een apart besluit.
 *
 * Bewust een subprocess per item (`factory orkestreer --soort bouw --issue <n> --eenmalig`)
 * en geen functie-extractie: zo hergebruikt golf de volledige bouw-cyclus (spiegel,
 * worktree, claude-run, review, inleveren) zonder refactor. Een falende run stopt de golf
 * niet — het item escaleert zoals bij een losse run en de golf gaat door.
 */

import { EIGENAAR, bordItems, type BacklogItem } from '../board.js';
import { BOUW_KOLOM, bouwWachtrij, type Bouwitem } from './orkestreer-bouw.js';
import {
  MAX_GOLF_ITEMS,
  boekRun,
  leesInstellingen,
  standaardPaden,
} from '../orkestrator-instellingen.js';
import {
  bevestig,
  GebruikersFout,
  isInteractief,
  kop,
  ok,
  run,
  uitvoerVan,
  waarschuwing,
} from '../shell.js';

export interface GolfOpties {
  /** Beperk tot deze app(s); leeg = alle apps. */
  readonly apps?: readonly string[];
  /** Beperk tot deze issue-nummers (mits op Klaar voor Bouwen); leeg = de hele rij. */
  readonly issues?: readonly number[];
  /** Toon de wachtrij en de geschatte kosten zonder te dispatchen. */
  readonly dry?: boolean;
}

export interface GolfSelectie {
  /** De items die deze golf zou bouwen, na de app- en issue-filters. */
  readonly gekozen: Bouwitem[];
  /** Gevraagde issues (`--issue`) die niet in de bouw-wachtrij staan. */
  readonly onbekend: number[];
}

/**
 * Pure selectie: de bouw-wachtrij, versmald met de app- en issue-vlaggen. `onbekend`
 * wordt tegen de héle wachtrij bepaald (vóór het app-filter), zodat een gevraagd issue
 * dat gewoon niet bouwbaar is los gemeld wordt van een app-filter dat het wegneemt.
 */
export function golfSelectie(
  wachtrij: readonly Bouwitem[],
  apps: readonly string[],
  issues: readonly number[],
): GolfSelectie {
  const inRij = new Set(wachtrij.map((item) => item.issue));
  const onbekend = issues.filter((n) => !inRij.has(n));

  let gekozen = [...wachtrij];
  if (apps.length > 0) {
    const gewenst = new Set(apps);
    gekozen = gekozen.filter((item) => gewenst.has(item.app));
  }
  if (issues.length > 0) {
    const gewenst = new Set(issues);
    gekozen = gekozen.filter((item) => gewenst.has(item.issue));
  }
  return { gekozen, onbekend };
}

/** Geschatte kosten van een golf: (bouw + review) per item. */
export function golfKosten(aantal: number, bouwBudget: number, reviewBudget: number): number {
  return aantal * (bouwBudget + reviewBudget);
}

/** De uitkomst van één gedispatchte bouw-run in de golf. */
export type GolfUitkomst = 'geslaagd' | 'geëscaleerd' | 'mislukt';

/**
 * De buitenwereld-afhankelijkheden van `golf`, injecteerbaar voor tests. In productie
 * lezen ze het board, spawnen ze de bouw-run en vragen ze het akkoord echt; een test
 * geeft ze als stubs en toetst zo de selectie, het plafond, de dry-run en de lus zonder
 * gh of een subproces.
 */
export interface GolfDeps {
  /** Leest het board; undefined = niet leesbaar. Default: `bordItems()`. */
  readonly leesBord?: () => BacklogItem[] | undefined;
  /** Dispatcht één bouw-run en geeft de exitcode terug. Default: subprocess. */
  readonly dispatch?: (item: Bouwitem) => number;
  /** Bepaalt de uitkomst na een dispatch. Default: exitcode + escalatie-label. */
  readonly leesUitkomst?: (item: Bouwitem, exitCode: number) => GolfUitkomst;
  /** Vraagt het kostenakkoord. Default: `bevestig`. */
  readonly bevestigFn?: (vraag: string) => Promise<boolean>;
  /** Budget per run (bouw + review). Default: uit de orkestrator-instellingen. */
  readonly budget?: { readonly bouw: number; readonly review: number };
  /** Boekt één dispatch (pot `interactief`). Default: `boekRun` op de echte staat. */
  readonly boekFn?: () => void;
}

/**
 * De echte dispatch: dezelfde factory-CLI die nu draait (process.argv[1]), zodat de golf
 * niet afhangt van een globale `factory` op PATH die kan afwijken. Serieel, één per keer.
 */
function standaardDispatch(item: Bouwitem): number {
  const cliPad = process.argv[1] ?? 'factory';
  return run(process.execPath, [
    cliPad,
    'orkestreer',
    '--soort',
    'bouw',
    '--issue',
    String(item.issue),
    '--eenmalig',
  ]).code;
}

/**
 * Bepaalt de uitkomst na een dispatch: een niet-nul exitcode is een mislukking; anders
 * telt het `escalatie`-label op het issue (een escalatie eindigt met exit 0, geen PR).
 * Zo klopt de eindsamenvatting met wat een losse bouw-run zou doen.
 */
function standaardUitkomst(item: Bouwitem, exitCode: number): GolfUitkomst {
  if (exitCode !== 0) {
    return 'mislukt';
  }
  const labels = uitvoerVan('gh', [
    'issue',
    'view',
    String(item.issue),
    '--repo',
    `${EIGENAAR}/${item.app}`,
    '--json',
    'labels',
    '--jq',
    '.labels[].name',
  ]);
  return (labels ?? '').split('\n').includes('escalatie') ? 'geëscaleerd' : 'geslaagd';
}

export async function golf(opties: GolfOpties = {}, deps: GolfDeps = {}): Promise<void> {
  const apps = opties.apps ?? [];
  const issues = opties.issues ?? [];
  const leesBord = deps.leesBord ?? bordItems;
  const dispatch = deps.dispatch ?? standaardDispatch;
  const leesUitkomst = deps.leesUitkomst ?? standaardUitkomst;
  const bevestigFn = deps.bevestigFn ?? bevestig;
  const boekFn =
    deps.boekFn ?? (() => boekRun(standaardPaden(), new Date(Date.now()), 'interactief'));

  const items = leesBord();
  if (items === undefined) {
    throw new GebruikersFout(
      'Kon het board niet lezen (is gh ingelogd met project-scope?). Golf afgebroken.',
    );
  }

  const { gekozen, onbekend } = golfSelectie(bouwWachtrij(items), apps, issues);
  for (const n of onbekend) {
    waarschuwing(`#${String(n)} staat niet op ${BOUW_KOLOM} (of is niet bouwbaar) — overgeslagen.`);
  }

  kop('Bouw-golf');
  if (gekozen.length === 0) {
    ok(`Bouw-wachtrij is leeg — niets op ${BOUW_KOLOM}.`);
    return;
  }

  gekozen.forEach((item, i) => {
    process.stdout.write(
      `  ${String(i + 1)}. #${String(item.issue)} — ${item.titel} (${item.app})\n`,
    );
  });

  // Plafond ná het tonen: je ziet wát er te veel is, en dus waarop je kunt filteren.
  if (gekozen.length > MAX_GOLF_ITEMS) {
    throw new GebruikersFout(
      `${String(gekozen.length)} items overschrijdt het plafond van ${String(MAX_GOLF_ITEMS)}. ` +
        `Beperk de selectie met --app of --issue.`,
    );
  }

  const budget =
    deps.budget ??
    (() => {
      const inst = leesInstellingen(standaardPaden());
      return { bouw: inst.bouwBudgetPerRun, review: inst.reviewBudgetPerRun };
    })();
  const perItem = budget.bouw + budget.review;
  const kosten = golfKosten(gekozen.length, budget.bouw, budget.review);
  process.stdout.write(
    `\n  ${String(gekozen.length)} items, ~$${String(kosten)} (~$${String(perItem)}/item)\n`,
  );

  if (opties.dry === true) {
    ok('Dry-run — niets gedispatcht.');
    return;
  }

  // De TTY-guard geldt alleen voor de echte `bevestig` (leest stdin): zonder terminal
  // zou die hangen. Een geïnjecteerde bevestigFn (test) heeft geen terminal nodig.
  if (deps.bevestigFn === undefined && !isInteractief()) {
    throw new GebruikersFout('golf vraagt een kostenakkoord; draai het interactief.');
  }
  const akkoord = await bevestigFn(`Bouw deze ${String(gekozen.length)} items?`);
  if (!akkoord) {
    ok('Afgebroken — niets gedispatcht.');
    return;
  }

  // Serieel dispatchen: de volgende start pas na afronding van de vorige.
  const resultaten = new Map<GolfUitkomst, number>();
  for (const [i, item] of gekozen.entries()) {
    kop(
      `[${String(i + 1)}/${String(gekozen.length)}] #${String(item.issue)} — ${item.titel} (${item.app})`,
    );
    boekFn();
    const code = dispatch(item);
    const uitkomst = leesUitkomst(item, code);
    resultaten.set(uitkomst, (resultaten.get(uitkomst) ?? 0) + 1);
    if (uitkomst === 'geslaagd') {
      ok(`#${String(item.issue)} — PR geopend (zonder auto-merge).`);
    } else if (uitkomst === 'geëscaleerd') {
      waarschuwing(`#${String(item.issue)} — geëscaleerd; zie het escalatie-label op het issue.`);
    } else {
      waarschuwing(`#${String(item.issue)} — bouw mislukt (exit ${String(code)}).`);
    }
  }

  kop('Golf afgerond');
  const g = resultaten.get('geslaagd') ?? 0;
  const e = resultaten.get('geëscaleerd') ?? 0;
  const m = resultaten.get('mislukt') ?? 0;
  process.stdout.write(
    `  ${String(g)} geslaagd, ${String(e)} geëscaleerd, ${String(m)} mislukt (van ${String(gekozen.length)}).\n`,
  );
  ok('Draai `factory brief` voor het vervolg.');
}
