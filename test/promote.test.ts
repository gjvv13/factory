import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { promote, versieUitHealth } from '../src/commands/promote.js';
import * as shell from '../src/shell.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, zetBoardOmgeving, type ProcesAanroep } from './helpers.js';

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
  let herstelOmgeving: () => void;

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
    // Zie inleveren.test.ts: in CI draait de test zelf in een workflow.
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
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

  it('geeft de purge-vlag mee aan beide installs, ook in het terugrol-pad (#87)', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer((a) =>
      a.argumenten[0] === 'describe' ? { stdout: 'v0.3.0' } : {},
    );
    stelUitvoerderIn(uitvoerder);
    // Post-swap health faalt: dat triggert het terugrol-pad met zijn eigen install.
    vi.spyOn(shell, 'wachtOpGezond')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('{"status":"ok"}');

    await expect(promote('prod', 'v1.0.0', { ja: true })).rejects.toThrow();

    const installs = aanroepen.filter((a) => a.argumenten.includes('install'));
    expect(installs).toHaveLength(2);
    for (const install of installs) {
      expect(install.argumenten).toContain('--config.confirmModulesPurge=false');
      expect(install.argumenten).toContain('--frozen-lockfile');
      expect(install.argumenten).toContain('--prod=false');
    }
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

  it('meldt geslaagd als de omgeving na de swap de beoogde versie draait (#112)', async () => {
    process.chdir(maakApp());
    stelUitvoerderIn(maakUitvoerderOpnemer().uitvoerder);
    vi.spyOn(shell, 'wachtOpGezond').mockResolvedValue('{"status":"ok","version":"1.0.0"}');

    await expect(promote('prod', 'v1.0.0', { ja: true })).resolves.toBeUndefined();
  });

  it('rolt terug als de omgeving na de swap een andere versie meldt dan de tag (#112)', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer((a) =>
      a.argumenten[0] === 'describe' ? { stdout: 'v0.3.0' } : {},
    );
    stelUitvoerderIn(uitvoerder);
    // Health is "ok", maar de oude versie draait nog: de swap kwam niet aan. Na de
    // rollback naar v0.3.0 is de omgeving weer gezond.
    vi.spyOn(shell, 'wachtOpGezond')
      .mockResolvedValueOnce('{"status":"ok","version":"0.3.0"}')
      .mockResolvedValueOnce('{"status":"ok","version":"0.3.0"}');

    await expect(promote('prod', 'v1.0.0', { ja: true })).rejects.toThrow(
      /versie 0\.3\.0 i\.p\.v\. 1\.0\.0/i,
    );
    // De vorige tag is opnieuw uitgecheckt (terugrol).
    expect(aanroepen).toContainEqual(
      expect.objectContaining({
        commando: 'git',
        argumenten: expect.arrayContaining(['checkout', 'v0.3.0']),
      }),
    );
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

  /** Antwoord van de board-opzoeking; het item staat nog op Uitrollen. */
  const BOARD_ANTWOORD = JSON.stringify({
    data: {
      user: {
        projectV2: {
          id: 'PVT_test',
          field: { id: 'PVTSSF_test', options: [{ id: 'optie-done', name: 'Done' }] },
        },
      },
      repository: {
        issue: {
          projectItems: {
            nodes: [
              { id: 'PVTI_test', project: { number: 2 }, fieldValueByName: { name: 'Uitrollen' } },
            ],
          },
        },
      },
    },
  });

  /** git describe geeft de draaiende tag; git log één slice-merge in het bereik. */
  function boardOpnemer(): ReturnType<typeof maakUitvoerderOpnemer> {
    return maakUitvoerderOpnemer((a) => {
      if (a.commando === 'git' && a.argumenten[0] === 'describe') return { stdout: 'v0.9.0' };
      if (a.commando === 'git' && a.argumenten[0] === 'log') {
        return { stdout: 'Merge pull request #7 from gjvv13/slice/128-2' };
      }
      if (a.commando === 'gh' && a.argumenten[0] === 'api') return { stdout: BOARD_ANTWOORD };
      return {};
    });
  }

  /** Als boardOpnemer, maar met een ouder-epic en een instelbare voortgang. */
  function ouderOpnemer(voortgang: string): ReturnType<typeof maakUitvoerderOpnemer> {
    return maakUitvoerderOpnemer((a) => {
      if (a.commando === 'git' && a.argumenten[0] === 'describe') return { stdout: 'v0.9.0' };
      if (a.commando === 'git' && a.argumenten[0] === 'log') {
        return { stdout: 'Merge pull request #7 from gjvv13/slice/128-2' };
      }
      if (a.commando === 'gh' && a.argumenten[0] === 'api') {
        if (a.argumenten.includes('.parent_issue_url')) {
          return { stdout: 'https://api.github.com/repos/gjvv13/factory/issues/26' };
        }
        if (a.argumenten.some((x) => x.includes('sub_issues_summary'))) {
          return { stdout: voortgang };
        }
        return { stdout: BOARD_ANTWOORD };
      }
      return {};
    });
  }

  it('sluit de epic zodra zijn laatste slice op prod draait (#127)', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = ouderOpnemer('3/3');
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(shell, 'wachtOpGezond').mockResolvedValue('{"status":"ok","version":"1.0.0"}');

    await promote('prod', 'v1.0.0', { ja: true });

    const gesloten = aanroepen
      .filter((a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'close')
      .map((a) => a.argumenten[2]);
    // Eerst de slice zelf, daarna de epic.
    expect(gesloten).toEqual(['128', '26']);
  });

  it('laat de epic open zolang er nog een slice openstaat', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = ouderOpnemer('1/3');
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(shell, 'wachtOpGezond').mockResolvedValue('{"status":"ok","version":"1.0.0"}');

    await promote('prod', 'v1.0.0', { ja: true });

    const gesloten = aanroepen
      .filter((a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'close')
      .map((a) => a.argumenten[2]);
    expect(gesloten).toEqual(['128']);
  });

  it('zet de items uit het tagbereik op Done na een geslaagde prod-promote (#128)', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = boardOpnemer();
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(shell, 'wachtOpGezond').mockResolvedValue('{"status":"ok","version":"1.0.0"}');

    await promote('prod', 'v1.0.0', { ja: true });

    expect(aanroepen.map((a) => a.argumenten)).toContainEqual([
      'log',
      '--format=%s',
      'v0.9.0..v1.0.0',
    ]);
    expect(aanroepen.find((a) => a.argumenten[0] === 'project')?.argumenten).toContain(
      'optie-done',
    );
    // 128 uit de branchnaam, niet 7 uit "pull request #7": het PR-nummer zegt niets
    // over welk backlog-item erbij hoort.
    const comment = aanroepen.find((a) => a.argumenten[0] === 'issue');
    expect(comment?.argumenten.slice(0, 5)).toEqual([
      'issue',
      'comment',
      '128',
      '--repo',
      'gjvv13/factory',
    ]);
    expect(comment?.argumenten[6]).toContain('1.0.0');
  });

  it('schrijft niets op de backlog bij een promote naar acc', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = boardOpnemer();
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(shell, 'wachtOpGezond').mockResolvedValue('{"status":"ok","version":"1.0.0"}');

    await promote('acc', 'v1.0.0');

    // Acc is een tussenstation zonder eigen kolom.
    expect(aanroepen.some((a) => a.commando === 'gh')).toBe(false);
  });

  it('schrijft niets op de backlog als de uitrol niet aankwam', async () => {
    process.chdir(maakApp());
    const { uitvoerder, aanroepen } = boardOpnemer();
    stelUitvoerderIn(uitvoerder);
    // Health is ok maar meldt de oude versie: mislukte deploy, dus niets afboeken.
    vi.spyOn(shell, 'wachtOpGezond').mockResolvedValue('{"status":"ok","version":"0.9.0"}');

    await expect(promote('prod', 'v1.0.0', { ja: true })).rejects.toThrow();

    expect(aanroepen.some((a) => a.commando === 'gh')).toBe(false);
  });
});

describe('versieUitHealth', () => {
  it('leest de versie uit een /health-body', () => {
    expect(versieUitHealth('{"status":"ok","version":"1.2.3"}')).toBe('1.2.3');
  });

  it('geeft undefined als er geen versie in staat of de body geen JSON is', () => {
    expect(versieUitHealth('{"status":"ok"}')).toBeUndefined();
    expect(versieUitHealth('niet-json')).toBeUndefined();
  });
});
