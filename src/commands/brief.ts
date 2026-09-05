/**
 * `factory brief` — de regie-brief over alle apps (#404).
 *
 * Leest het board (één keer, 2 punten/pagina), het runlog, de escalatie-context
 * en de recentste deploy-run per app, en bouwt daar een beslis-gericht overzicht
 * van. Puur stdout; de levering naar de coördinatie-chat is een apart pad (R1).
 */

import { readFileSync } from 'node:fs';
import {
  appOpties,
  bordItems,
  escalaties,
  orkestratorComments,
  type BacklogItem,
} from '../board.js';
import { standaardPaden } from '../orkestrator-instellingen.js';
import { leesEscalatie } from './orkestreer.js';
import {
  bouwBrief,
  parseRunlog,
  type BriefBronnen,
  type DeployRunStatus,
  type EscalatieContext,
} from '../regie-brief.js';
import { uitvoerVan, waarschuwing } from '../shell.js';

// ---------------------------------------------------------------------------
// Deploy-run-status ophalen
// ---------------------------------------------------------------------------

/**
 * Haalt de recentste deploy-run per app op via `gh run list`.
 *
 * REST (aparte pot), 1 aanroep per app. Bij een fout: waarschuwen en overslaan,
 * de brief mag niet omvallen op een niet-bereikbare app.
 */
export function haalDeployRuns(
  apps: readonly string[],
  leesRun: (app: string) => string | undefined = ghRunList,
): DeployRunStatus[] {
  const resultaten: DeployRunStatus[] = [];
  for (const app of apps) {
    const ruw = leesRun(app);
    if (ruw === undefined || ruw === '' || ruw === '[]') continue;
    let runs: unknown;
    try {
      runs = JSON.parse(ruw) as unknown;
    } catch {
      waarschuwing(`deploy-runs van ${app} kon niet worden geparsed.`);
      continue;
    }
    if (!Array.isArray(runs) || runs.length === 0) continue;
    const eerste: unknown = runs[0];
    if (eerste === undefined || eerste === null || typeof eerste !== 'object') continue;
    const obj = eerste as Record<string, unknown>;
    resultaten.push({
      app,
      conclusion: typeof obj['conclusion'] === 'string' ? obj['conclusion'] : 'unknown',
      url: typeof obj['url'] === 'string' ? obj['url'] : '',
      createdAt: typeof obj['createdAt'] === 'string' ? obj['createdAt'] : '',
    });
  }
  return resultaten;
}

function ghRunList(app: string): string | undefined {
  return uitvoerVan('gh', [
    'run',
    'list',
    '--repo',
    `gjvv13/${app}`,
    '--workflow=deploy.yml',
    '--limit=1',
    '--json',
    'conclusion,createdAt,url',
  ]);
}

// ---------------------------------------------------------------------------
// Escalatie-context ophalen
// ---------------------------------------------------------------------------

const MARKERING = '<!-- orkestrator:';

export function haalEscalatieContext(
  geescaleerdeItems: readonly BacklogItem[],
  cwd?: string,
): EscalatieContext[] {
  const context: EscalatieContext[] = [];
  for (const item of geescaleerdeItems) {
    const comments = orkestratorComments(item.issue, MARKERING, cwd);
    // Zoek van achteren naar de laatste escalatie met vraag+advies
    for (let i = comments.length - 1; i >= 0; i -= 1) {
      const gelezen = leesEscalatie(comments[i] ?? '');
      if (gelezen !== undefined) {
        context.push({
          issue: item.issue,
          vraag: gelezen.vraag,
          advies: gelezen.advies,
        });
        break;
      }
    }
  }
  return context;
}

// ---------------------------------------------------------------------------
// Runlog lezen
// ---------------------------------------------------------------------------

function leesRunlog(logPad: string): string {
  try {
    return readFileSync(logPad, 'utf8');
  } catch {
    // Geen runlog is normaal bij een verse installatie.
    return '';
  }
}

// ---------------------------------------------------------------------------
// Het commando zelf
// ---------------------------------------------------------------------------

// De CLI kent geen Clock-abstractie; Date.now() is de tijdsbron, injecteerbaar via
// `nu` zodat de brief in tests een vast moment krijgt.
export function brief(nu: Date = new Date(Date.now())): void {
  // 1. Board lezen — één keer, 2 punten/pagina
  const items = bordItems();
  if (items === undefined) {
    waarschuwing('board kon niet worden gelezen — brief overgeslagen.');
    return;
  }

  // 2. Escalaties ophalen
  const escalatieSet = escalaties() ?? new Set<number>();
  const geescaleerd = items.filter((item) => escalatieSet.has(item.issue));
  const escalatieCtx = haalEscalatieContext(geescaleerd);

  // 3. Runlog lezen
  const paden = standaardPaden();
  const runlogInhoud = leesRunlog(paden.logPad);
  const runlogEntries = parseRunlog(runlogInhoud, nu);

  // 4. Deploy-runs per app
  const apps = appOpties() ?? [];
  const deployRuns = haalDeployRuns(apps);

  // 5. Brief bouwen en tonen
  const bronnen: BriefBronnen = {
    items,
    escalatieNummers: escalatieSet,
    escalatieContext: escalatieCtx,
    runlog: runlogEntries,
    deployRuns,
    nu,
  };
  const tekst = bouwBrief(bronnen);
  process.stdout.write(`${tekst}\n`);
}
