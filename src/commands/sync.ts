import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { leesAppConfig, zoekAppDir } from '../app-config.js';
import {
  agentsDir,
  claudeCommandsDir,
  factoryPakketDir,
  hooksDir,
  skillsDir,
  syncBestanden,
  workflowsDir,
} from '../paths.js';
import { GebruikersFout, git, kop, ok, waarschuwing } from '../shell.js';

/** Of de app-versie gelijk is aan de factory, ervan afwijkt, of overbodig is. */
export type SyncStatus = 'gelijk' | 'afwijkend' | 'overbodig';

export interface SyncVerschil {
  /** Pad relatief aan de app-map, bv. `.claude/commands/bouw.md`. */
  readonly pad: string;
  readonly status: SyncStatus;
}

/**
 * Een spiegel: een bronmap in de factory en de plek in de app-repo waar hij
 * gelijk aan moet staan. De factory bezit deze plekken volledig, dus een bestand
 * dat hier in de app staat maar niet in de factory, is drift.
 */
function syncSpiegels(): { bronDir: string; doelBasis: string }[] {
  return [
    { bronDir: claudeCommandsDir, doelBasis: path.join('.claude', 'commands') },
    { bronDir: skillsDir, doelBasis: path.join('.claude', 'skills') },
    { bronDir: workflowsDir, doelBasis: path.join('.github', 'workflows') },
    { bronDir: hooksDir, doelBasis: '.githooks' },
    { bronDir: agentsDir, doelBasis: path.join('.claude', 'agents') },
  ];
}

/** Alle bestandspaden onder een map, relatief aan die map. Leeg als de map ontbreekt. */
function bestandenOnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const gevonden: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      for (const sub of bestandenOnder(path.join(dir, item.name))) {
        gevonden.push(path.join(item.name, sub));
      }
    } else {
      gevonden.push(item.name);
    }
  }
  return gevonden;
}

function kopieerAlsAnders(bron: string, doel: string): boolean {
  if (existsSync(doel) && readFileSync(bron, 'utf8') === readFileSync(doel, 'utf8')) {
    return false;
  }
  mkdirSync(path.dirname(doel), { recursive: true });
  copyFileSync(bron, doel);
  return true;
}

/**
 * Bepaalt per bestand of de app gelijk is aan de factory, ervan afwijkt of een
 * overbodig bestand heeft — zónder iets te schrijven. Paden in `negeer` (relatief
 * aan de app-map) tellen niet mee, zodat een bewuste afwijking geen valse drift is.
 */
export function syncVerschillen(appDir: string, negeer: readonly string[] = []): SyncVerschil[] {
  const genegeerd = (pad: string): boolean =>
    negeer.some((n) => pad === n || pad.startsWith(`${n}${path.sep}`));

  const verschillen: SyncVerschil[] = [];
  for (const { bronDir, doelBasis } of syncSpiegels()) {
    const bronBestanden = bestandenOnder(bronDir);
    const bronSet = new Set(bronBestanden);

    // Factory → app: elk factory-bestand is gelijk of wijkt af (ontbrekend telt als afwijkend).
    for (const rel of bronBestanden) {
      const pad = path.join(doelBasis, rel);
      if (genegeerd(pad)) continue;
      const doel = path.join(appDir, pad);
      const gelijk =
        existsSync(doel) &&
        readFileSync(path.join(bronDir, rel), 'utf8') === readFileSync(doel, 'utf8');
      verschillen.push({ pad, status: gelijk ? 'gelijk' : 'afwijkend' });
    }

    // App → factory: een bestand op deze plek dat de factory niet (meer) kent, is overbodig.
    for (const rel of bestandenOnder(path.join(appDir, doelBasis))) {
      if (bronSet.has(rel)) continue;
      const pad = path.join(doelBasis, rel);
      if (genegeerd(pad)) continue;
      verschillen.push({ pad, status: 'overbodig' });
    }
  }

  // Losse bestandskopieën: 1:1-bestanden zonder overbodig-vraag.
  for (const { bron, doel } of syncBestanden) {
    if (genegeerd(doel)) continue;
    const bronPad = path.join(factoryPakketDir, bron);
    const doelPad = path.join(appDir, doel);
    const gelijk =
      existsSync(doelPad) && readFileSync(bronPad, 'utf8') === readFileSync(doelPad, 'utf8');
    verschillen.push({ pad: doel, status: gelijk ? 'gelijk' : 'afwijkend' });
  }

  return verschillen;
}

/** Bestanden waarin `factory sync` oude `'factory/…'`-importpaden herschrijft naar `'@gjvv13/factory/…'`. */
const IMPORTPAD_BESTANDEN = [
  'eslint.config.js',
  'vitest.unit.config.ts',
  'vitest.contract.config.ts',
  'vitest.e2e.config.ts',
  'vitest.pact-verify.config.ts',
  'tsconfig.json',
  'tsconfig.build.json',
  '.prettierrc.json',
  path.join('app', 'test', 'e2e', 'global-setup.ts'),
];

/**
 * Herschrijft oude `factory/…`-importpaden naar `@gjvv13/factory/…` in de bekende
 * configuratiebestanden. Idempotent: al-herschreven paden worden niet geraakt.
 * Geeft de lijst van bijgewerkte bestanden terug (relatieve paden).
 */
export function herschrijfImportpaden(appDir: string): string[] {
  const bijgewerkt: string[] = [];
  // Patroon: 'factory/ of "factory/ aan het begin van een woord, maar niet als er
  // al @gjvv13/ voor staat. Werkt voor ES-import, JSON-extends en prettierrc-string.
  const patroon = /(?<=['"])factory\//g;
  for (const rel of IMPORTPAD_BESTANDEN) {
    const volledig = path.join(appDir, rel);
    if (!existsSync(volledig)) continue;
    const oud = readFileSync(volledig, 'utf8');
    const nieuw = oud.replace(patroon, '@gjvv13/factory/');
    if (nieuw !== oud) {
      writeFileSync(volledig, nieuw);
      bijgewerkt.push(rel);
    }
  }
  return bijgewerkt;
}

/**
 * Zet de bestanden die de factory aanlevert maar die in de app-repo moeten staan
 * gelijk aan de versie uit het pakket: de slash commands, de skills, de git hook
 * en de CI-workflow. Deze kunnen niet uit node_modules komen omdat Claude Code,
 * git en GitHub Actions ze op een vaste plek in de repo verwachten.
 */
export function syncNaarApp(appDir: string, negeer: readonly string[] = []): string[] {
  const genegeerd = (pad: string): boolean =>
    negeer.some((n) => pad === n || pad.startsWith(`${n}${path.sep}`));

  const bijgewerkt: string[] = [];
  for (const { bronDir, doelBasis } of syncSpiegels()) {
    const bronBestanden = new Set(bestandenOnder(bronDir));

    // Factory → app: kopiëren of bijwerken.
    for (const rel of bronBestanden) {
      if (kopieerAlsAnders(path.join(bronDir, rel), path.join(appDir, doelBasis, rel))) {
        bijgewerkt.push(path.join(doelBasis, rel));
      }
    }

    // App → factory: een bestand dat de factory niet (meer) kent, verwijderen.
    for (const rel of bestandenOnder(path.join(appDir, doelBasis))) {
      if (bronBestanden.has(rel)) continue;
      const pad = path.join(doelBasis, rel);
      if (genegeerd(pad)) continue;
      rmSync(path.join(appDir, pad));
      bijgewerkt.push(pad);
    }
  }

  // Losse bestandskopieën — hier geen verwijdering: ze worden 1:1 gekopieerd,
  // niet gespiegeld.
  for (const { bron, doel } of syncBestanden) {
    if (kopieerAlsAnders(path.join(factoryPakketDir, bron), path.join(appDir, doel))) {
      bijgewerkt.push(doel);
    }
  }

  // Herschrijf oude factory-importpaden naar de scoped naam.
  bijgewerkt.push(...herschrijfImportpaden(appDir));

  // De hook moet uitvoerbaar zijn en git moet hem via .githooks vinden.
  chmodSync(path.join(appDir, '.githooks', 'pre-commit'), 0o755);
  git(['config', 'core.hooksPath', '.githooks'], appDir);

  return bijgewerkt;
}

export interface SyncOpties {
  /** Alleen controleren en bij drift met een niet-nul exit eindigen; niets schrijven. */
  readonly check?: boolean;
}

function tekenVoor(status: SyncStatus): string {
  switch (status) {
    case 'gelijk':
      return '\x1b[32m  ✓';
    case 'afwijkend':
      return '\x1b[31m  ✗';
    case 'overbodig':
      return '\x1b[31m  ✗';
  }
}

function omschrijving(verschil: SyncVerschil): string {
  switch (verschil.status) {
    case 'gelijk':
      return verschil.pad;
    case 'afwijkend':
      return `${verschil.pad} wijkt af`;
    case 'overbodig':
      return `${verschil.pad} staat in de app maar niet in de factory`;
  }
}

function controleer(appDir: string): void {
  kop('Controleren of de app gelijk is aan de factory');
  const negeer = leesAppConfig(appDir).syncNegeer ?? [];
  const verschillen = syncVerschillen(appDir, negeer);
  const drift = verschillen.filter((verschil) => verschil.status !== 'gelijk');

  if (drift.length === 0) {
    ok('alles gelijk');
    return;
  }

  for (const verschil of verschillen) {
    process.stdout.write(`${tekenVoor(verschil.status)} ${omschrijving(verschil)}\x1b[0m\n`);
  }
  throw new GebruikersFout(
    `${String(drift.length)} verschil(len) — draai \`factory sync\` om gelijk te trekken`,
  );
}

export function sync(opties: SyncOpties = {}): void {
  const appDir = zoekAppDir();
  if (appDir === undefined) {
    throw new GebruikersFout('factory sync hoort in een applicatiemap te draaien.');
  }

  if (opties.check === true) {
    controleer(appDir);
    return;
  }

  kop('Slash commands, skills, git hook en CI-workflow gelijkzetten');
  const negeer = leesAppConfig(appDir).syncNegeer ?? [];
  const bijgewerkt = syncNaarApp(appDir, negeer);

  if (bijgewerkt.length === 0) {
    waarschuwing('Niets te doen: alles staat al gelijk aan de factory.');
    return;
  }
  for (const bestand of bijgewerkt) {
    process.stdout.write(`  bijgewerkt: ${bestand}\n`);
  }
  ok(`${String(bijgewerkt.length)} bestand(en) bijgewerkt`);
}
