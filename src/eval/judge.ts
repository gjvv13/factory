import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { templatesDir } from '../paths.js';
import { GebruikersFout, runAsync } from '../shell.js';
import { BOUW_RUBRIEK, formatRubriek, REFINE_RUBRIEK, type RubriekCriterium } from './rubriek.js';
import type { EvalSoort } from './gouden-set.js';

/**
 * De LLM-judge (#361, slice 1): een aparte `claude`-aanroep die de werker-output tegen
 * de rubriek scoort.
 *
 * Alles wat het model teruggeeft is invoer van buiten (coding guidelines, _Types_): de
 * respons gaat door een Zod-schema voordat we er scores uit halen. Een ongeldige of
 * onvolledige respons is een luide fout — nooit een "waarschijnlijk gelukt", want een
 * verzonnen score zou de basislijn-poort ongemerkt vervuilen.
 *
 * De judge draait op het vaste model/effort uit de gouden set (besluit #3): tegen een
 * vaste rubriek is geen creatief model nodig, en het vastpinnen houdt de scores stabiel.
 */

/** Het pad van de judge-prompt voor refine-output. */
export const JUDGE_TEMPLATE_PAD = path.join(templatesDir, 'eval-judge-refine.md');
/** Het pad van de judge-prompt voor bouw-output (#361, slice 2). */
export const JUDGE_BOUW_TEMPLATE_PAD = path.join(templatesDir, 'eval-judge-bouw.md');

const judgeCriteriumSchema = z.object({
  nummer: z.number().int().min(1),
  score: z.number().int().min(0).max(2),
  toelichting: z.string().min(1),
});

const judgeResponsSchema = z.object({
  criteria: z.array(judgeCriteriumSchema),
});

export type JudgeRespons = z.infer<typeof judgeResponsSchema>;

/**
 * Het JSON-schema dat aan `claude --json-schema` meegaat. Met de hand geschreven en
 * plat, om dezelfde reden als de werker-schema's (`werker.ts`): `z.toJSONSchema` zet er
 * een `$schema`-sleutel in die de CLI weigert.
 */
export const JUDGE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      description: 'exact één item per rubriekcriterium, in rubriek-volgorde, elk met een score',
      items: {
        type: 'object',
        properties: {
          nummer: { type: 'integer', description: 'het criteriumnummer uit de rubriek' },
          score: { type: 'integer', description: 'de score voor dit criterium: 0, 1 of 2' },
          toelichting: { type: 'string', description: 'één zin die de score verantwoordt' },
        },
        required: ['nummer', 'score', 'toelichting'],
        additionalProperties: false,
      },
    },
  },
  required: ['criteria'],
  additionalProperties: false,
} as const;

/**
 * Bouwt de judge-prompt: het sjabloon met de rubriek, de bevroren issue-body en de
 * werker-output ingevuld. De rubriek komt uit `rubriek.ts` zodat de prompt niet kan
 * wegdriften van de criteria die de parser daarna afdwingt.
 */
export function bouwJudgePrompt(
  issueBody: string,
  werkerOutput: string,
  sjabloon: string = readFileSync(JUDGE_TEMPLATE_PAD, 'utf8'),
  rubriek: readonly RubriekCriterium[] = REFINE_RUBRIEK,
): string {
  const vervang: Record<string, string> = {
    '{{RUBRIEK}}': formatRubriek(rubriek),
    '{{ISSUE_BODY}}': issueBody,
    '{{WERKER_OUTPUT}}': werkerOutput,
  };
  return Object.entries(vervang).reduce(
    (tekst, [sleutel, waarde]) => tekst.split(sleutel).join(waarde),
    sjabloon,
  );
}

/**
 * Bouwt de judge-prompt voor een bouw-run (#361, slice 2): de bouw-rubriek, de bevroren
 * issue-body, de werker-uitkomst (samenvatting + bewijs per criterium) én de diff uit de
 * worktree. De diff is het extra bewijs dat een bouw-oordeel nodig heeft en een
 * refine-oordeel niet: de judge toetst of het beweerde bewijs echt in de wijzigingen zit.
 */
export function bouwJudgeBouwPrompt(
  issueBody: string,
  werkerOutput: string,
  diff: string,
  sjabloon: string = readFileSync(JUDGE_BOUW_TEMPLATE_PAD, 'utf8'),
  rubriek: readonly RubriekCriterium[] = BOUW_RUBRIEK,
): string {
  const vervang: Record<string, string> = {
    '{{RUBRIEK}}': formatRubriek(rubriek),
    '{{ISSUE_BODY}}': issueBody,
    '{{WERKER_OUTPUT}}': werkerOutput,
    '{{DIFF}}': diff === '' ? '(geen diff — de werker liet geen wijzigingen achter)' : diff,
  };
  return Object.entries(vervang).reduce(
    (tekst, [sleutel, waarde]) => tekst.split(sleutel).join(waarde),
    sjabloon,
  );
}

/**
 * Parseert de judge-respons naar scores in rubriek-volgorde. Weigert alles wat de
 * poort niet vertrouwt: een respons die het schema niet haalt, een ontbrekend of
 * dubbel criteriumnummer, of een nummer dat niet in de rubriek staat. Zonder deze
 * strengheid zou een half antwoord als geldige score de basislijn in schuiven.
 */
export function parseJudgeRespons(
  ruw: unknown,
  rubriek: readonly RubriekCriterium[] = REFINE_RUBRIEK,
): { readonly scores: number[]; readonly toelichtingen: string[] } {
  const gelezen = judgeResponsSchema.safeParse(ruw);
  if (!gelezen.success) {
    const details = gelezen.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new GebruikersFout(`judge-respons is ongeldig: ${details}`);
  }
  const perNummer = new Map<number, { score: number; toelichting: string }>();
  for (const item of gelezen.data.criteria) {
    if (perNummer.has(item.nummer)) {
      throw new GebruikersFout(`judge-respons noemt criterium ${String(item.nummer)} dubbel.`);
    }
    perNummer.set(item.nummer, { score: item.score, toelichting: item.toelichting });
  }
  const scores: number[] = [];
  const toelichtingen: string[] = [];
  for (const criterium of rubriek) {
    const gevonden = perNummer.get(criterium.nummer);
    if (gevonden === undefined) {
      throw new GebruikersFout(
        `judge-respons mist criterium ${String(criterium.nummer)} (${criterium.naam}).`,
      );
    }
    scores.push(gevonden.score);
    toelichtingen.push(gevonden.toelichting);
  }
  if (perNummer.size !== rubriek.length) {
    throw new GebruikersFout(
      `judge-respons scoort ${String(perNummer.size)} criteria; ${String(rubriek.length)} verwacht.`,
    );
  }
  return { scores, toelichtingen };
}

/** Wat één judge-run oplevert: de scores in rubriek-volgorde plus wat het kostte. */
export interface JudgeUitslag {
  readonly scores: number[];
  readonly toelichtingen: string[];
  readonly kosten?: number;
}

/** Het verzoek aan de judge voor één item. */
export interface JudgeVerzoek {
  readonly issueBody: string;
  readonly werkerOutput: string;
  readonly model: string;
  readonly effort: string;
  readonly budgetUsd: number;
  /**
   * De taaksoort; bepaalt de rubriek en het judge-sjabloon (#361, slice 2). Afwezig of
   * `'refine'` scoort tegen de refine-rubriek — zo blijven de slice-1-aanroepen werken.
   */
  readonly soort?: EvalSoort;
  /** De diff uit de eval-worktree; alleen zinvol bij een bouw-oordeel. */
  readonly diff?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

/** De vorm van de judge-aanroep; injecteerbaar zodat een test geen `claude` start. */
export type JudgeFn = (verzoek: JudgeVerzoek) => Promise<JudgeUitslag>;

const envelopSchema = z.object({
  is_error: z.boolean(),
  total_cost_usd: z.number().optional(),
  structured_output: z.unknown().optional(),
});

/**
 * De prompt voor een judge-run, gekozen op taaksoort: de bouw-prompt (met de diff) bij
 * `soort: 'bouw'`, anders de refine-prompt. Eén plek, zodat `judgeArgumenten` en een test
 * dezelfde keuze zien.
 */
export function judgePrompt(verzoek: JudgeVerzoek): string {
  return verzoek.soort === 'bouw'
    ? bouwJudgeBouwPrompt(verzoek.issueBody, verzoek.werkerOutput, verzoek.diff ?? '')
    : bouwJudgePrompt(verzoek.issueBody, verzoek.werkerOutput);
}

/** De rubriek waartegen een judge-oordeel geparsed wordt, gekozen op taaksoort. */
function rubriekVoor(soort: EvalSoort | undefined): readonly RubriekCriterium[] {
  return soort === 'bouw' ? BOUW_RUBRIEK : REFINE_RUBRIEK;
}

/** De `claude`-argumenten voor een judge-run. Apart zodat een test ze kan nalopen. */
export function judgeArgumenten(verzoek: JudgeVerzoek): string[] {
  return [
    '-p',
    judgePrompt(verzoek),
    '--output-format',
    'json',
    '--model',
    verzoek.model,
    '--effort',
    verzoek.effort,
    // De judge oordeelt uit de meegegeven tekst en heeft geen enkel gereedschap nodig;
    // niets toestaan houdt hem lees-alleen en voorkomt dat hij de werkmap in duikt.
    '--disallowedTools',
    'Read',
    'Edit',
    'Write',
    'Bash',
    '--max-budget-usd',
    String(verzoek.budgetUsd),
    '--json-schema',
    JSON.stringify(JUDGE_JSON_SCHEMA),
  ];
}

/**
 * De echte judge-run: één `claude`-aanroep via `runAsync`, envelop parsen, respons
 * scoren. Faalt luid bij een kapotte envelop of een `is_error`-run — de eval mag geen
 * verzonnen scores doorlaten.
 */
export const draaiJudge: JudgeFn = async (verzoek) => {
  const uitkomst = await runAsync('claude', judgeArgumenten(verzoek), {
    capture: true,
    toleranter: true,
    ...(verzoek.env === undefined ? {} : { env: verzoek.env }),
    ...(verzoek.timeoutMs === undefined ? {} : { timeoutMs: verzoek.timeoutMs }),
  });
  if (uitkomst.afgekapt) {
    throw new GebruikersFout('de judge-run is afgekapt voordat hij een oordeel gaf.');
  }
  let ruw: unknown;
  try {
    ruw = JSON.parse(uitkomst.stdout);
  } catch {
    const staart = (uitkomst.stderr === '' ? uitkomst.stdout : uitkomst.stderr).trim().slice(-300);
    throw new GebruikersFout(`de judge gaf geen leesbare JSON terug: ${staart}`);
  }
  const envelop = envelopSchema.safeParse(ruw);
  if (!envelop.success) {
    throw new GebruikersFout(`de envelop van de judge wijkt af: ${envelop.error.message}`);
  }
  if (envelop.data.is_error) {
    throw new GebruikersFout('de judge-run eindigde met een fout (is_error).');
  }
  if (envelop.data.structured_output === undefined || envelop.data.structured_output === null) {
    throw new GebruikersFout('de judge gaf geen gestructureerd oordeel terug.');
  }
  const { scores, toelichtingen } = parseJudgeRespons(
    envelop.data.structured_output,
    rubriekVoor(verzoek.soort),
  );
  return {
    scores,
    toelichtingen,
    ...(envelop.data.total_cost_usd === undefined ? {} : { kosten: envelop.data.total_cost_usd }),
  };
};
