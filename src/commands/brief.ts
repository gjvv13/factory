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
  type OpenPr,
} from '../regie-brief.js';
import { uitvoerVan, waarschuwing } from '../shell.js';

// ---------------------------------------------------------------------------
// Deploy-run-status ophalen
// ---------------------------------------------------------------------------

/**
 * Namen die in de deploy-lijst kunnen opduiken maar geen echte app zijn
 * (proefapp = wegwerp-testapp uit een afgeronde proef); ze horen niet in de
 * brief. Het register telt vijf echte apps — zie [[app-register-vijf-apps]].
 */
const GEEN_ECHTE_APPS: ReadonlySet<string> = new Set(['proefapp']);

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
    if (GEEN_ECHTE_APPS.has(app)) continue;
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
    const rawConclusion = typeof obj['conclusion'] === 'string' ? obj['conclusion'] : 'unknown';
    resultaten.push({
      app,
      conclusion: rawConclusion === '' ? 'unknown' : rawConclusion,
      status: typeof obj['status'] === 'string' ? obj['status'] : 'unknown',
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
    'conclusion,createdAt,status,url',
  ]);
}

// ---------------------------------------------------------------------------
// Open bouw-PR's ophalen (#558)
// ---------------------------------------------------------------------------

/**
 * Haalt de open bouw-PR's (slice-branches) per app op via `gh pr list`.
 *
 * REST (aparte pot), 1 aanroep per app — zelfde patroon als `haalDeployRuns`. Bij
 * een fout: waarschuwen en overslaan, de brief mag niet omvallen op één app. Alleen
 * `slice/*`-branches tellen: release-PR's en losse PR's horen niet in het
 * leeftijdssignaal. `proefapp` valt af (geen echte app); factory hoort er wél in —
 * dat is juist de repo waar bouw-PR's stapelen (#558).
 */
export function haalOpenBouwPrs(
  apps: readonly string[],
  leesPrs: (app: string) => string | undefined = ghPrList,
): OpenPr[] {
  const resultaten: OpenPr[] = [];
  for (const app of apps) {
    if (GEEN_ECHTE_APPS.has(app)) continue;
    const ruw = leesPrs(app);
    if (ruw === undefined || ruw === '' || ruw === '[]') continue;
    let prs: unknown;
    try {
      prs = JSON.parse(ruw) as unknown;
    } catch {
      waarschuwing(`open PR's van ${app} konden niet worden geparsed.`);
      continue;
    }
    if (!Array.isArray(prs)) continue;
    for (const p of prs) {
      if (p === null || typeof p !== 'object') continue;
      const obj = p as Record<string, unknown>;
      const branch = typeof obj['headRefName'] === 'string' ? obj['headRefName'] : '';
      const aangemaakt = typeof obj['createdAt'] === 'string' ? obj['createdAt'] : '';
      const nummer = typeof obj['number'] === 'number' ? obj['number'] : undefined;
      // Alleen bouw-PR's (slice-branches); een release-PR of losse PR telt niet.
      if (nummer === undefined || aangemaakt === '' || !branch.startsWith('slice/')) continue;
      resultaten.push({ nummer, branch, app, aangemaakt });
    }
  }
  return resultaten;
}

function ghPrList(app: string): string | undefined {
  return uitvoerVan('gh', [
    'pr',
    'list',
    '--repo',
    `gjvv13/${app}`,
    '--state',
    'open',
    '--json',
    'number,headRefName,createdAt',
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

  // 4. Deploy-runs + open bouw-PR's per app
  const apps = appOpties() ?? [];
  const deployRuns = haalDeployRuns(apps);
  const openPrs = haalOpenBouwPrs(apps);

  // 5. Brief bouwen en tonen
  const bronnen: BriefBronnen = {
    items,
    escalatieNummers: escalatieSet,
    escalatieContext: escalatieCtx,
    runlog: runlogEntries,
    deployRuns,
    openPrs,
    nu,
  };
  const tekst = bouwBrief(bronnen);
  process.stdout.write(`${tekst}\n`);
}
