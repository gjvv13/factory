import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { heeftNieuweMigratie, toonMigratieStatus } from '../src/migratie.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type UitkomstBepaler } from './helpers.js';

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

describe('toonMigratieStatus', () => {
  let uitvoer: string;

  beforeEach(() => {
    uitvoer = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      uitvoer += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('print ja bij een nieuwe migratie t.o.v. de vorige tag', () => {
    const bepaal: UitkomstBepaler = ({ argumenten }) => {
      if (argumenten[0] === 'tag') return { stdout: 'v0.16.2\nv0.16.1\nv0.16.0\n' };
      if (argumenten[0] === 'diff') return { stdout: 'migrations/0003_x.sql\n' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    toonMigratieStatus('/repo');
    expect(uitvoer.trim()).toBe('ja');
  });

  it('print nee zonder nieuwe migratie', () => {
    const bepaal: UitkomstBepaler = ({ argumenten }) =>
      argumenten[0] === 'tag' ? { stdout: 'v0.16.2\nv0.16.1\n' } : {};
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    toonMigratieStatus('/repo');
    expect(uitvoer.trim()).toBe('nee');
  });

  it('print nee bij de eerste release (geen vorige tag)', () => {
    const bepaal: UitkomstBepaler = ({ argumenten }) =>
      argumenten[0] === 'tag' ? { stdout: 'v0.1.0\n' } : {};
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    toonMigratieStatus('/repo');
    expect(uitvoer.trim()).toBe('nee');
    // Zonder vorige tag hoeft er geen diff te draaien.
    expect(aanroepen.some((a) => a.argumenten[0] === 'diff')).toBe(false);
  });
});
