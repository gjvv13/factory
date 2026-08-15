import { closeSync, openSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kop, ok, run, uitvoerVan, waarschuwing } from '../shell.js';

/** Het label waaraan de factory-wachtrij een in te leveren PR herkent. */
export const WACHTRIJ_LABEL = 'wachtrij';

/** Maakt het `wachtrij`-label aan als het nog niet bestaat (idempotent, faalt niet als het er al is). */
export function zorgVoorWachtrijLabel(repoDir: string): void {
  run(
    'gh',
    [
      'label',
      'create',
      WACHTRIJ_LABEL,
      '--description',
      'Factory-integratiewachtrij',
      '--color',
      'FBCA04',
    ],
    { cwd: repoDir, capture: true, toleranter: true },
  );
}

// --- Lock: één integreer-run tegelijk op de mini ------------------------------
const LOCK_PAD = path.join(os.tmpdir(), 'factory-integreer.lock');
// Een verweesd slot (bijv. na een crash) na een uur opruimen, zodat de rij nooit
// permanent vaststaat.
const LOCK_VERVALT_MS = 60 * 60 * 1000;

function neemLock(): boolean {
  try {
    if (Date.now() - statSync(LOCK_PAD).mtimeMs > LOCK_VERVALT_MS) {
      rmSync(LOCK_PAD);
    }
  } catch {
    // Geen bestaand slot — prima.
  }
  try {
    // `wx` is atomair: faalt als het bestand al bestaat, dus twee runs racen niet.
    closeSync(openSync(LOCK_PAD, 'wx'));
    return true;
  } catch {
    return false;
  }
}

function geefLockVrij(): void {
  try {
    rmSync(LOCK_PAD);
  } catch {
    // Al weg — prima.
  }
}

// --- De wachtrij (open PR's met het label, oudste eerst) ----------------------
interface WachtrijItem {
  readonly nummer: number;
  readonly createdAt: string;
}

function wachtrij(repoDir: string): WachtrijItem[] {
  const uit = uitvoerVan(
    'gh',
    ['pr', 'list', '--state', 'open', '--label', WACHTRIJ_LABEL, '--json', 'number,createdAt'],
    repoDir,
  );
  if (uit === undefined || uit === '') {
    return [];
  }
  const rijen = JSON.parse(uit) as { number: number; createdAt: string }[];
  return rijen
    .map((r) => ({ nummer: r.number, createdAt: r.createdAt }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

type Uitkomst = 'gemerged' | 'kickback' | 'wacht';

interface PrStatus {
  readonly mergeable: string;
  readonly checks: readonly { readonly status?: string; readonly conclusion?: string }[];
}

function statusVan(repoDir: string, nummer: number): PrStatus {
  const uit = uitvoerVan(
    'gh',
    ['pr', 'view', String(nummer), '--json', 'mergeable,statusCheckRollup'],
    repoDir,
  );
  const data = JSON.parse(uit ?? '{}') as {
    mergeable?: string;
    statusCheckRollup?: { status?: string; conclusion?: string }[];
  };
  return { mergeable: data.mergeable ?? 'UNKNOWN', checks: data.statusCheckRollup ?? [] };
}

function kickBack(repoDir: string, nummer: number, reden: string): void {
  run(
    'gh',
    [
      'pr',
      'comment',
      String(nummer),
      '--body',
      `Integratie gestopt: ${reden}. Uit de wachtrij gehaald — los op en lever opnieuw in met \`factory inleveren\`.`,
    ],
    { cwd: repoDir, toleranter: true },
  );
  run('gh', ['pr', 'edit', String(nummer), '--remove-label', WACHTRIJ_LABEL], {
    cwd: repoDir,
    toleranter: true,
  });
  waarschuwing(`#${String(nummer)} teruggekoppeld: ${reden}`);
}

/**
 * Beoordeelt de oudste PR via de bestaande CI-poort. Groen + mergeable → serieel
 * mergen. Rood of een merge-conflict → kick-back (uit de rij, met uitleg). Poort nog
 * bezig → wachten tot de volgende run (we lopen niet vooruit op de FIFO-volgorde).
 */
function verwerkOudste(repoDir: string, nummer: number): Uitkomst {
  const { mergeable, checks } = statusVan(repoDir, nummer);
  const gefaald = checks.some(
    (c) =>
      c.conclusion === 'FAILURE' ||
      c.conclusion === 'CANCELLED' ||
      c.conclusion === 'TIMED_OUT' ||
      c.conclusion === 'ACTION_REQUIRED',
  );
  const draaitNog = checks.some((c) => c.status !== 'COMPLETED');

  if (gefaald) {
    kickBack(repoDir, nummer, 'de kwaliteitspoort (CI) is rood');
    return 'kickback';
  }
  if (mergeable === 'CONFLICTING') {
    kickBack(repoDir, nummer, 'merge-conflict met main');
    return 'kickback';
  }
  if (draaitNog || mergeable === 'UNKNOWN') {
    return 'wacht';
  }

  // Groen + mergeable → mergen met een merge-commit (zoals de rest van het ecosysteem).
  const merge = run('gh', ['pr', 'merge', String(nummer), '--merge'], {
    cwd: repoDir,
    capture: true,
    toleranter: true,
  });
  if (merge.code !== 0) {
    kickBack(repoDir, nummer, 'de merge mislukte');
    return 'kickback';
  }
  ok(`#${String(nummer)} geïntegreerd`);
  return 'gemerged';
}

/**
 * Werkt de factory-wachtrij af: neemt de oudste open `wachtrij`-PR, toetst hem via de
 * CI-poort en merget of koppelt terug — serieel, één tegelijk (mini-lock). Draait op
 * de mini; raakt de werkmap niet aan, alleen GitHub via `gh`.
 */
export function integreer(): void {
  const repoDir = process.cwd();
  if (!neemLock()) {
    waarschuwing('Er draait al een integreer-run; deze wordt overgeslagen.');
    return;
  }
  try {
    kop('Wachtrij verwerken');
    const gezien = new Set<number>();
    for (;;) {
      const rij = wachtrij(repoDir);
      const oudste = rij[0];
      if (oudste === undefined) {
        ok('Wachtrij is leeg.');
        break;
      }
      // Vangnet tegen een lus: bleef de oudste na verwerking toch staan, dan stoppen.
      if (gezien.has(oudste.nummer)) {
        waarschuwing(`#${String(oudste.nummer)} bleef in de wachtrij; gestopt.`);
        break;
      }
      gezien.add(oudste.nummer);

      if (verwerkOudste(repoDir, oudste.nummer) === 'wacht') {
        ok(
          `#${String(oudste.nummer)}: poort draait nog — de wachtrij pauzeert tot de volgende run.`,
        );
        break;
      }
      // gemerged of kickback → PR is uit de rij; de volgende iteratie pakt de nieuwe oudste.
    }
  } finally {
    geefLockVrij();
  }
}
