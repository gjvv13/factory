import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/app-config.js';
import { heeftNieuweMigratie, toonMigratieStatus, versieUitHealth } from '../src/migratie.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type UitkomstBepaler } from './helpers.js';

/** Minimale AppConfig die `draaiendeProdTag` nodig heeft: alleen `poorten.prod` telt. */
function fakeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    naam: 'test',
    poorten: { dev: 3001, acc: 3002, prod: 3000 },
    envRoot: '~/AppEnvs/test',
    envRootPad: '/Users/test/AppEnvs/test',
    diffDekkingsMinimum: 80,
    dekkingsRatchet: 'waarschuw',
    dekkingsTolerantie: 0.5,
    integratie: 'merge-queue',
    flagVerloop: 'waarschuw',
    configSleutels: 'waarschuw',
    codeReview: 'waarschuw',
    audit: 'waarschuw',
    auditNiveau: 'high',
    appDir: '/fake-app',
    ...overrides,
  };
}

describe('heeftNieuweMigratie', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  it('is waar als git een toegevoegd bestand onder migrations/ meldt', () => {
    const bepaal: UitkomstBepaler = ({ argumenten }) =>
      argumenten[0] === 'diff' ? { stdout: 'migrations/0002_nieuw.sql\n' } : {};
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    expect(heeftNieuweMigratie('/repo', 'v0.16.1')).toBe(true);
  });

  it('is onwaar als er niets onder migrations/ is toegevoegd', () => {
    // Standaard geeft de opnemer lege stdout terug.
    stelUitvoerderIn(maakUitvoerderOpnemer().uitvoerder);
    expect(heeftNieuweMigratie('/repo', 'v0.16.1')).toBe(false);
  });

  it('is onwaar als het git-commando faalt', () => {
    const bepaal: UitkomstBepaler = ({ argumenten }) =>
      argumenten[0] === 'diff' ? { code: 1 } : {};
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);
    expect(heeftNieuweMigratie('/repo', 'v0.16.1')).toBe(false);
  });

  it('vergelijkt tegen de meegegeven tag met alleen toegevoegde bestanden', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    heeftNieuweMigratie('/repo', 'v0.16.1');

    expect(aanroepen[0]?.argumenten).toEqual([
      'diff',
      '--name-only',
      '--diff-filter=A',
      'v0.16.1',
      'HEAD',
      '--',
      'migrations',
    ]);
  });
});

describe('versieUitHealth', () => {
  it('haalt de versie uit een geldige health-body', () => {
    expect(versieUitHealth('{"status":"ok","version":"1.2.3"}')).toBe('1.2.3');
  });

  it('geeft undefined bij een body zonder versie', () => {
    expect(versieUitHealth('{"status":"ok"}')).toBeUndefined();
  });

  it('geeft undefined bij ongeldige JSON', () => {
    expect(versieUitHealth('niet-json')).toBeUndefined();
  });
});

describe('toonMigratieStatus', () => {
  let uitvoer: string;
  let foutenUitvoer: string;

  beforeEach(() => {
    uitvoer = '';
    foutenUitvoer = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      uitvoer += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      foutenUitvoer += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('print ja als prod achterblijft en er een migratie in het bereik zit', async () => {
    // Prod draait v0.10.29, de laatste tag is v0.10.31. Tussen v0.10.29..HEAD zit
    // een migratie. Dit is het scenario uit #455.
    const bepaal: UitkomstBepaler = ({ argumenten }) => {
      if (argumenten[0] === 'diff') return { stdout: 'migrations/0003_x.sql\n' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"status":"ok","version":"0.10.29"}'),
      }),
    );
    const appConfig = await import('../src/app-config.js');
    vi.spyOn(appConfig, 'zoekAppDir').mockReturnValue('/fake-app');
    vi.spyOn(appConfig, 'leesAppConfig').mockReturnValue(fakeConfig());

    await toonMigratieStatus('/fake-app');

    expect(uitvoer.trim()).toBe('ja');
    // Geen waarschuwing want /health was bereikbaar.
    expect(foutenUitvoer).toBe('');
  });

  it('print nee als prod bijgewerkt is en de laatste release geen migratie bevat', async () => {
    // Prod draait v0.10.31, de laatste tag is ook v0.10.31. Geen migratie.
    const bepaal: UitkomstBepaler = () => ({});
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"status":"ok","version":"0.10.31"}'),
      }),
    );
    const appConfig = await import('../src/app-config.js');
    vi.spyOn(appConfig, 'zoekAppDir').mockReturnValue('/fake-app');
    vi.spyOn(appConfig, 'leesAppConfig').mockReturnValue(fakeConfig());

    await toonMigratieStatus('/fake-app');

    expect(uitvoer.trim()).toBe('nee');
  });

  it('valt terug op vorige-tag-logica als /health onbereikbaar is', async () => {
    // /health faalt, dus de gate valt terug op tags[1] als bereikstart.
    const bepaal: UitkomstBepaler = ({ argumenten }) => {
      if (argumenten[0] === 'tag') return { stdout: 'v0.10.31\nv0.10.30\n' };
      // Geen migratie in v0.10.30..HEAD.
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const appConfig = await import('../src/app-config.js');
    vi.spyOn(appConfig, 'zoekAppDir').mockReturnValue('/fake-app');
    vi.spyOn(appConfig, 'leesAppConfig').mockReturnValue(fakeConfig());

    await toonMigratieStatus('/fake-app');

    expect(uitvoer.trim()).toBe('nee');
    // Moet een waarschuwing op stderr schrijven over de terugval.
    expect(foutenUitvoer).toContain('waarschuwing');
    expect(foutenUitvoer).toContain('terugval');
  });

  it('valt terug op vorige-tag-logica als factory.json ontbreekt', async () => {
    // Geen factory.json (bijv. de factory-repo zelf): terugval zonder waarschuwing.
    const bepaal: UitkomstBepaler = ({ argumenten }) => {
      if (argumenten[0] === 'tag') return { stdout: 'v1.0.5\nv1.0.4\n' };
      if (argumenten[0] === 'diff') return { stdout: 'migrations/0001_x.sql\n' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    const appConfig = await import('../src/app-config.js');
    vi.spyOn(appConfig, 'zoekAppDir').mockReturnValue(undefined);

    await toonMigratieStatus('/factory-repo');

    // De factory-repo heeft wél een migratie t.o.v. de vorige tag → ja.
    expect(uitvoer.trim()).toBe('ja');
    // Geen waarschuwing: factory.json ontbreekt is verwacht (de factory zelf).
    expect(foutenUitvoer).toBe('');
  });

  it('print ja bij een nieuwe migratie t.o.v. de vorige tag (terugval)', async () => {
    // Bestaande test: /health onbereikbaar, migratie aanwezig.
    const bepaal: UitkomstBepaler = ({ argumenten }) => {
      if (argumenten[0] === 'tag') return { stdout: 'v0.16.2\nv0.16.1\nv0.16.0\n' };
      if (argumenten[0] === 'diff') return { stdout: 'migrations/0003_x.sql\n' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    const appConfig = await import('../src/app-config.js');
    vi.spyOn(appConfig, 'zoekAppDir').mockReturnValue(undefined);

    await toonMigratieStatus('/repo');
    expect(uitvoer.trim()).toBe('ja');
  });

  it('print nee zonder nieuwe migratie (terugval)', async () => {
    const bepaal: UitkomstBepaler = ({ argumenten }) =>
      argumenten[0] === 'tag' ? { stdout: 'v0.16.2\nv0.16.1\n' } : {};
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    const appConfig = await import('../src/app-config.js');
    vi.spyOn(appConfig, 'zoekAppDir').mockReturnValue(undefined);

    await toonMigratieStatus('/repo');
    expect(uitvoer.trim()).toBe('nee');
  });

  it('print nee bij de eerste release (geen vorige tag, terugval)', async () => {
    const bepaal: UitkomstBepaler = ({ argumenten }) =>
      argumenten[0] === 'tag' ? { stdout: 'v0.1.0\n' } : {};
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    const appConfig = await import('../src/app-config.js');
    vi.spyOn(appConfig, 'zoekAppDir').mockReturnValue(undefined);

    await toonMigratieStatus('/repo');
    expect(uitvoer.trim()).toBe('nee');
    // Zonder vorige tag hoeft er geen diff te draaien.
    expect(aanroepen.some((a) => a.argumenten[0] === 'diff')).toBe(false);
  });
});
