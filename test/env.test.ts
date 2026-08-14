import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/commands/env.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type ProcesAanroep, type UitkomstBepaler } from './helpers.js';

function maakApp(): string {
  const werkruimte = mkdtempSync(path.join(os.tmpdir(), 'factory-env-'));
  const appDir = path.join(werkruimte, 'proefapp');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    path.join(appDir, 'factory.json'),
    JSON.stringify({
      naam: 'proefapp',
      poorten: { dev: 3001, acc: 3002, prod: 3000 },
      envRoot: path.join(werkruimte, 'envs'),
    }),
  );
  return appDir;
}

function pm2Aanroepen(aanroepen: ProcesAanroep[]): ProcesAanroep[] {
  return aanroepen.filter((a) => a.commando === 'pm2');
}

describe('env reload', () => {
  let oorspronkelijkeCwd: string;

  beforeEach(() => {
    oorspronkelijkeCwd = process.cwd();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    process.chdir(oorspronkelijkeCwd);
    herstelUitvoerder();
  });

  it('verwijdert het bestaande proces en start het vers uit de ecosystem, zonder --update-env', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    await env('reload', 'prod');

    const pm2 = pm2Aanroepen(aanroepen).map((a) => a.argumenten);
    expect(pm2).toEqual([
      ['describe', 'proefapp-prod'],
      ['delete', 'proefapp-prod'],
      ['start', expect.stringContaining('ecosystem.config.cjs'), '--only', 'proefapp-prod'],
      ['save'],
    ]);
    // Nooit de onbetrouwbare restart --update-env die de ecosystem-env niet herleest.
    expect(pm2.some((args) => args.includes('--update-env'))).toBe(false);
    expect(pm2.some((args) => args[0] === 'restart')).toBe(false);
  });

  it('slaat delete over als het proces nog niet bestaat', async () => {
    process.chdir(maakApp());
    // pm2 describe faalt → proces bestaat niet.
    const bepaal: UitkomstBepaler = (aanroep) =>
      aanroep.argumenten[0] === 'describe' ? { code: 1 } : {};
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    await env('reload', 'prod');

    const pm2 = pm2Aanroepen(aanroepen).map((a) => a.argumenten[0]);
    expect(pm2).toEqual(['describe', 'start', 'save']);
    expect(pm2).not.toContain('delete');
  });

  it('weigert reload zonder omgeving', async () => {
    process.chdir(maakApp());
    stelUitvoerderIn(maakUitvoerderOpnemer().uitvoerder);

    await expect(env('reload')).rejects.toThrow(/omgeving/i);
  });
});
