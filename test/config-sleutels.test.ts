import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vergelijkSleutels, toetsConfigSleutels } from '../src/config-sleutels.js';
import type { SleutelContract } from '../src/config-sleutels.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import type { ProcesUitkomst } from '../src/shell.js';

/** App met environments-bestanden voor acc en prod. */
function maakApp(bestanden: Record<string, string>): string {
  const appDir = mkdtempSync(path.join(os.tmpdir(), 'factory-sleutels-'));
  const map = path.join(appDir, 'environments');
  mkdirSync(map, { recursive: true });
  for (const [naam, inhoud] of Object.entries(bestanden)) {
    writeFileSync(path.join(map, naam), inhoud);
  }
  return appDir;
}

describe('vergelijkSleutels', () => {
  it('meldt ontbrekende verwachte sleutels', () => {
    const appDir = maakApp({ 'prod.env': 'LOG_LEVEL=info\n' });
    const contract: SleutelContract = {
      verwacht: ['LOG_LEVEL', 'DOORSTUUR_DOELEN'],
      geheim: [],
    };
    const r = vergelijkSleutels(appDir, 'prod', contract);
    expect(r.ontbrekend).toEqual(['DOORSTUUR_DOELEN']);
    expect(r.ontbrekendGeheim).toEqual([]);
    expect(r.nietControleerbaar).toBe(0);
  });

  it('meldt alles bij als alle verwachte sleutels er zijn', () => {
    const appDir = maakApp({ 'acc.env': 'LOG_LEVEL=info\nDOORSTUUR_DOELEN=matrix\n' });
    const contract: SleutelContract = {
      verwacht: ['LOG_LEVEL', 'DOORSTUUR_DOELEN'],
      geheim: [],
    };
    const r = vergelijkSleutels(appDir, 'acc', contract);
    expect(r.ontbrekend).toEqual([]);
  });

  it('meldt lege verwachte sleutels als waarschuwing', () => {
    const appDir = maakApp({ 'prod.env': 'LOG_LEVEL=info\nDOORSTUUR_DOELEN=\n' });
    const contract: SleutelContract = {
      verwacht: ['LOG_LEVEL', 'DOORSTUUR_DOELEN'],
      geheim: [],
    };
    const r = vergelijkSleutels(appDir, 'prod', contract);
    expect(r.ontbrekend).toEqual([]);
    expect(r.leeg).toEqual(['DOORSTUUR_DOELEN']);
  });

  it('controleert geheime sleutels alleen als het secrets-bestand bestaat', () => {
    const appDir = maakApp({ 'prod.env': 'LOG_LEVEL=info\n' });
    const contract: SleutelContract = {
      verwacht: ['LOG_LEVEL'],
      geheim: ['MATRIX_TOKEN', 'API_KEY'],
    };
    const r = vergelijkSleutels(appDir, 'prod', contract);
    expect(r.ontbrekendGeheim).toEqual([]);
    expect(r.nietControleerbaar).toBe(2);
  });

  it('meldt ontbrekende geheime sleutels als het secrets-bestand er is', () => {
    const appDir = maakApp({
      'prod.env': 'LOG_LEVEL=info\n',
      'prod.secrets.env': 'API_KEY=abc\n',
    });
    const contract: SleutelContract = {
      verwacht: ['LOG_LEVEL'],
      geheim: ['MATRIX_TOKEN', 'API_KEY'],
    };
    const r = vergelijkSleutels(appDir, 'prod', contract);
    expect(r.ontbrekendGeheim).toEqual(['MATRIX_TOKEN']);
    expect(r.nietControleerbaar).toBe(0);
  });

  it('negeert lege sleutels die niet in het contract staan', () => {
    const appDir = maakApp({ 'acc.env': 'LOG_LEVEL=info\nONBEKEND=\n' });
    const contract: SleutelContract = {
      verwacht: ['LOG_LEVEL'],
      geheim: [],
    };
    const r = vergelijkSleutels(appDir, 'acc', contract);
    expect(r.leeg).toEqual([]);
  });
});

describe('toetsConfigSleutels', () => {
  let uitvoer: string;

  beforeEach(() => {
    uitvoer = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      uitvoer += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    herstelUitvoerder();
  });

  function stelScriptIn(json: string): void {
    stelUitvoerderIn((_commando, argumenten): ProcesUitkomst => {
      const isSleutels = argumenten.includes('config:sleutels');
      return { code: 0, stdout: isSleutels ? json : '' };
    });
  }

  it('slaat de stap over bij configSleutels "uit"', () => {
    const config = { configSleutels: 'uit' as const } as never;
    toetsConfigSleutels('/tmp/dummy', config, new Set(['config:sleutels']));
    expect(uitvoer).toBe('');
  });

  it('slaat de stap over als het script niet in package.json staat', () => {
    toetsConfigSleutels('/tmp/dummy', undefined, new Set(['test:unit']));
    expect(uitvoer).toBe('');
  });

  it('meldt een ontbrekende sleutel met sleutelnaam en env-bestand', () => {
    const appDir = maakApp({ 'prod.env': 'LOG_LEVEL=info\n', 'acc.env': 'LOG_LEVEL=info\n' });
    const contract = JSON.stringify({ verwacht: ['LOG_LEVEL', 'DOORSTUUR_DOELEN'], geheim: [] });
    stelScriptIn(contract);
    const config = { configSleutels: 'waarschuw' as const, appDir } as never;
    toetsConfigSleutels(appDir, config, new Set(['config:sleutels']));
    expect(uitvoer).toContain('DOORSTUUR_DOELEN');
    expect(uitvoer).toContain('prod.env');
  });

  it('faalt bij configSleutels "blokkeer" en een ontbrekende sleutel', () => {
    const appDir = maakApp({ 'prod.env': 'LOG_LEVEL=info\n', 'acc.env': 'LOG_LEVEL=info\n' });
    const contract = JSON.stringify({ verwacht: ['LOG_LEVEL', 'DOORSTUUR_DOELEN'], geheim: [] });
    stelScriptIn(contract);
    const config = { configSleutels: 'blokkeer' as const, appDir } as never;
    expect(() => {
      toetsConfigSleutels(appDir, config, new Set(['config:sleutels']));
    }).toThrow(/ontbrekende config-sleutel/);
  });

  it('toont het ok-bericht als alle sleutels er zijn', () => {
    const appDir = maakApp({
      'prod.env': 'LOG_LEVEL=info\n',
      'acc.env': 'LOG_LEVEL=info\n',
    });
    const contract = JSON.stringify({ verwacht: ['LOG_LEVEL'], geheim: [] });
    stelScriptIn(contract);
    const config = { configSleutels: 'waarschuw' as const, appDir } as never;
    toetsConfigSleutels(appDir, config, new Set(['config:sleutels']));
    expect(uitvoer).toContain('acc en prod bij');
    expect(uitvoer).toContain('(1 sleutel)');
  });

  it('meldt hoeveel geheime sleutels niet controleerbaar zijn als het secrets-bestand ontbreekt', () => {
    const appDir = maakApp({ 'prod.env': 'LOG_LEVEL=info\n', 'acc.env': 'LOG_LEVEL=info\n' });
    const contract = JSON.stringify({ verwacht: ['LOG_LEVEL'], geheim: ['MATRIX_TOKEN'] });
    stelScriptIn(contract);
    const config = { configSleutels: 'waarschuw' as const, appDir } as never;
    toetsConfigSleutels(appDir, config, new Set(['config:sleutels']));
    expect(uitvoer).toContain('niet controleerbaar');
    expect(uitvoer).toContain('secrets.env ontbreekt');
  });

  it('meldt lege verwachte sleutels als waarschuwing', () => {
    const appDir = maakApp({
      'prod.env': 'LOG_LEVEL=info\nDOORSTUUR_DOELEN=\n',
      'acc.env': 'LOG_LEVEL=info\nDOORSTUUR_DOELEN=ok\n',
    });
    const contract = JSON.stringify({ verwacht: ['LOG_LEVEL', 'DOORSTUUR_DOELEN'], geheim: [] });
    stelScriptIn(contract);
    const config = { configSleutels: 'waarschuw' as const, appDir } as never;
    toetsConfigSleutels(appDir, config, new Set(['config:sleutels']));
    expect(uitvoer).toContain('DOORSTUUR_DOELEN is leeg');
  });

  it('waarschuwt als het script ongeldige uitvoer levert', () => {
    stelUitvoerderIn((): ProcesUitkomst => ({ code: 0, stdout: 'niet json' }));
    toetsConfigSleutels('/tmp/dummy', undefined, new Set(['config:sleutels']));
    expect(uitvoer).toContain('overgeslagen');
  });

  it('gooit niet en waarschuwt als een regel met `{` begint maar geen geldige JSON is', () => {
    stelUitvoerderIn((): ProcesUitkomst => ({ code: 0, stdout: '{pid: 12345} server gestart' }));
    expect(() => {
      toetsConfigSleutels('/tmp/dummy', undefined, new Set(['config:sleutels']));
    }).not.toThrow();
    expect(uitvoer).toContain('overgeslagen');
  });
});
