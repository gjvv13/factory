import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sync, syncNaarApp, syncVerschillen } from '../src/commands/sync.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type ProcesAanroep } from './helpers.js';

function maakAppMap(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'factory-sync-'));
}

/** Schrijft een geldige factory.json zodat sync() de app en zijn config vindt. */
function schrijfAppConfig(appDir: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    path.join(appDir, 'factory.json'),
    JSON.stringify({
      naam: 'proefapp',
      poorten: { dev: 3001, acc: 3002, prod: 3000 },
      envRoot: '~/AppEnvs/proefapp',
      ...extra,
    }),
  );
}

const BOUW = path.join('.claude', 'commands', 'bouw.md');
const OVERBODIG = path.join('.claude', 'commands', 'oud-commando.md');

describe('sync', () => {
  let aanroepen: ProcesAanroep[];

  beforeEach(() => {
    // controleer() en sync() schrijven hun voortgang naar stdout; in `factory
    // verify` lekt die drift-listing (bewust opgewekt door de tests hieronder)
    // tussen de vitest-output en lijkt op een echte fout. Onderdrukken zoals de
    // andere commandotests dat doen.
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const opnemer = maakUitvoerderOpnemer();
    aanroepen = opnemer.aanroepen;
    stelUitvoerderIn(opnemer.uitvoerder);
  });

  afterEach(() => {
    herstelUitvoerder();
  });

  it('kopieert de slash command, de skill, de CI-workflow en de git hook naar de app', () => {
    const app = maakAppMap();

    const bijgewerkt = syncNaarApp(app);

    expect(existsSync(path.join(app, '.claude', 'commands', 'bouw.md'))).toBe(true);
    expect(existsSync(path.join(app, '.claude', 'skills', 'coding-guidelines', 'SKILL.md'))).toBe(
      true,
    );
    // Het onbemand-werken-contract moet mee naar élke app: een latere bouw-werker
    // erft dan dezelfde escalatieregels zonder dat er iets herontworpen wordt (#104).
    expect(existsSync(path.join(app, '.claude', 'skills', 'onbemand-werken', 'SKILL.md'))).toBe(
      true,
    );
    expect(existsSync(path.join(app, '.github', 'workflows', 'ci.yml'))).toBe(true);
    expect(existsSync(path.join(app, '.githooks', 'pre-commit'))).toBe(true);
    // Meldt elk bijgewerkt bestand terug.
    expect(bijgewerkt).toContain(path.join('.claude', 'commands', 'bouw.md'));
    // Zet de git hooks-map goed via git config (via de nep-uitvoerder, geen echte git).
    expect(aanroepen).toContainEqual(
      expect.objectContaining({
        commando: 'git',
        argumenten: ['config', 'core.hooksPath', '.githooks'],
      }),
    );
  });

  it('meldt niets bij een tweede sync omdat alles al gelijk staat', () => {
    const app = maakAppMap();

    syncNaarApp(app);
    const tweede = syncNaarApp(app);

    expect(tweede).toEqual([]);
  });

  it('weigert te draaien buiten een applicatiemap', () => {
    const buiten = mkdtempSync(path.join(os.tmpdir(), 'factory-geen-app-'));
    const oorspronkelijk = process.cwd();
    process.chdir(buiten);
    try {
      expect(() => {
        sync();
      }).toThrow(/applicatiemap/);
    } finally {
      process.chdir(oorspronkelijk);
    }
  });

  it('ziet direct na een sync alles als gelijk, zonder iets te schrijven', () => {
    const app = maakAppMap();
    syncNaarApp(app);

    const verschillen = syncVerschillen(app);

    expect(verschillen.every((verschil) => verschil.status === 'gelijk')).toBe(true);
    expect(verschillen.some((verschil) => verschil.pad === BOUW)).toBe(true);
  });

  it('signaleert een afwijkend en een overbodig bestand', () => {
    const app = maakAppMap();
    syncNaarApp(app);
    // Een gesynct bestand dat lokaal is gewijzigd, en een dat de factory niet kent.
    writeFileSync(path.join(app, BOUW), 'lokaal gewijzigd');
    writeFileSync(path.join(app, OVERBODIG), 'weg hiermee');

    const perPad = new Map(syncVerschillen(app).map((verschil) => [verschil.pad, verschil.status]));

    expect(perPad.get(BOUW)).toBe('afwijkend');
    expect(perPad.get(OVERBODIG)).toBe('overbodig');
  });

  it('respecteert de negeerlijst bij het bepalen van verschillen', () => {
    const app = maakAppMap();
    syncNaarApp(app);
    writeFileSync(path.join(app, OVERBODIG), 'bewuste afwijking');

    const verschillen = syncVerschillen(app, [OVERBODIG]);

    expect(verschillen.some((verschil) => verschil.pad === OVERBODIG)).toBe(false);
  });

  it('sync --check eindigt zonder fout als alles gelijk is', () => {
    const app = maakAppMap();
    syncNaarApp(app);
    schrijfAppConfig(app);
    const oorspronkelijk = process.cwd();
    process.chdir(app);
    try {
      expect(() => {
        sync({ check: true });
      }).not.toThrow();
    } finally {
      process.chdir(oorspronkelijk);
    }
  });

  it('sync --check faalt met een niet-nul exit bij drift', () => {
    const app = maakAppMap();
    syncNaarApp(app);
    schrijfAppConfig(app);
    writeFileSync(path.join(app, BOUW), 'lokaal gewijzigd');
    const oorspronkelijk = process.cwd();
    process.chdir(app);
    try {
      expect(() => {
        sync({ check: true });
      }).toThrow(/verschil/);
    } finally {
      process.chdir(oorspronkelijk);
    }
  });

  it('sync --check negeert paden uit syncNegeer in factory.json', () => {
    const app = maakAppMap();
    syncNaarApp(app);
    writeFileSync(path.join(app, BOUW), 'lokaal gewijzigd');
    schrijfAppConfig(app, { syncNegeer: [BOUW] });
    const oorspronkelijk = process.cwd();
    process.chdir(app);
    try {
      expect(() => {
        sync({ check: true });
      }).not.toThrow();
    } finally {
      process.chdir(oorspronkelijk);
    }
  });
});
