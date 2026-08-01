import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { promote } from '../src/commands/promote.js';
import * as shell from '../src/shell.js';
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
    // Pre-swap health: standaard komt de nieuwe versie gezond op, zonder echt te spawnen.
    vi.spyOn(shell, 'vrijePoort').mockResolvedValue(59999);
    vi.spyOn(shell, 'isGezondNaStart').mockResolvedValue(true);
    // Post-swap health: standaard is de omgeving na de swap gezond.
    vi.spyOn(shell, 'wachtOpGezond').mockResolvedValue('{"status":"ok"}');
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

    await promote('prod', 'v1.0.0', { ja: true });

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
    // De post-swap gezondheidscheck draait op de prod-poort.
    expect(shell.wachtOpGezond).toHaveBeenCalledWith('http://127.0.0.1:3000/health', 30);
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

    await expect(promote('prod', 'v1.0.0', { ja: true })).rejects.toThrow(/install/);
    // Na de gefaalde install worden build, migrate en pm2 niet meer aangeroepen.
    expect(aanroepen.some((a) => a.argumenten.includes('build'))).toBe(false);
    expect(aanroepen.some((a) => a.argumenten.includes('migrate'))).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'pm2')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('breekt af als de nieuwe versie vooraf niet gezond wordt, zonder de omgeving aan te raken', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(shell, 'isGezondNaStart').mockResolvedValue(false);

    await expect(promote('prod', 'v1.0.0', { ja: true })).rejects.toThrow(/niet gezond/i);
    // De pre-swap health zit vóór de swap: pm2 wordt niet aangeraakt.
    expect(aanroepen.some((a) => a.commando === 'pm2')).toBe(false);
    // De definitieve (post-swap) health draait dan ook niet.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('vraagt bevestiging voor prod en breekt af bij nee', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(shell, 'isInteractief').mockReturnValue(true);
    const bevestigSpy = vi.spyOn(shell, 'bevestig').mockResolvedValue(false);

    await expect(promote('prod', 'v1.0.0')).rejects.toThrow(/afgebroken/i);
    expect(bevestigSpy).toHaveBeenCalled();
    // Bij nee is er niets omgezet: pm2 is niet aangeraakt.
    expect(aanroepen.some((a) => a.commando === 'pm2')).toBe(false);
  });

  it('zet prod wel om na een bevestigend antwoord', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(shell, 'isInteractief').mockReturnValue(true);
    vi.spyOn(shell, 'bevestig').mockResolvedValue(true);

    await promote('prod', 'v1.0.0');

    expect(aanroepen.some((a) => a.commando === 'pm2' && a.argumenten[0] === 'start')).toBe(true);
  });

  it('slaat de vraag over met --ja', async () => {
    process.chdir(maakApp());
    const { uitvoerder } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);
    const bevestigSpy = vi.spyOn(shell, 'bevestig');

    await promote('prod', 'v1.0.0', { ja: true });

    expect(bevestigSpy).not.toHaveBeenCalled();
  });

  it('breekt niet-interactief zonder --ja meteen af, vóór er iets aan de omgeving gebeurt', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(shell, 'isInteractief').mockReturnValue(false);

    await expect(promote('prod', 'v1.0.0')).rejects.toThrow(/--ja/);
    // Fail-fast: er is niet eens uitgecheckt.
    expect(aanroepen.some((a) => a.commando === 'git' && a.argumenten.includes('checkout'))).toBe(
      false,
    );
    expect(aanroepen.some((a) => a.commando === 'pm2')).toBe(false);
  });

  it('vraagt niets voor acc', async () => {
    process.chdir(maakApp());
    const { uitvoerder } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);
    const bevestigSpy = vi.spyOn(shell, 'bevestig');

    await promote('acc', 'v1.0.0');

    expect(bevestigSpy).not.toHaveBeenCalled();
  });

  it('rolt terug naar de vorige tag als de nieuwe versie na de swap niet gezond wordt', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer((a) =>
      a.argumenten[0] === 'describe' ? { stdout: 'v0.3.0' } : {},
    );
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(shell, 'wachtOpGezond')
      .mockResolvedValueOnce(undefined) // nieuwe versie: niet gezond
      .mockResolvedValueOnce('{"status":"ok"}'); // na rollback: weer gezond

    await expect(promote('prod', 'v1.0.0', { ja: true })).rejects.toThrow(
      /draait weer op v0\.3\.0/i,
    );
    // De vorige tag is opnieuw uitgecheckt.
    expect(aanroepen).toContainEqual(
      expect.objectContaining({
        commando: 'git',
        argumenten: expect.arrayContaining(['checkout', 'v0.3.0']),
      }),
    );
    // pm2 start is twee keer gebeurd: de nieuwe versie en daarna de teruggerolde.
    expect(
      aanroepen.filter((a) => a.commando === 'pm2' && a.argumenten[0] === 'start').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('breekt af zonder rollback als er geen vorige versie is', async () => {
    process.chdir(maakApp());
    const { uitvoerder } = maakUitvoerderOpnemer((a) =>
      a.argumenten[0] === 'describe' ? { code: 1 } : {},
    );
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(shell, 'wachtOpGezond').mockResolvedValue(undefined);

    await expect(promote('prod', 'v1.0.0', { ja: true })).rejects.toThrow(/geen vorige versie/i);
  });

  it('stopt hard als de rollback zelf niet gezond wordt', async () => {
    process.chdir(maakApp());
    const { uitvoerder } = maakUitvoerderOpnemer((a) =>
      a.argumenten[0] === 'describe' ? { stdout: 'v0.3.0' } : {},
    );
    stelUitvoerderIn(uitvoerder);
    // Zowel de nieuwe versie als de teruggerolde blijven ongezond.
    vi.spyOn(shell, 'wachtOpGezond').mockResolvedValue(undefined);

    await expect(promote('prod', 'v1.0.0', { ja: true })).rejects.toThrow(/handmatig ingrijpen/i);
  });
});
