import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { REVIEW_JSON_SCHEMA, type ReviewVerdict } from './werker.js';
import { meldOps, type OpsMeldingConfig } from './ops-melding.js';
import { kop, ok, run, uitvoerVan, waarschuwing } from './shell.js';

/** Het Zod-schema waarmee het review-verdict gevalideerd wordt. */
const reviewBevindingSchema = z.object({
  bestand: z.string().min(1),
  regel: z.number().int().positive().optional(),
  ernst: z.enum(['laag', 'midden', 'hoog']),
  bevinding: z.string().min(1),
});

const reviewVerdictSchema = z.object({
  bevindingen: z.array(reviewBevindingSchema),
  oordeel: z.string().min(1),
});

/**
 * Of `claude` op het pad beschikbaar is. Draait via de testbare `run`, zodat
 * tests dit kunnen stubben zonder de echte CLI nodig te hebben. Vangt zowel
 * een niet-nul exitcode als een startfout (commando niet gevonden) op.
 */
export function claudeBeschikbaar(): boolean {
  try {
    return uitvoerVan('claude', ['--version']) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Geeft de diff ten opzichte van `origin/main` terug, of undefined als die leeg is.
 * Controleert de ref eerst: een ontbrekende `origin/main` is een reden om de gate
 * niet te laten draaien, niet om halverwege te crashen.
 */
export function leesDiff(repoDir: string): string | undefined {
  const ref = uitvoerVan('git', ['rev-parse', '--verify', 'origin/main'], repoDir);
  if (ref === undefined) return undefined;
  const diff = uitvoerVan('git', ['diff', 'origin/main...HEAD'], repoDir);
  if (diff === undefined || diff === '') return undefined;
  return diff;
}

/** Timeout van de review-run in milliseconden: 5 minuten. */
const REVIEW_TIMEOUT_MS = 5 * 60 * 1_000;

/**
 * Discriminant die de uitkomst van de review-gate onderscheidt (#586).
 *
 * Elke uitkomst heeft een eigen waarde, zodat "kon niet reviewen" en "niets
 * gevonden" nooit dezelfde tak zijn — de storing die dit type voorkomt.
 */
export type ReviewReden =
  'uit' | 'geen-diff' | 'niet-beschikbaar' | 'geen-verdict' | 'schoon' | 'bevindingen';

// Re-export zodat bestaande imports via code-review.ts blijven werken.
export type { OpsMeldingConfig } from './ops-melding.js';

export interface ReviewGateResultaat {
  /** Of de gate de inlevering laat doorgaan. */
  readonly doorgaan: boolean;
  /** Discriminant: waarom dit resultaat (#586). */
  readonly reden: ReviewReden;
  /** Het verdict als de review slaagde; undefined bij een crash of skip. */
  readonly verdict?: ReviewVerdict;
  /** Eventuele waarschuwing of fout voor de gebruiker. */
  readonly melding?: string;
}

/**
 * Leest het review-prompt-sjabloon en vervangt de diff-placeholder.
 *
 * Het sjabloon staat in `templates/code-review-gate.md`. De diff gaat als variabele
 * mee in het prompt, zodat het model niet zelf `git diff` hoeft te draaien — de gate
 * draait in een context zonder schrijfrechten.
 */
function reviewPrompt(diff: string): string {
  const sjabloonPad = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
    'code-review-gate.md',
  );
  const sjabloon = readFileSync(sjabloonPad, 'utf8');
  return sjabloon.replace('{{DIFF}}', diff);
}

/**
 * Parset de ruwe stdout van `claude -p --output-format json` naar een ReviewVerdict.
 *
 * De `claude`-CLI levert een JSON-envelop met o.a. `structured_output`. Het verdict
 * zit daarin. Is de envelop niet leesbaar, het model-antwoord niet bruikbaar, of het
 * schema ongeldig, dan is het resultaat `undefined` — de gate degradeert graceful.
 */
export function parseReviewUitvoer(stdout: string): ReviewVerdict | undefined {
  let ruw: unknown;
  try {
    ruw = JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }
  const envelop = z
    .object({
      is_error: z.boolean(),
      structured_output: z.unknown().optional(),
    })
    .safeParse(ruw);
  if (!envelop.success || envelop.data.is_error) return undefined;

  const verdict = reviewVerdictSchema.safeParse(envelop.data.structured_output);
  return verdict.success ? verdict.data : undefined;
}

/**
 * Bouwt het PR-comment op uit een review-verdict. Hetzelfde format als
 * `maakReviewComment` in `orkestreer-bouw.ts`, maar met het onderschrift
 * "Code-review gate" zodat het naast een eventuele bouw-werker-review herkenbaar is.
 */
export function maakGateComment(verdict: ReviewVerdict): string {
  if (verdict.bevindingen.length === 0) {
    return `**Code-review gate (inleveren)**\n\nGeen bevindingen.\n\n**Oordeel:** ${verdict.oordeel}`;
  }
  const tabel =
    `| Bestand | Regel | Ernst | Bevinding |\n| --- | --- | --- | --- |\n` +
    verdict.bevindingen
      .map(
        (b) =>
          `| ${b.bestand} | ${b.regel === undefined ? '—' : String(b.regel)} | ${b.ernst} | ${b.bevinding} |`,
      )
      .join('\n');
  return `**Code-review gate (inleveren)**\n\n${tabel}\n\n**Oordeel:** ${verdict.oordeel}`;
}

export type CodeReviewInstelling = 'uit' | 'waarschuw' | 'blokkeer';

/**
 * Draait de AI-code-review-gate op de huidige branch.
 *
 * Stappen:
 * 1. Pre-flight: controleer of `claude` op het pad staat en of de diff niet leeg is.
 * 2. Draai `claude -p` met het review-prompt en `--json-schema`.
 * 3. Parse het verdict en beslis op basis van de instelling (waarschuw/blokkeer).
 *
 * Bij elke onvoorziene fout (claude niet beschikbaar, crash, timeout) degradeert de
 * gate graceful: waarschuwen en doorgaan. Alleen een geldig verdict met bevindingen
 * kan een blokkade opleveren, en dat uitsluitend bij `blokkeer`.
 */
/**
 * Stuurt een ops-room-melding (#586). Delegeert naar de gedeelde `meldOps` (#606).
 */
function stuurOpsMelding(config: OpsMeldingConfig, tekst: string): void {
  meldOps(tekst, config.url, config.token);
}

export function draaiCodeReview(
  instelling: CodeReviewInstelling,
  repoDir: string,
  opsMelding?: OpsMeldingConfig,
): ReviewGateResultaat {
  kop('Code-review');

  if (instelling === 'uit') {
    ok('code-review overgeslagen (instelling: uit)');
    return { doorgaan: true, reden: 'uit' };
  }

  // Pre-flight: claude beschikbaar?
  if (!claudeBeschikbaar()) {
    waarschuwing('claude niet gevonden op het pad — code-review overgeslagen.');
    if (opsMelding !== undefined) {
      const app = opsMelding.app !== undefined ? ` (${opsMelding.app})` : '';
      stuurOpsMelding(
        opsMelding,
        `⚠ Code-review-gate kon niet draaien${app}: claude niet beschikbaar.`,
      );
    }
    return { doorgaan: true, reden: 'niet-beschikbaar', melding: 'claude niet beschikbaar' };
  }

  // Pre-flight: diff niet leeg?
  const diff = leesDiff(repoDir);
  if (diff === undefined) {
    ok('geen diff ten opzichte van origin/main — niets te reviewen.');
    return { doorgaan: true, reden: 'geen-diff' };
  }

  const prompt = reviewPrompt(diff);
  const uitkomst = run(
    'claude',
    [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(REVIEW_JSON_SCHEMA),
      '--allowedTools',
      'Read',
      'Grep',
      'Glob',
      'Bash(git diff:*)',
      'Bash(git log:*)',
      'Bash(git show:*)',
      '--effort',
      'medium',
    ],
    { cwd: repoDir, capture: true, toleranter: true, timeoutMs: REVIEW_TIMEOUT_MS },
  );

  const verdict = parseReviewUitvoer(uitkomst.stdout);
  if (verdict === undefined) {
    waarschuwing('code-review gaf geen bruikbaar verdict — doorgaan.');
    if (opsMelding !== undefined) {
      const app = opsMelding.app !== undefined ? ` (${opsMelding.app})` : '';
      stuurOpsMelding(
        opsMelding,
        `⚠ Code-review-gate kon niet draaien${app}: geen bruikbaar verdict.`,
      );
    }
    return { doorgaan: true, reden: 'geen-verdict', melding: 'geen bruikbaar verdict' };
  }

  const aantalBevindingen = verdict.bevindingen.length;
  if (aantalBevindingen === 0) {
    ok('code-review: geen bevindingen.');
    return { doorgaan: true, reden: 'schoon', verdict };
  }

  // Er zijn bevindingen. Toon ze.
  const ernstLabels = verdict.bevindingen.map((b) => b.ernst).join(', ');
  const samenvatting = `code-review: ${String(aantalBevindingen)} bevinding${aantalBevindingen === 1 ? '' : 'en'} (ernst: ${ernstLabels})`;

  if (instelling === 'blokkeer') {
    // Bij `blokkeer` stopt het inleveren hier — vóór de push.
    process.stdout.write(`\x1b[31m✗ ${samenvatting} — geblokkeerd.\x1b[0m\n`);
    for (const b of verdict.bevindingen) {
      process.stdout.write(
        `  ${b.bestand}${b.regel === undefined ? '' : `:${String(b.regel)}`} [${b.ernst}] ${b.bevinding}\n`,
      );
    }
    return {
      doorgaan: false,
      reden: 'bevindingen',
      verdict,
      melding: samenvatting,
    };
  }

  // `waarschuw`: melden en doorgaan.
  waarschuwing(samenvatting);
  for (const b of verdict.bevindingen) {
    process.stdout.write(
      `  ${b.bestand}${b.regel === undefined ? '' : `:${String(b.regel)}`} [${b.ernst}] ${b.bevinding}\n`,
    );
  }
  return { doorgaan: true, reden: 'bevindingen', verdict };
}
