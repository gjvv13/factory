import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { factoryPakketDir } from '../paths.js';
import { GebruikersFout } from '../shell.js';

/**
 * De gouden set: een handvol bevroren refine-issues waarmee `factory eval` de
 * werker-prompt toetst (#361, slice 1).
 *
 * "Bevroren" is het hele punt: de `body` is de issue-tekst op het moment van opname,
 * zodat de eval herhaalbaar blijft ongeacht latere bewerkingen op GitHub. De eval
 * leest het issue dus niet met `gh issue view`, maar giet deze `body` inline in de
 * prompt (zie `eval.ts`).
 *
 * Het judge-model en -effort staan op bestandsniveau, niet per item: een modelwissel
 * hoort een bewuste commit te zijn (besluit #3 in de issue), niet iets dat per run
 * verschuift.
 */

/** Het judge-model dat de eval standaard gebruikt als de gouden set het niet noemt. */
export const STANDAARD_JUDGE_MODEL = 'claude-sonnet-4-20250514';
/** De judge-effort die de eval standaard gebruikt als de gouden set het niet noemt. */
export const STANDAARD_JUDGE_EFFORT = 'medium';

/** Het standaardpad van de gouden set, in de factory-repo zelf (dev-tooling). */
export const GOUDEN_SET_PAD = path.join(factoryPakketDir, 'eval', 'gouden-set.json');

/** De taaksoort van een gouden-set-item: refine (slice 1) of bouw (slice 2). */
export const EVAL_SOORTEN = ['refine', 'bouw'] as const;
export type EvalSoort = (typeof EVAL_SOORTEN)[number];

const goudenItemSchema = z.object({
  issue: z.number().int().positive(),
  app: z.string().min(1),
  // Sinds slice 2 (#361) evalueert de eval beide taaksoorten. Een bouw-item wordt per
  // item onderscheiden op `soort`, zodat `eval.ts` de juiste rubriek en werker kiest.
  soort: z.enum(EVAL_SOORTEN),
  titel: z.string().min(1),
  body: z.string().min(1),
});

export type GoudenItem = z.infer<typeof goudenItemSchema>;

const goudenSetSchema = z.object({
  judgeModel: z.string().min(1).default(STANDAARD_JUDGE_MODEL),
  judgeEffort: z.enum(['low', 'medium', 'high']).default(STANDAARD_JUDGE_EFFORT),
  items: z.array(goudenItemSchema).min(1),
});

export type GoudenSet = z.infer<typeof goudenSetSchema>;

/**
 * Valideert een reeds geparste waarde tegen het gouden-set-schema. Apart van het
 * lezen zodat een test de validatie kan toetsen zonder een bestand aan te maken.
 */
export function parseGoudenSet(ruw: unknown, herkomst: string): GoudenSet {
  const gelezen = goudenSetSchema.safeParse(ruw);
  if (!gelezen.success) {
    const details = gelezen.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new GebruikersFout(`${herkomst} is geen geldige gouden set: ${details}`);
  }
  return gelezen.data;
}

/**
 * Leest en valideert de gouden set van schijf. Een ontbrekend of onleesbaar bestand
 * is een luide fout, geen stille lege set: zonder gouden set is er niets te evalueren,
 * en dat stil doorlaten zou een groene eval zonder inhoud opleveren.
 */
export function leesGoudenSet(pad: string = GOUDEN_SET_PAD): GoudenSet {
  let inhoud: string;
  try {
    inhoud = readFileSync(pad, 'utf8');
  } catch (fout) {
    throw new GebruikersFout(
      `Kon de gouden set niet lezen (${pad}): ${fout instanceof Error ? fout.message : String(fout)}`,
    );
  }
  let ruw: unknown;
  try {
    ruw = JSON.parse(inhoud);
  } catch (fout) {
    throw new GebruikersFout(
      `${pad} bevat geen geldige JSON: ${fout instanceof Error ? fout.message : String(fout)}`,
    );
  }
  return parseGoudenSet(ruw, pad);
}

/** De unieke apps in de gouden set, in de volgorde waarin ze het eerst voorkomen. */
export function appsVan(set: GoudenSet): string[] {
  return [...new Set(set.items.map((item) => item.app))];
}

/** De items van één taaksoort, in oorspronkelijke volgorde (#361, slice 2). */
export function itemsVanSoort(set: GoudenSet, soort: EvalSoort): GoudenItem[] {
  return set.items.filter((item) => item.soort === soort);
}
