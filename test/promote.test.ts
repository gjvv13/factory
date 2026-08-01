import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { promote } from '../src/commands/promote.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type ProcesAanroep } from './helpers.js';

function maakApp(): string {
  const werkruimte = mkdtempSync(path.join(os.tmpdir(), 'factory-promote-'));
  const appDir = path.join(werkruimte, 'proefapp');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    path.join(appDir, 'factory.json'),
    JSON.stringify({
      naam: 'proefapp',
      poorten: { dev: 3001, acc: 3002, prod: 3000 },
      envRoot: path.join(werkruimte, 'envs'),
      backlog: '../factory/backlog/proefapp',
    }),
  );
  return appDir;
}

function eersteIndex(aanroepen: ProcesAanroep[], test: (a: ProcesAanroep) => boolean): number {
  return aanroepen.findIndex(test);
}

describe('promote', () => {
  let oorspronkelijkeCwd: string;
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    oorspronkelijkeCwd = process.cwd();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    // De gezondheidscheck mag geen echt netwerk raken.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{"status":"ok"}'),
    } as unknown as Response);
  });

  afterEach(() => {
    process.chdir(oorspronkelijkeCwd);
    herstelUitvoerder();
  });

  it('weigert een onbekende omgeving', async () => {
    stelUitvoerderIn(maakUitvoerderOpnemer().uitvoerder);
    await expect(promote('staging', 'v1.0.0')).rejects.toThrow(/acc\|prod/);
  });

  it('checkt uit, installeert, bouwt, migreert, herstart en controleert de gezondheid in die volgorde', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    await promote('prod', 'v1.0.0');

    const checkout = eersteIndex(
      aanroepen,
      (a) => a.commando === 'git' && a.argumenten.includes('checkout'),
    );
    const install = eersteIndex(aanroepen, (a) => a.argumenten.includes('install'));
    const build = eersteIndex(
      aanroepen,
      (a) => a.argumenten.includes('run') && a.argumenten.includes('build'),
    );
    const migrate = eersteIndex(
      aanroepen,
      (a) => a.argumenten.includes('run') && a.argumenten.includes('migrate'),
    );
    const start = eersteIndex(
      aanroepen,
      (a) => a.commando === 'pm2' && a.argumenten[0] === 'start',
    );

    expect(checkout).toBeGreaterThanOrEqual(0);
    expect(checkout).toBeLessThan(install);
    expect(install).toBeLessThan(build);
    expect(build).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(start);
    // Prod wordt niet geseed.
    expect(aanroepen.some((a) => a.argumenten.includes('seed'))).toBe(false);
    // De gezondheidscheck draait op de prod-poort.
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:3000/health');
  });

  it('seedt wel op acceptatie', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    await promote('acc', 'v1.0.0');

    expect(aanroepen.some((a) => a.argumenten.includes('seed'))).toBe(true);
  });

  it('stopt bij de eerste fout en raakt de omgeving daarna niet meer aan', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer((a) =>
      a.argumenten.includes('install') ? { code: 1 } : {},
    );
    stelUitvoerderIn(uitvoerder);

    await expect(promote('prod', 'v1.0.0')).rejects.toThrow(/install/);
    // Na de gefaalde install worden build, migrate en pm2 niet meer aangeroepen.
    expect(aanroepen.some((a) => a.argumenten.includes('build'))).toBe(false);
    expect(aanroepen.some((a) => a.argumenten.includes('migrate'))).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'pm2')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
