import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sync, syncNaarApp } from '../src/commands/sync.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type ProcesAanroep } from './helpers.js';

function maakAppMap(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'factory-sync-'));
}

describe('sync', () => {
  let aanroepen: ProcesAanroep[];

  beforeEach(() => {
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
});
