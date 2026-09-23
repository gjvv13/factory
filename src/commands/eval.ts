import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { EIGENAAR } from '../board.js';
import { factoryPakketDir, templatesDir } from '../paths.js';
import { GebruikersFout, kop, ok, waarschuwing } from '../shell.js';
import { AGENT_REFINER, draaiWerker, type WerkerOpdracht, type WerkerUitkomst } from '../werker.js';
import { versWerkplaats, werkplaatsWortel } from '../werkplaats.js';
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
  GOUDEN_SET_PAD,
  leesGoudenSet,
  type GoudenItem,
  type GoudenSet,
} from '../eval/gouden-set.js';
import { draaiJudge, type JudgeFn } from '../eval/judge.js';
import { normaliseerScore } from '../eval/rubriek.js';

/**
 * `factory eval` (#361, slice 1): het regressienet voor de onbemande refine-werker.
 *
 * Het commando haalt een gouden set bevroren refine-issues door de echte werker-prompt,
 * laat de output door een LLM-judge tegen een vaste rubriek scoren, en vergelijkt de
 * scores met een basislijn — dezelfde ratchet-vorm als de dekkingspoort. Zo wordt een
 * prompt- of skill-wijziging die de werker slechter maakt zichtbaar vóór hij een nacht
 * lang draait.
 *
 * De werker- en judge-aanroep zijn injecteerbaar (`werkerFn`, `judgeFn`): zo draaien de
 * tests zonder een echte `claude` te starten. In productie zijn het `draaiWerker` en
 * `draaiJudge`.
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

export interface EvalOpties {
  /** Toont de gouden set en het judge-model zonder iets te draaien. */
  readonly dry?: boolean;
  /** Schrijft de huidige scores als nieuwe basislijn (de bewuste handeling, besluit #2). */
  readonly bijwerk?: boolean;
  /** Gedrag bij regressie; standaard uit `package.json` ("eval"), anders `waarschuw`. */
  readonly gedrag?: EvalGedrag;
  /** Pad naar de gouden set; injecteerbaar voor tests. */
  readonly goudenSetPad?: string;
  /** Pad naar de basislijn; injecteerbaar voor tests. */
  readonly basislijnPad?: string;
  /** De werker-aanroep; default `draaiWerker`. Injecteerbaar zodat een test geen claude start. */
  readonly werkerFn?: (opdracht: WerkerOpdracht) => Promise<WerkerUitkomst>;
  /** De judge-aanroep; default `draaiJudge`. Injecteerbaar om dezelfde reden. */
  readonly judgeFn?: JudgeFn;
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

/** De kostenrem per eval-item, uit de omgeving of de default ($1 voor refine, besluit #5). */
function leesEvalBudget(): number {
  const rauw = process.env['FACTORY_EVAL_BUDGET_USD'];
  const n = rauw === undefined ? 1 : Number(rauw);
  return Number.isFinite(n) && n > 0 ? n : 1;
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

/** Draait de eval. Zie `factory help` voor de vlaggen. */
export async function evalueer(opties: EvalOpties = {}): Promise<void> {
  if (opties.dry === true && opties.bijwerk === true) {
    throw new GebruikersFout('--dry en --bijwerk sluiten elkaar uit; kies er één.');
  }

  const goudenSetPad = opties.goudenSetPad ?? GOUDEN_SET_PAD;
  const set = leesGoudenSet(goudenSetPad);

  if (opties.dry === true) {
    toonDroog(set);
    return;
  }

  const werkerFn = opties.werkerFn ?? draaiWerker;
  const judgeFn = opties.judgeFn ?? draaiJudge;
  const wortel = opties.werkplaatsWortel ?? werkplaatsWortel;
  const versWerkmap =
    opties.versWerkmap ?? ((app: string, w: string) => versWerkplaats(app, EIGENAAR, w));
  const budgetUsd = opties.budgetUsd ?? leesEvalBudget();
  const gedrag = opties.gedrag ?? leesGedragUitPakket();
  const bekendeApps = appsVan(set);
  const nu = opties.nu ?? new Date(Date.now());

  kop(`Eval: ${String(set.items.length)} items · judge ${set.judgeModel} (${set.judgeEffort})`);

  const factoryMap = versWerkmap('factory', wortel);
  const resultaten: ItemResultaat[] = [];
  for (const item of set.items) {
    resultaten.push(
      await evalueerItem(item, {
        werkerFn,
        judgeFn,
        versWerkmap,
        factoryMap,
        wortel,
        bekendeApps,
        budgetUsd,
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
function toonDroog(set: GoudenSet): void {
  kop(`Gouden set (${String(set.items.length)} items)`);
  for (const item of set.items) {
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
