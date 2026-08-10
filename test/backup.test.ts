import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backup } from '../src/commands/backup.js';
import { herstelUitvoerder, stelUitvoerderIn, type Uitvoerder } from '../src/shell.js';

interface Opzet {
  readonly appDir: string;
  readonly backupsDir: string;
  readonly dbPad: string;
}

function maakApp(databaseFile = 'data/prod.sqlite'): Opzet {
  const werkruimte = mkdtempSync(path.join(os.tmpdir(), 'factory-backup-'));
  const appDir = path.join(werkruimte, 'proefapp');
  mkdirSync(path.join(appDir, 'environments'), { recursive: true });
  writeFileSync(
    path.join(appDir, 'factory.json'),
    JSON.stringify({
      naam: 'proefapp',
      poorten: { dev: 3001, acc: 3002, prod: 3000 },
      envRoot: path.join(werkruimte, 'envs'),
    }),
  );
  writeFileSync(path.join(appDir, 'environments', 'prod.env'), `DATABASE_FILE=${databaseFile}\n`);
  const prodWerkmap = path.join(werkruimte, 'envs', 'prod');
  const dbPad = path.resolve(prodWerkmap, databaseFile);
  if (databaseFile !== ':memory:') {
    mkdirSync(path.dirname(dbPad), { recursive: true });
    writeFileSync(dbPad, 'echte-database');
  }
  return { appDir, backupsDir: path.join(prodWerkmap, 'backups'), dbPad };
}

/**
 * Bootst sqlite3 na zonder de binary: `.backup` schrijft een dummy-kopie op de
 * doelplek, de integriteitscheck antwoordt standaard 'ok'. Zo draait de rotatie
 * over echte bestanden terwijl er geen sqlite3 nodig is.
 */
function sqlite3Nep(integriteit = 'ok'): Uitvoerder {
  return (commando, argumenten) => {
    if (commando === 'sqlite3' && argumenten[1]?.startsWith(".backup '")) {
      const doel = argumenten[1].slice(".backup '".length, -1);
      writeFileSync(doel, 'kopie');
      return { code: 0, stdout: '' };
    }
    if (commando === 'sqlite3' && argumenten[1] === 'PRAGMA integrity_check') {
      return { code: 0, stdout: `${integriteit}\n` };
    }
    return { code: 0, stdout: '' };
  };
}

function seedGeneraties(backupsDir: string, tijdstempels: readonly string[]): void {
  mkdirSync(backupsDir, { recursive: true });
  for (const stempel of tijdstempels) {
    writeFileSync(path.join(backupsDir, `proefapp-prod-${stempel}.sqlite`), 'oud');
  }
}

function backups(backupsDir: string): string[] {
  return existsSync(backupsDir)
    ? readdirSync(backupsDir)
        .filter((b) => b.endsWith('.sqlite'))
        .sort()
    : [];
}

describe('backup', () => {
  let oorspronkelijkeCwd: string;

  beforeEach(() => {
    oorspronkelijkeCwd = process.cwd();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    process.chdir(oorspronkelijkeCwd);
    herstelUitvoerder();
  });

  it('maakt een tijdstempel-kopie via sqlite3 .backup op de juiste db', () => {
    const { appDir, backupsDir, dbPad } = maakApp();
    process.chdir(appDir);
    const aanroepen: { commando: string; argumenten: string[] }[] = [];
    const nep = sqlite3Nep();
    stelUitvoerderIn((commando, argumenten, opties) => {
      aanroepen.push({ commando, argumenten });
      return nep(commando, argumenten, opties);
    });

    backup('prod', { nu: new Date('2026-08-10T03:30:00') });

    expect(backups(backupsDir)).toEqual(['proefapp-prod-20260810-033000.sqlite']);
    // De .backup draait tegen precies het prod-databasebestand.
    const backupAanroep = aanroepen.find((a) => a.argumenten[1]?.startsWith('.backup'));
    expect(backupAanroep?.argumenten[0]).toBe(dbPad);
  });

  it('houdt standaard de nieuwste 7 generaties en ruimt de rest op', () => {
    const { appDir, backupsDir } = maakApp();
    process.chdir(appDir);
    stelUitvoerderIn(sqlite3Nep());
    // Acht oudere generaties; de nieuwe (2026) komt erbij → negen, waarvan 7 blijven.
    seedGeneraties(backupsDir, [
      '20200101-000001',
      '20200101-000002',
      '20200101-000003',
      '20200101-000004',
      '20200101-000005',
      '20200101-000006',
      '20200101-000007',
      '20200101-000008',
    ]);

    backup('prod', { nu: new Date('2026-08-10T03:30:00') });

    const overgebleven = backups(backupsDir);
    expect(overgebleven).toHaveLength(7);
    expect(overgebleven).toContain('proefapp-prod-20260810-033000.sqlite');
    // De twee oudste zijn weg.
    expect(overgebleven).not.toContain('proefapp-prod-20200101-000001.sqlite');
    expect(overgebleven).not.toContain('proefapp-prod-20200101-000002.sqlite');
  });

  it('respecteert een eigen aantal te bewaren generaties', () => {
    const { appDir, backupsDir } = maakApp();
    process.chdir(appDir);
    stelUitvoerderIn(sqlite3Nep());
    seedGeneraties(backupsDir, ['20200101-000001', '20200101-000002', '20200101-000003']);

    backup('prod', { bewaar: 2, nu: new Date('2026-08-10T03:30:00') });

    expect(backups(backupsDir)).toEqual([
      'proefapp-prod-20200101-000003.sqlite',
      'proefapp-prod-20260810-033000.sqlite',
    ]);
  });

  it('weigert een onbekende omgeving', () => {
    stelUitvoerderIn(sqlite3Nep());
    expect(() => {
      backup('staging');
    }).toThrow(/omgeving/i);
  });

  it('weigert een ongeldig aantal te bewaren backups', () => {
    const { appDir } = maakApp();
    process.chdir(appDir);
    stelUitvoerderIn(sqlite3Nep());
    expect(() => {
      backup('prod', { bewaar: 0 });
    }).toThrow(/1 of hoger/);
  });

  it('faalt duidelijk als het databasebestand niet bestaat', () => {
    const { appDir, dbPad } = maakApp();
    process.chdir(appDir);
    rmSync(dbPad);
    stelUitvoerderIn(sqlite3Nep());
    expect(() => {
      backup('prod');
    }).toThrow(/niet gevonden/);
  });

  it('slaat een in-memory database over', () => {
    const { appDir } = maakApp(':memory:');
    process.chdir(appDir);
    stelUitvoerderIn(sqlite3Nep());
    expect(() => {
      backup('prod');
    }).toThrow(/in-memory/);
  });

  it('faalt als de integriteitscheck van de kopie niet ok is', () => {
    const { appDir } = maakApp();
    process.chdir(appDir);
    stelUitvoerderIn(sqlite3Nep('*** in database main ***\nrij ontbreekt'));
    expect(() => {
      backup('prod');
    }).toThrow(/integriteitscheck faalde/);
  });
});
