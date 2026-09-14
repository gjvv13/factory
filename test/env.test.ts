import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
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

describe('env status: env-stale waarschuwing (#669)', () => {
  let oorspronkelijkeCwd: string;
  let schrijfSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    oorspronkelijkeCwd = process.cwd();
    schrijfSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    process.chdir(oorspronkelijkeCwd);
    herstelUitvoerder();
  });

  /** pm2 jlist dat een proces meldt met een uptime in epoch ms. */
  function pm2JlistAntwoord(naam: string, uptimeMs: number): string {
    return JSON.stringify([{ name: naam, pm2_env: { pm_uptime: uptimeMs, status: 'online' } }]);
  }

  it('waarschuwt als een env-bestand nieuwer is dan het pm2-proces', async () => {
    const appDir = maakApp();
    process.chdir(appDir);
    // Maak het environments-pad en een env-bestand.
    const envMap = path.join(appDir, 'environments');
    mkdirSync(envMap, { recursive: true });
    writeFileSync(path.join(envMap, 'prod.env'), 'KEY=waarde');
    // Zet het env-bestand ver in de toekomst zodat het nieuwer is dan het proces.
    const toekomst = new Date(Date.now() + 3_600_000);
    utimesSync(path.join(envMap, 'prod.env'), toekomst, toekomst);

    // pm2 jlist meldt een uptime van vóór het env-bestand.
    const uptimeMs = Date.now() - 60_000; // 1 minuut geleden gestart
    const bepaal: UitkomstBepaler = (aanroep) => {
      if (aanroep.commando === 'pm2' && aanroep.argumenten[0] === 'jlist') {
        return { stdout: pm2JlistAntwoord('proefapp-prod', uptimeMs) };
      }
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    await env('status');

    const uitvoer = (schrijfSpy.mock.calls as [unknown][]).map((c) => String(c[0])).join('');
    expect(uitvoer).toContain('prod.env is nieuwer dan het proces');
    expect(uitvoer).toContain('factory env reload prod');
  });

  it('waarschuwt niet als het env-bestand ouder is dan het proces', async () => {
    const appDir = maakApp();
    process.chdir(appDir);
    const envMap = path.join(appDir, 'environments');
    mkdirSync(envMap, { recursive: true });
    writeFileSync(path.join(envMap, 'prod.env'), 'KEY=waarde');
    // Zet het env-bestand ver in het verleden.
    const verleden = new Date(Date.now() - 3_600_000);
    utimesSync(path.join(envMap, 'prod.env'), verleden, verleden);

    const uptimeMs = Date.now(); // net gestart
    const bepaal: UitkomstBepaler = (aanroep) => {
      if (aanroep.commando === 'pm2' && aanroep.argumenten[0] === 'jlist') {
        return { stdout: pm2JlistAntwoord('proefapp-prod', uptimeMs) };
      }
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    await env('status');

    const uitvoer = (schrijfSpy.mock.calls as [unknown][]).map((c) => String(c[0])).join('');
    expect(uitvoer).not.toContain('nieuwer dan het proces');
  });

  it('slaat de check over als het pm2-proces niet draait', async () => {
    const appDir = maakApp();
    process.chdir(appDir);
    const envMap = path.join(appDir, 'environments');
    mkdirSync(envMap, { recursive: true });
    writeFileSync(path.join(envMap, 'prod.env'), 'KEY=waarde');

    // pm2 jlist geeft een lege lijst — geen processen.
    const bepaal: UitkomstBepaler = (aanroep) => {
      if (aanroep.commando === 'pm2' && aanroep.argumenten[0] === 'jlist') {
        return { stdout: '[]' };
      }
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    await env('status');

    const uitvoer = (schrijfSpy.mock.calls as [unknown][]).map((c) => String(c[0])).join('');
    expect(uitvoer).not.toContain('nieuwer dan het proces');
  });
});
