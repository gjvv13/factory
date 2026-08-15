import { existsSync } from 'node:fs';
import path from 'node:path';
import { leesAppConfig, zoekAppDir } from '../app-config.js';
import { BASISLIJN_BESTAND } from '../dekking-basislijn.js';
import { GebruikersFout, git, kop, ok, pakketbeheerder, run, uitvoerVan } from '../shell.js';
import { WACHTRIJ_LABEL, zorgVoorWachtrijLabel } from './integreer.js';
import { verify } from './verify.js';

export interface InleverenOpties {
  /** Titel voor de PR; zonder dit vult gh de titel uit de commits (`--fill`). */
  readonly titel?: string;
}

/** Committeert een gewijzigd bestand met een korte melding; slaat over als het niet wijzigde. */
function commitAlsGewijzigd(repoDir: string, bestand: string, melding: string): boolean {
  if (!existsSync(path.join(repoDir, bestand))) {
    return false;
  }
  if (uitvoerVan('git', ['status', '--porcelain', bestand], repoDir) === '') {
    return false;
  }
  git(['add', bestand], repoDir);
  git(['commit', '-q', '-m', melding], repoDir);
  return true;
}

/** De URL van de bestaande PR voor deze branch, of undefined als er nog geen is. */
function bestaandePr(repoDir: string, branch: string): string | undefined {
  const url = uitvoerVan('gh', ['pr', 'view', branch, '--json', 'url', '--jq', '.url'], repoDir);
  return url === undefined || url === '' ? undefined : url;
}

/**
 * Levert de huidige slice-branch in: lockfile in lijn brengen, de poort draaien,
 * de branch pushen, een PR naar main openen en die in de merge-queue zetten. De
 * queue integreert branches daarna serieel en conflictvrij naar main, dus de sessie
 * kan meteen aan de volgende slice beginnen.
 */
export function inleveren(opties: InleverenOpties = {}): void {
  const repoDir = process.cwd();

  const branch = uitvoerVan('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoDir);
  if (branch === undefined || branch === 'main') {
    throw new GebruikersFout(
      `Inleveren doe je vanaf een slice-branch, niet vanaf '${branch ?? '?'}'.`,
    );
  }

  if (uitvoerVan('git', ['status', '--porcelain'], repoDir) !== '') {
    git(['status', '--short'], repoDir);
    throw new GebruikersFout('Werkmap is niet schoon. Commit je wijzigingen eerst.');
  }

  // Lockfile in lijn met package.json brengen zodat de merge-queue er niet op
  // struikelt (`--frozen-lockfile`). `--lockfile-only`: alleen de lockfile, geen
  // volledige install van node_modules.
  kop('Lockfile bijwerken');
  const { commando, basisArgumenten } = pakketbeheerder();
  run(commando, [...basisArgumenten, 'install', '--lockfile-only'], {
    cwd: repoDir,
    capture: true,
  });
  ok(
    commitAlsGewijzigd(repoDir, 'pnpm-lock.yaml', 'sync lockfile voor inleveren')
      ? 'lockfile bijgewerkt en gecommit'
      : 'lockfile al in lijn',
  );

  kop('Kwaliteitspoort');
  verify();
  // De volledige verify kan de dekkings-basislijn hebben verhoogd; commit die mee,
  // zodat de branch schoon blijft en de verhoogde lat met de PR meereist.
  commitAlsGewijzigd(repoDir, BASISLIJN_BESTAND, 'verhoog dekking-basislijn');

  kop('Branch pushen');
  git(['push', '-q', '-u', 'origin', branch], repoDir);
  ok(`${branch} gepusht`);

  const lokaal = gebruiktLokaleWachtrij(repoDir);
  kop(lokaal ? 'PR openen en in de wachtrij zetten' : 'PR openen en in de merge-queue zetten');
  const titelArgumenten =
    opties.titel === undefined
      ? ['--fill']
      : ['--title', opties.titel, '--body', 'Ingeleverd via `factory inleveren`.'];
  const prUrl =
    bestaandePr(repoDir, branch) ??
    uitvoerVan(
      'gh',
      ['pr', 'create', '--base', 'main', '--head', branch, ...titelArgumenten],
      repoDir,
    );
  if (prUrl === undefined || prUrl === '') {
    throw new GebruikersFout('Kon geen PR aanmaken of vinden met gh.');
  }

  if (lokaal) {
    // Factory-eigen wachtrij: label de PR. `factory integreer` op de mini werkt de rij
    // serieel af (voor private apps waar de GitHub merge-queue niet beschikbaar is).
    zorgVoorWachtrijLabel(repoDir);
    run('gh', ['pr', 'edit', prUrl, '--add-label', WACHTRIJ_LABEL], { cwd: repoDir });
    ok(`in de wachtrij gezet: ${prUrl}`);
    process.stdout.write(
      `\nDe factory-wachtrij integreert ${branch} serieel naar main. Je kunt doorbouwen.\n`,
    );
    return;
  }

  // Auto-merge aanzetten: met een ingeschakelde merge-queue plaatst dit de PR in de
  // wachtrij zodra de checks groen zijn. De queue merget serieel naar main.
  run('gh', ['pr', 'merge', prUrl, '--auto', '--merge'], { cwd: repoDir });
  ok(`ingeleverd: ${prUrl}`);
  process.stdout.write(
    `\nDe merge-queue integreert ${branch} serieel naar main. Je kunt doorbouwen.\n`,
  );
}

/** Of deze repo de factory-eigen wachtrij gebruikt (`factory.json`: `integratie: lokaal`). */
function gebruiktLokaleWachtrij(repoDir: string): boolean {
  const appDir = zoekAppDir(repoDir);
  return appDir !== undefined && leesAppConfig(appDir).integratie === 'lokaal';
}
