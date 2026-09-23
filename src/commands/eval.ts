import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { EIGENAAR } from '../board.js';
import { factoryPakketDir, templatesDir } from '../paths.js';
import { GebruikersFout, kop, ok, uitvoerVan, waarschuwing } from '../shell.js';
import {
  AGENT_BOUWER,
  AGENT_REFINER,
  draaiBouwer,
  draaiWerker,
  type BouwUitkomst,
  type BouwVerdict,
  type WerkerOpdracht,
  type WerkerUitkomst,
} from '../werker.js';
import { versWerkplaats, werkplaatsWortel } from '../werkplaats.js';
import { bouwBranch, bouwWerkplek } from './orkestreer-bouw.js';
import { ruimWerkplekOp, werkplek } from './werkplek.js';
import {
  beoordeelItem,
  EVAL_BASISLIJN_PAD,
  EVAL_TOLERANTIE,
  leesBasislijn,
  schrijfBasislijn,
  type EvalBasislijn,
} from '../eval/basislijn.js';
import {
  appsVan,
  type EvalSoort,
  GOUDEN_SET_PAD,
  itemsVanSoort,
  leesGoudenSet,
  type GoudenItem,
  type GoudenSet,
} from '../eval/gouden-set.js';
import { draaiJudge, type JudgeFn } from '../eval/judge.js';
import { BOUW_RUBRIEK, normaliseerScore } from '../eval/rubriek.js';

/**
 * `factory eval` (#361): het regressienet voor de onbemande werkers.
 *
 * Het commando haalt een gouden set bevroren issues door de echte werker-prompt, laat de
 * output door een LLM-judge tegen een vaste rubriek scoren, en vergelijkt de scores met
 * een basislijn — dezelfde ratchet-vorm als de dekkingspoort. Zo wordt een prompt- of
 * skill-wijziging die een werker slechter maakt zichtbaar vóór hij een nacht lang draait.
 *
 * Slice 1 (refine) haalt elk item door de refine-prompt. Slice 2 (bouw) draait per
 * bouw-item de échte bouw-werker in een eval-worktree, leest de diff en scoort die tegen
 * de bouw-rubriek; de worktree wordt na de run opgeruimd, ook bij een fout. Zonder
 * `--soort` draaien beide soorten in één tabel.
 *
 * De werker-, bouwer- en judge-aanroep en de worktree-creatie/-opruiming zijn
 * injecteerbaar: zo draaien de tests zonder een echte `claude` of `git` te starten en
 * schrijven ze niets buiten een tmp-map. In productie zijn het `draaiWerker`,
 * `draaiBouwer`, `draaiJudge` en een verse worktree via `versWerkplaats` + `werkplek`.
 */

/** De kolom die de eval-prompt invult voor `{{KOLOM}}`; dezelfde als een refine-run. */
const WERK_KOLOM = 'Technisch refinen';

/**
 * De lees-instructieregel van `werker-refine.md` die de eval door de bevroren body
 * vervangt. We pinnen op de **inhoud** (de regel die met "1. Lees het issue:" begint en
 * `gh issue view` bevat), niet op een regelnummer: het nummer verschuift zodra iemand
 * het sjabloon bijwerkt, de betekenis niet. Vindt de regex hem niet, dan is het sjabloon
 * gedrift en faalt de opbouw luid — precies wat de test bewaakt.
 */
const LEES_INSTRUCTIE = /^.*1\. Lees het issue:.*gh issue view.*$/m;

/** Het gedrag bij een regressie: geel waarschuwen of rood blokkeren (besluit #4). */
export type EvalGedrag = 'waarschuw' | 'blokkeer';

const gedragSchema = z.enum(['waarschuw', 'blokkeer']);

/**
 * Een eval-worktree voor één bouw-item: de werkmap waarin de bouw-werker draait, de
 * factory-map als leesmap, en een opruimer die de aanroeper in een `finally` moet
 * draaien zodat een fout de worktree niet laat staan (#361, slice 2).
 */
export interface EvalWorktree {
  readonly werkmap: string;
  readonly factoryMap: string;
  /** Ruimt de worktree op. Idempotent en best-effort; nooit een reden om te falen. */
  readonly opruim: () => void;
}

/** Maakt de eval-worktree voor een bouw-item; injecteerbaar zodat een test geen git draait. */
export type MaakEvalWorktree = (app: string, issue: number, wortel: string) => EvalWorktree;

/**
 * De standaard-worktree-creatie: dezelfde aanpak als `bouwAf` in `orkestreer-bouw.ts`.
 * Een verse spiegel op `origin/main`, een factory-spiegel als leesmap, en een git-worktree
 * op `slice/<issue>-1` via `factory werkplek`. De opruimer haalt de worktree weer weg.
 */
const standaardMaakEvalWorktree: MaakEvalWorktree = (app, issue, wortel) => {
  const spiegel = versWerkplaats(app, EIGENAAR, wortel);
  const factoryMap = versWerkplaats('factory', EIGENAAR, wortel);
  const werkmap = bouwWerkplek(app, issue, wortel);
  // Via `factory werkplek` en niet met een eigen `git worktree add`: dan geldt dezelfde
  // padconventie en branchnaam als voor een echte bouw-run (#361, slice 2).
  werkplek(String(issue), { cwd: spiegel, slice: 1 });
  return {
    werkmap,
    factoryMap,
    opruim: () => {
      ruimWerkplekOp(spiegel, werkmap);
    },
  };
};

/** Leest de diff van een eval-worktree t.o.v. `origin/main`; injecteerbaar voor tests. */
export type DiffFn = (werkmap: string) => string;

/**
 * De standaard-diff: de wijzigingen van de worktree t.o.v. `origin/main` (commits én
 * werkmap), zodat de judge ziet wat de bouw-werker aan de code veranderde. `origin/main`
 * en niet `HEAD~`: de werker commit in kleine stappen, dus het verschil met de basis is
 * de volledige uitwerking.
 */
const standaardDiff: DiffFn = (werkmap) =>
  uitvoerVan('git', ['-C', werkmap, 'diff', 'origin/main'], werkmap) ?? '';

export interface EvalOpties {
  /** Toont de gouden set en het judge-model zonder iets te draaien. */
  readonly dry?: boolean;
  /** Schrijft de huidige scores als nieuwe basislijn (de bewuste handeling, besluit #2). */
  readonly bijwerk?: boolean;
  /**
   * Beperkt de run tot één taaksoort (#361, slice 2). Afwezig = beide: alle items in de
   * gouden set, refine én bouw, in één tabel.
   */
  readonly soort?: EvalSoort;
  /** Gedrag bij regressie; standaard uit `package.json` ("eval"), anders `waarschuw`. */
  readonly gedrag?: EvalGedrag;
  /** Pad naar de gouden set; injecteerbaar voor tests. */
  readonly goudenSetPad?: string;
  /** Pad naar de basislijn; injecteerbaar voor tests. */
  readonly basislijnPad?: string;
  /** De werker-aanroep; default `draaiWerker`. Injecteerbaar zodat een test geen claude start. */
  readonly werkerFn?: (opdracht: WerkerOpdracht) => Promise<WerkerUitkomst>;
  /** De bouw-werker-aanroep; default `draaiBouwer`. Injecteerbaar om dezelfde reden. */
  readonly bouwerFn?: (opdracht: WerkerOpdracht) => Promise<BouwUitkomst>;
  /** De judge-aanroep; default `draaiJudge`. Injecteerbaar om dezelfde reden. */
  readonly judgeFn?: JudgeFn;
  /** Maakt de eval-worktree per bouw-item; default een verse worktree via git. */
  readonly maakWorktree?: MaakEvalWorktree;
  /** Leest de diff uit een eval-worktree; default `git diff origin/main`. */
  readonly diffFn?: DiffFn;
  /**
   * Bouwt/verst de werkmap voor een app; default een verse spiegel via `versWerkplaats`.
   * Injecteerbaar zodat een test een tijdelijke map kan meegeven i.p.v. git te draaien.
   */
  readonly versWerkmap?: (app: string, wortel: string) => string;
  /** De wortel van de werkplaatsen; geen CLI-vlag, alleen voor tests. */
  readonly werkplaatsWortel?: string;
  /** Kostenrem per eval-item; default `FACTORY_EVAL_BUDGET_USD` of $1. */
  readonly budgetUsd?: number;
  /** Tijdsgrens per run in ms; afwezig = geen grens (met de hand draai je onder je ogen). */
  readonly timeoutMs?: number;
  /** Het moment van deze run; injecteerbaar zodat de tijdstempel testbaar is. */
  readonly nu?: Date;
}

/**
 * Bouwt de eval-prompt: het productie-sjabloon `werker-refine.md` met dezelfde
 * substituties als een echte refine-run, maar met de `gh issue view`-instructie
 * vervangen door de bevroren body inline. Zo test de eval de échte prompt zonder de
 * productiestroom of GitHub te raken.
 */
export function bouwEvalPrompt(
  item: GoudenItem,
  werkmap: string,
  factoryMap: string,
  apps: readonly string[],
  sjabloon: string = readFileSync(path.join(templatesDir, 'werker-refine.md'), 'utf8'),
): string {
  const vervang: Record<string, string> = {
    '{{ISSUE}}': String(item.issue),
    '{{TITEL}}': item.titel,
    '{{APP}}': item.app,
    '{{KOLOM}}': WERK_KOLOM,
    '{{WERKMAP}}': werkmap,
    '{{FACTORY_MAP}}': factoryMap,
    '{{BEKENDE_APPS}}': apps.join(', '),
    // De gouden refine-set bevat feature-refinements; de bug-uitzondering (#782) heeft
    // geen frontier en dus geen eval-waarde. Render {{SOORT}} daarom als 'feature'.
    '{{SOORT}}': 'feature',
  };
  const basis = Object.entries(vervang).reduce(
    (tekst, [sleutel, waarde]) => tekst.split(sleutel).join(waarde),
    sjabloon,
  );
  if (!LEES_INSTRUCTIE.test(basis)) {
    throw new Error(
      'werker-refine.md is gedrift: de regel "1. Lees het issue: … gh issue view …" is niet ' +
        'gevonden, dus de bevroren body kan hem niet vervangen. Werk de eval-promptopbouw bij.',
    );
  }
  return basis.replace(LEES_INSTRUCTIE, `Het issue staat hieronder:\n\n${item.body}`);
}

/**
 * Bouwt de eval-prompt voor een bouw-item (#361, slice 2): het productie-sjabloon
 * `werker-bouw.md` met dezelfde substituties als `bouwPrompt` in `orkestreer-bouw.ts`,
 * maar met de `gh issue view`-instructie vervangen door de bevroren body. Zo test de eval
 * de échte bouw-prompt zonder GitHub te raken. Er zijn geen bron-mappen in een eval-run,
 * dus `{{BRON_MAPPEN}}` wordt leeg.
 */
export function bouwBouwEvalPrompt(
  item: GoudenItem,
  werkmap: string,
  factoryMap: string,
  apps: readonly string[],
  sjabloon: string = readFileSync(path.join(templatesDir, 'werker-bouw.md'), 'utf8'),
): string {
  const vervang: Record<string, string> = {
    '{{ISSUE}}': String(item.issue),
    '{{TITEL}}': item.titel,
    '{{APP}}': item.app,
    '{{BRANCH}}': bouwBranch(item.issue),
    '{{WERKMAP}}': werkmap,
    '{{FACTORY_MAP}}': factoryMap,
    '{{BRON_MAPPEN}}': '',
    '{{BEKENDE_APPS}}': apps.join(', '),
  };
  const basis = Object.entries(vervang).reduce(
    (tekst, [sleutel, waarde]) => tekst.split(sleutel).join(waarde),
    sjabloon,
  );
  if (!LEES_INSTRUCTIE.test(basis)) {
    throw new Error(
      'werker-bouw.md is gedrift: de regel "1. Lees het issue: … gh issue view …" is niet ' +
        'gevonden, dus de bevroren body kan hem niet vervangen. Werk de eval-promptopbouw bij.',
    );
  }
  return basis.replace(LEES_INSTRUCTIE, `Het issue staat hieronder:\n\n${item.body}`);
}

/**
 * Zet het verdict van een geslaagde bouw-run om naar de tekst die de judge als
 * "werker-uitkomst" beoordeelt: de samenvatting plus het bewijs per acceptatiecriterium.
 * De diff gaat er los naast (zie `bouwJudgeBouwPrompt`).
 */
export function formatBouwVerdict(verdict: Extract<BouwVerdict, { uitkomst: 'klaar' }>): string {
  const bewijs = verdict.criteria.map((c) => `- ${c.criterium}: ${c.bewijs}`).join('\n');
  return `Samenvatting: ${verdict.samenvatting}\n\nBewijs per acceptatiecriterium:\n${bewijs}`;
}

/** Leest het regressie-gedrag uit `package.json` ("eval"); valt terug op `waarschuw`. */
function leesGedragUitPakket(): EvalGedrag {
  try {
    const pkg: unknown = JSON.parse(
      readFileSync(path.join(factoryPakketDir, 'package.json'), 'utf8'),
    );
    const rauw = (pkg as { eval?: unknown }).eval;
    const gelezen = gedragSchema.safeParse(rauw);
    return gelezen.success ? gelezen.data : 'waarschuw';
  } catch {
    // Geen leesbaar package.json is geen reden om de eval te laten omvallen: dan geldt
    // gewoon het veiligste gedrag, waarschuwen zonder te blokkeren.
    return 'waarschuw';
  }
}

/**
 * De kostenrem per eval-item, uit de omgeving of de default (besluit #5): $1 voor refine,
 * $5 voor bouw — bouwen is lezen, schrijven, de poort draaien en op rood opnieuw, en dat
 * zijn simpelweg meer beurten. `FACTORY_EVAL_BUDGET_USD` overschrijft beide.
 */
function leesEvalBudget(soort: EvalSoort): number {
  const standaard = soort === 'bouw' ? 5 : 1;
  const rauw = process.env['FACTORY_EVAL_BUDGET_USD'];
  const n = rauw === undefined ? standaard : Number(rauw);
  return Number.isFinite(n) && n > 0 ? n : standaard;
}

/** Het resultaat van één geëvalueerd item: de scores, het totaal en of de werker leverde. */
interface ItemResultaat {
  readonly item: GoudenItem;
  /** Het genormaliseerde totaal (0–10); 0 als de werker geen uitwerking leverde. */
  readonly totaal: number;
  /** De ruwe criteriumscores; leeg als de werker niets leverde. */
  readonly criteria: number[];
  /** Of de werker een bruikbare uitwerking (`klaar` met body) opleverde. */
  readonly gelukt: boolean;
  /** Bij een mislukte werker: de reden, voor de tabel. */
  readonly reden?: string;
  /** Wat de run (werker + judge) samen kostte, als het bekend is. */
  readonly kosten?: number;
}

/**
 * Leest de `--soort`-vlag voor `factory eval` (#361, slice 2). Afwezig = beide soorten
 * (undefined). Alleen `refine` en `bouw` zijn geldig; `accepteer` bestaat wel als
 * werker-soort maar heeft geen eval.
 */
export function leesEvalSoort(waarde: string | undefined): EvalSoort | undefined {
  if (waarde === undefined) {
    return undefined;
  }
  if (waarde === 'refine' || waarde === 'bouw') {
    return waarde;
  }
  throw new GebruikersFout(
    `Onbekende --soort '${waarde}' voor eval. Kies: refine of bouw, of laat weg voor beide.`,
  );
}

/** Draait de eval. Zie `factory help` voor de vlaggen. */
export async function evalueer(opties: EvalOpties = {}): Promise<void> {
  if (opties.dry === true && opties.bijwerk === true) {
    throw new GebruikersFout('--dry en --bijwerk sluiten elkaar uit; kies er één.');
  }

  const goudenSetPad = opties.goudenSetPad ?? GOUDEN_SET_PAD;
  const set = leesGoudenSet(goudenSetPad);

  // Zonder `--soort` beide taaksoorten; met `--soort` alleen die ene. Bepaal dit vóór de
  // dry-tak, zodat de preview toont wat er écht zou draaien (niet de hele set).
  const soorten: readonly EvalSoort[] =
    opties.soort === undefined ? ['refine', 'bouw'] : [opties.soort];

  if (opties.dry === true) {
    toonDroog(set, soorten);
    return;
  }

  const werkerFn = opties.werkerFn ?? draaiWerker;
  const bouwerFn = opties.bouwerFn ?? draaiBouwer;
  const judgeFn = opties.judgeFn ?? draaiJudge;
  const wortel = opties.werkplaatsWortel ?? werkplaatsWortel;
  const versWerkmap =
    opties.versWerkmap ?? ((app: string, w: string) => versWerkplaats(app, EIGENAAR, w));
  const maakWorktree = opties.maakWorktree ?? standaardMaakEvalWorktree;
  const diffFn = opties.diffFn ?? standaardDiff;
  const gedrag = opties.gedrag ?? leesGedragUitPakket();
  const bekendeApps = appsVan(set);
  const nu = opties.nu ?? new Date(Date.now());

  const refineItems = soorten.includes('refine') ? itemsVanSoort(set, 'refine') : [];
  const bouwItems = soorten.includes('bouw') ? itemsVanSoort(set, 'bouw') : [];
  const budgetVoor = (soort: EvalSoort): number => opties.budgetUsd ?? leesEvalBudget(soort);

  const teEvalueren = refineItems.length + bouwItems.length;
  kop(`Eval: ${String(teEvalueren)} items · judge ${set.judgeModel} (${set.judgeEffort})`);

  const resultaten: ItemResultaat[] = [];

  // Refine-items eerst: één gedeelde factory-spiegel als leesmap, geen worktree per item.
  if (refineItems.length > 0) {
    const factoryMap = versWerkmap('factory', wortel);
    for (const item of refineItems) {
      resultaten.push(
        await evalueerItem(item, {
          werkerFn,
          judgeFn,
          versWerkmap,
          factoryMap,
          wortel,
          bekendeApps,
          budgetUsd: budgetVoor('refine'),
          set,
          ...(opties.timeoutMs === undefined ? {} : { timeoutMs: opties.timeoutMs }),
        }),
      );
    }
  }

  // Bouw-items: elk in een eigen eval-worktree, die na de run wordt opgeruimd (#361, slice 2).
  for (const item of bouwItems) {
    resultaten.push(
      await evalueerBouwItem(item, {
        bouwerFn,
        judgeFn,
        maakWorktree,
        diffFn,
        wortel,
        bekendeApps,
        budgetUsd: budgetVoor('bouw'),
        set,
        ...(opties.timeoutMs === undefined ? {} : { timeoutMs: opties.timeoutMs }),
      }),
    );
  }

  const basislijn = leesBasislijn(opties.basislijnPad ?? EVAL_BASISLIJN_PAD);
  const regressies = toonEnBeoordeel(resultaten, basislijn);

  if (opties.bijwerk === true) {
    const nieuw = nieuweBasislijn(basislijn, resultaten, nu);
    schrijfBasislijn(opties.basislijnPad ?? EVAL_BASISLIJN_PAD, nieuw);
    ok(`basislijn bijgewerkt (${String(resultaten.filter((r) => r.gelukt).length)} items).`);
    return;
  }

  if (regressies.length === 0) {
    ok('geen regressies onder de basislijn.');
    return;
  }

  const melding =
    `${String(regressies.length)} item(s) zakten meer dan ${EVAL_TOLERANTIE.toFixed(1)} punt ` +
    `onder de basislijn: ${regressies.map((r) => `#${String(r.item.issue)}`).join(', ')}.`;
  if (gedrag === 'blokkeer') {
    // Rood + exit 1: een GebruikersFout wordt door de CLI als fout afgedrukt en eindigt
    // met code 1 — precies de poort-breuk die `blokkeer` hoort te geven.
    throw new GebruikersFout(melding);
  }
  waarschuwing(melding);
  waarschuwing('gedrag "waarschuw": de poort blijft groen. Zet "eval": "blokkeer" om te falen.');
}

/** Toont de gouden set en het judge-model zonder iets te draaien (`--dry`). */
function toonDroog(set: GoudenSet, soorten: readonly EvalSoort[]): void {
  const teTonen = set.items.filter((item) => soorten.includes(item.soort));
  kop(`Gouden set (${String(teTonen.length)} items · ${soorten.join(' + ')})`);
  for (const item of teTonen) {
    process.stdout.write(
      `  #${String(item.issue).padEnd(5)} ${item.app.padEnd(12)} ${item.titel}\n`,
    );
  }
  process.stdout.write(`\nJudge-model: ${set.judgeModel} (effort ${set.judgeEffort})\n`);
  process.stdout.write('Er is niets gedraaid — geen werker, geen judge, niets geschreven.\n');
}

/** Draait één item: werker, dan judge, dan normaliseren. */
async function evalueerItem(
  item: GoudenItem,
  ctx: {
    readonly werkerFn: (opdracht: WerkerOpdracht) => Promise<WerkerUitkomst>;
    readonly judgeFn: JudgeFn;
    readonly versWerkmap: (app: string, wortel: string) => string;
    readonly factoryMap: string;
    readonly wortel: string;
    readonly bekendeApps: readonly string[];
    readonly budgetUsd: number;
    readonly set: GoudenSet;
    readonly timeoutMs?: number;
  },
): Promise<ItemResultaat> {
  kop(`#${String(item.issue)} — ${item.titel}`);
  const werkmap = ctx.versWerkmap(item.app, ctx.wortel);
  const prompt = bouwEvalPrompt(item, werkmap, ctx.factoryMap, ctx.bekendeApps);
  const werker = await ctx.werkerFn({
    prompt,
    werkmap,
    sessie: randomUUID(),
    extraMappen: [ctx.factoryMap],
    budgetUsd: ctx.budgetUsd,
    agent: AGENT_REFINER,
    ...(ctx.timeoutMs === undefined ? {} : { timeoutMs: ctx.timeoutMs }),
  });

  if (werker.afloop !== 'klaar' || werker.verdict?.uitkomst !== 'klaar') {
    const reden = werker.fout ?? `de werker leverde geen uitwerking (${werker.afloop})`;
    waarschuwing(`#${String(item.issue)}: ${reden}`);
    return {
      item,
      totaal: 0,
      criteria: [],
      gelukt: false,
      reden,
      ...(werker.kosten === undefined ? {} : { kosten: werker.kosten }),
    };
  }

  const oordeel = await ctx.judgeFn({
    issueBody: item.body,
    werkerOutput: werker.verdict.body,
    model: ctx.set.judgeModel,
    effort: ctx.set.judgeEffort,
    budgetUsd: ctx.budgetUsd,
  });
  const totaal = normaliseerScore(oordeel.scores);
  const kosten =
    werker.kosten === undefined && oordeel.kosten === undefined
      ? undefined
      : (werker.kosten ?? 0) + (oordeel.kosten ?? 0);
  return {
    item,
    totaal,
    criteria: oordeel.scores,
    gelukt: true,
    ...(kosten === undefined ? {} : { kosten }),
  };
}

/**
 * Draait één bouw-item (#361, slice 2): een eval-worktree, de bouw-werker, de diff, dan
 * de judge tegen de bouw-rubriek. De worktree wordt in een `finally` opgeruimd, zodat een
 * gefaalde werker of een fout in het scoren de worktree nooit laat staan.
 */
async function evalueerBouwItem(
  item: GoudenItem,
  ctx: {
    readonly bouwerFn: (opdracht: WerkerOpdracht) => Promise<BouwUitkomst>;
    readonly judgeFn: JudgeFn;
    readonly maakWorktree: MaakEvalWorktree;
    readonly diffFn: DiffFn;
    readonly wortel: string;
    readonly bekendeApps: readonly string[];
    readonly budgetUsd: number;
    readonly set: GoudenSet;
    readonly timeoutMs?: number;
  },
): Promise<ItemResultaat> {
  kop(`#${String(item.issue)} — ${item.titel}`);
  const wt = ctx.maakWorktree(item.app, item.issue, ctx.wortel);
  try {
    const prompt = bouwBouwEvalPrompt(item, wt.werkmap, wt.factoryMap, ctx.bekendeApps);
    const bouw = await ctx.bouwerFn({
      prompt,
      werkmap: wt.werkmap,
      sessie: randomUUID(),
      extraMappen: [wt.factoryMap],
      budgetUsd: ctx.budgetUsd,
      // `draaiBouwer` gebruikt standaard `BOUW_JSON_SCHEMA`; expliciet meegeven hoeft niet.
      agent: AGENT_BOUWER,
      ...(ctx.timeoutMs === undefined ? {} : { timeoutMs: ctx.timeoutMs }),
    });

    if (bouw.afloop !== 'klaar' || bouw.verdict?.uitkomst !== 'klaar') {
      const reden = bouw.fout ?? `de bouw-werker leverde geen uitwerking (${bouw.afloop})`;
      waarschuwing(`#${String(item.issue)}: ${reden}`);
      return {
        item,
        totaal: 0,
        criteria: [],
        gelukt: false,
        reden,
        ...(bouw.kosten === undefined ? {} : { kosten: bouw.kosten }),
      };
    }

    const diff = ctx.diffFn(wt.werkmap);
    const oordeel = await ctx.judgeFn({
      issueBody: item.body,
      werkerOutput: formatBouwVerdict(bouw.verdict),
      soort: 'bouw',
      diff,
      model: ctx.set.judgeModel,
      effort: ctx.set.judgeEffort,
      budgetUsd: ctx.budgetUsd,
    });
    const totaal = normaliseerScore(oordeel.scores, BOUW_RUBRIEK);
    const kosten =
      bouw.kosten === undefined && oordeel.kosten === undefined
        ? undefined
        : (bouw.kosten ?? 0) + (oordeel.kosten ?? 0);
    return {
      item,
      totaal,
      criteria: oordeel.scores,
      gelukt: true,
      ...(kosten === undefined ? {} : { kosten }),
    };
  } finally {
    // De worktree opruimen, óók bij een fout: een achtergebleven worktree is rommel die
    // de volgende run in de weg zit. Best-effort, zodat de opruiming geen fout maskeert.
    try {
      wt.opruim();
    } catch (fout) {
      waarschuwing(
        `#${String(item.issue)}: eval-worktree opruimen mislukte: ${fout instanceof Error ? fout.message : String(fout)}`,
      );
    }
  }
}

/**
 * Toont de scoretabel naast de basislijn en geeft de regressies terug. Een regressie is
 * een totaal dat verder dan de tolerantie onder de vastgelegde basislijn zakt; een
 * bootstrap (nog geen basislijn) en winst (de lat schuift omhoog) worden ook gemeld.
 */
function toonEnBeoordeel(
  resultaten: readonly ItemResultaat[],
  basislijn: EvalBasislijn,
): ItemResultaat[] {
  process.stdout.write('\n  issue    nu     basis  status\n');
  const regressies: ItemResultaat[] = [];
  for (const r of resultaten) {
    const was = basislijn[String(r.item.issue)]?.totaal;
    const oordeel = beoordeelItem(r.totaal, was);
    const status = !r.gelukt
      ? 'MISLUKT'
      : oordeel.bootstrap
        ? 'nieuw'
        : oordeel.regressie
          ? 'REGRESSIE'
          : oordeel.winst
            ? 'omhoog'
            : 'gelijk';
    const nuTekst = r.gelukt ? r.totaal.toFixed(1) : '—';
    const basisTekst = was === undefined ? '—' : was.toFixed(1);
    process.stdout.write(
      `  #${String(r.item.issue).padEnd(6)} ${nuTekst.padStart(4)}   ${basisTekst.padStart(4)}   ${status}\n`,
    );
    if (oordeel.regressie) {
      regressies.push(r);
    }
  }
  return regressies;
}

/**
 * Bouwt de nieuwe basislijn voor `--bijwerk`: de huidige scores van elk gelukt item,
 * met een tijdstempel. Een item dat niets leverde houdt zijn oude basislijn — er zijn
 * geen huidige scores om vast te leggen, en die stil op 0 zetten zou de lat verlagen.
 */
function nieuweBasislijn(
  oud: EvalBasislijn,
  resultaten: readonly ItemResultaat[],
  nu: Date,
): EvalBasislijn {
  const nieuw: EvalBasislijn = { ...oud };
  const tijdstempel = new Date(nu.getTime()).toISOString();
  for (const r of resultaten) {
    if (r.gelukt) {
      nieuw[String(r.item.issue)] = { totaal: r.totaal, criteria: r.criteria, tijdstempel };
    }
  }
  return nieuw;
}
