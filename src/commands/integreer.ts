import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vereisAppConfig, type AppConfig } from '../app-config.js';
import { GebruikersFout, kop, ok, run, uitvoerVan, waarschuwing } from '../shell.js';

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

function wachtrij(repoDir: string, repoArg: readonly string[]): WachtrijItem[] {
  const uit = uitvoerVan(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'open',
      '--label',
      WACHTRIJ_LABEL,
      '--json',
      'number,createdAt',
      ...repoArg,
    ],
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

function statusVan(repoDir: string, nummer: number, repoArg: readonly string[]): PrStatus {
  const uit = uitvoerVan(
    'gh',
    ['pr', 'view', String(nummer), '--json', 'mergeable,statusCheckRollup', ...repoArg],
    repoDir,
  );
  const data = JSON.parse(uit ?? '{}') as {
    mergeable?: string;
    statusCheckRollup?: { status?: string; conclusion?: string }[];
  };
  return { mergeable: data.mergeable ?? 'UNKNOWN', checks: data.statusCheckRollup ?? [] };
}

function kickBack(
  repoDir: string,
  nummer: number,
  reden: string,
  repoArg: readonly string[],
): void {
  run(
    'gh',
    [
      'pr',
      'comment',
      String(nummer),
      '--body',
      `Integratie gestopt: ${reden}. Uit de wachtrij gehaald — los op en lever opnieuw in met \`factory inleveren\`.`,
      ...repoArg,
    ],
    { cwd: repoDir, toleranter: true },
  );
  run('gh', ['pr', 'edit', String(nummer), '--remove-label', WACHTRIJ_LABEL, ...repoArg], {
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
function verwerkOudste(repoDir: string, nummer: number, repoArg: readonly string[]): Uitkomst {
  const { mergeable, checks } = statusVan(repoDir, nummer, repoArg);
  const gefaald = checks.some(
    (c) =>
      c.conclusion === 'FAILURE' ||
      c.conclusion === 'CANCELLED' ||
      c.conclusion === 'TIMED_OUT' ||
      c.conclusion === 'ACTION_REQUIRED',
  );
  const draaitNog = checks.some((c) => c.status !== 'COMPLETED');

  if (gefaald) {
    kickBack(repoDir, nummer, 'de kwaliteitspoort (CI) is rood', repoArg);
    return 'kickback';
  }
  if (mergeable === 'CONFLICTING') {
    kickBack(repoDir, nummer, 'merge-conflict met main', repoArg);
    return 'kickback';
  }
  if (draaitNog || mergeable === 'UNKNOWN') {
    return 'wacht';
  }

  // Groen + mergeable → mergen met een merge-commit (zoals de rest van het ecosysteem).
  const merge = run('gh', ['pr', 'merge', String(nummer), '--merge', ...repoArg], {
    cwd: repoDir,
    capture: true,
    toleranter: true,
  });
  if (merge.code !== 0) {
    kickBack(repoDir, nummer, 'de merge mislukte', repoArg);
    return 'kickback';
  }
  ok(`#${String(nummer)} geïntegreerd`);
  return 'gemerged';
}

// --- LaunchAgent: `integreer` periodiek draaien op de mini --------------------
const LAUNCH_PREFIX = 'nl.factory.integreer';
/** Hoe vaak (in seconden) de wachtrij wordt afgetikt. */
const INTERVAL_S = 60;

function plistPad(naam: string): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCH_PREFIX}.${naam}.plist`);
}

export interface PlistOpzet {
  readonly naam: string;
  /** Absoluut pad naar de globaal geïnstalleerde factory-bin (buiten ~/Documents). */
  readonly bin: string;
  /** `<owner>/<naam>` waar `gh` op wordt gericht. */
  readonly repo: string;
  /** TCC-vrije werkmap (bijv. de home-map). */
  readonly werkmap: string;
  /** TCC-vrij logpad. */
  readonly logPad: string;
}

/**
 * Bouwt de LaunchAgent-plist die `factory integreer --repo <repo>` periodiek draait.
 * Alles wijst buiten `~/Documents` (globale bin, home als werkmap, log in ~/Library/Logs),
 * zodat macOS TCC de launchd-agent niet blokkeert.
 */
export function bouwPlist(opzet: PlistOpzet): string {
  const label = `${LAUNCH_PREFIX}.${opzet.naam}`;
  // De PATH van de installerende shell meebakken: launchd start anders met een kale
  // PATH en vindt node/gh dan niet.
  const pad = process.env.PATH ?? '/usr/bin:/bin';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opzet.bin}</string>
    <string>integreer</string>
    <string>--repo=${opzet.repo}</string>
  </array>
  <key>WorkingDirectory</key><string>${opzet.werkmap}</string>
  <key>StartInterval</key><integer>${String(INTERVAL_S)}</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${pad}</string></dict>
  <key>StandardOutPath</key><string>${opzet.logPad}</string>
  <key>StandardErrorPath</key><string>${opzet.logPad}</string>
</dict>
</plist>
`;
}

/** `<owner>/<naam>` van de repo, uit de git-remote (via gh). */
function repoVan(repoDir: string): string {
  const nwo = uitvoerVan(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    repoDir,
  );
  if (nwo === undefined || nwo === '') {
    throw new GebruikersFout('Kon de GitHub-repo (owner/naam) niet bepalen met gh.');
  }
  return nwo;
}

/** De factory-devDependency (git-url + tag) uit de app-package.json, voor de globale install. */
function factoryDep(appDir: string): string {
  const inhoud: unknown = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const dep =
    typeof inhoud === 'object' && inhoud !== null && 'devDependencies' in inhoud
      ? (inhoud as { devDependencies?: Record<string, string> }).devDependencies?.factory
      : undefined;
  if (dep === undefined || dep === '') {
    throw new GebruikersFout('Geen factory-dependency in package.json gevonden.');
  }
  return dep;
}

/**
 * Zet de factory-git-dep (`git+https://…/factory.git#vX.Y.Z`) om in een codeload-
 * tarball-URL + kale versie. We installeren globaal via de tarball en niet via de
 * git-URL: `npm install -g git+https` symlinkt op npm 10 naar een cache-tmp die
 * daarna wordt opgeruimd (dood symlink, geen werkende bin); de tarball kopieert wél.
 */
export function tarballVanDep(dep: string): { url: string; versie: string } {
  const m = dep.match(/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?#(.+)$/);
  const owner = m?.[1];
  const repo = m?.[2];
  const ref = m?.[3];
  if (owner === undefined || repo === undefined || ref === undefined) {
    throw new GebruikersFout(`Kan de factory-tarball niet afleiden uit '${dep}'.`);
  }
  return {
    url: `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/tags/${ref}`,
    versie: ref.replace(/^v/, ''),
  };
}

/** `a >= b`, per numeriek versie-onderdeel (vX.Y.Z). */
export function minstensVersie(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** Versie van de globaal geïnstalleerde factory, of undefined als er geen (werkende) staat. */
function globaleFactoryVersie(): string | undefined {
  const root = uitvoerVan('npm', ['root', '-g']);
  if (root === undefined || root === '') return undefined;
  try {
    const pj: unknown = JSON.parse(
      readFileSync(path.join(root, 'factory', 'package.json'), 'utf8'),
    );
    return typeof pj === 'object' && pj !== null && 'version' in pj
      ? String((pj as { version?: unknown }).version)
      : undefined;
  } catch {
    return undefined;
  }
}

function installeerLaunchAgent(config: AppConfig): void {
  kop(`LaunchAgent installeren voor ${config.naam}`);
  const repo = repoVan(config.appDir);
  const dep = factoryDep(config.appDir);

  // De LaunchAgent draait buiten ~/Documents (macOS TCC), dus factory globaal
  // installeren; bin én dist liggen dan buiten die map. Upgrade-only: staat er al
  // een even nieuwe (of nieuwere) globale factory, dan slaan we de install over —
  // zo downgradet een app met een oudere pin de gedeelde bin nooit.
  kop('Factory globaal installeren');
  const { url, versie } = tarballVanDep(dep);
  const globaal = globaleFactoryVersie();
  if (globaal !== undefined && minstensVersie(globaal, versie)) {
    ok(`factory ${globaal} staat al globaal (≥ ${versie}); install overgeslagen.`);
  } else {
    run('npm', ['install', '-g', url], { capture: true });
  }
  const prefix = uitvoerVan('npm', ['prefix', '-g'], config.appDir) ?? '/usr/local';
  const bin = path.join(prefix, 'bin', 'factory');

  const logMap = path.join(os.homedir(), 'Library', 'Logs');
  mkdirSync(logMap, { recursive: true });
  const logPad = path.join(logMap, `${LAUNCH_PREFIX}.${config.naam}.log`);

  const pad = plistPad(config.naam);
  mkdirSync(path.dirname(pad), { recursive: true });
  writeFileSync(pad, bouwPlist({ naam: config.naam, bin, repo, werkmap: os.homedir(), logPad }));
  // Idempotent: een oude versie eerst ontladen, dan vers laden.
  run('launchctl', ['unload', pad], { toleranter: true, capture: true });
  run('launchctl', ['load', pad]);
  ok(
    `geladen; \`factory integreer --repo ${repo}\` draait elke ${String(INTERVAL_S)}s (log: ${logPad}).`,
  );
}

function verwijderLaunchAgent(config: AppConfig): void {
  kop(`LaunchAgent verwijderen voor ${config.naam}`);
  const pad = plistPad(config.naam);
  run('launchctl', ['unload', pad], { toleranter: true, capture: true });
  rmSync(pad, { force: true });
  ok('verwijderd.');
}

export interface IntegreerOpties {
  /** Installeert de LaunchAgent die `integreer` periodiek draait. */
  readonly installeer?: boolean;
  /** Verwijdert die LaunchAgent. */
  readonly verwijder?: boolean;
  /**
   * Richt `gh` op deze `<owner>/<naam>` i.p.v. de git-remote van de huidige map. Zo
   * draait de drain zonder de repo-map te lezen — nodig om de LaunchAgent buiten
   * `~/Documents` (macOS TCC) te kunnen draaien.
   */
  readonly repo?: string;
}

/**
 * Werkt de factory-wachtrij af: neemt de oudste open `wachtrij`-PR, toetst hem via de
 * CI-poort en merget of koppelt terug — serieel, één tegelijk (mini-lock). Draait op
 * de mini; raakt de werkmap niet aan, alleen GitHub via `gh`. Met `--installeer` /
 * `--verwijder` zet je de LaunchAgent op of weg die dit periodiek doet.
 */
export function integreer(opties: IntegreerOpties = {}): void {
  if (opties.installeer === true) {
    installeerLaunchAgent(vereisAppConfig());
    return;
  }
  if (opties.verwijder === true) {
    verwijderLaunchAgent(vereisAppConfig());
    return;
  }

  const repoDir = process.cwd();
  // Met --repo richten we gh expliciet en lezen we de repo-map niet (TCC-vrij); zonder
  // --repo gebruikt gh de git-remote van de huidige map.
  const repoArg: string[] = opties.repo === undefined ? [] : ['--repo', opties.repo];
  if (!neemLock()) {
    waarschuwing('Er draait al een integreer-run; deze wordt overgeslagen.');
    return;
  }
  try {
    kop('Wachtrij verwerken');
    const gezien = new Set<number>();
    for (;;) {
      const rij = wachtrij(repoDir, repoArg);
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

      if (verwerkOudste(repoDir, oudste.nummer, repoArg) === 'wacht') {
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
