import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { draaiReeks, type ReeksItem } from '../src/reeks.js';
import { standaardPaden, type OrkestratorPaden } from '../src/orkestrator-instellingen.js';
import { GebruikersFout, herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer } from './helpers.js';

/** Een minimale rij van drie items die niet slinkt: de lus stopt op het aantal, niet op de rij. */
function vasteRij(): ReeksItem[] {
  return [
    { issue: 1, app: 'factory', titel: 'een' },
    { issue: 2, app: 'factory', titel: 'twee' },
    { issue: 3, app: 'factory', titel: 'drie' },
  ];
}

describe('draaiReeks — een gestrande inlevering (#282)', () => {
  let home: string;
  let paden: OrkestratorPaden;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-reeks-'));
    paden = standaardPaden(home);
    stelUitvoerderIn(maakUitvoerderOpnemer().uitvoerder);
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    herstelUitvoerder();
  });

  /** De items die de lus zag, in volgorde. */
  function opzetVoor(werkAf: (item: ReeksItem) => { afloop: string }) {
    const gezien: number[] = [];
    return {
      gezien,
      opzet: {
        paden,
        nu: new Date('2026-08-21T12:00:00'),
        soort: 'bouw' as const,
        pot: 'interactief' as const,
        noemer: 'deze reeks',
        aantal: 3,
        leesRij: () => vasteRij(),
        werkAf: (item: ReeksItem) => {
          gezien.push(item.issue);
          return Promise.resolve(werkAf(item));
        },
        beschrijf: (u: { afloop: string }) => ({ uitkomst: u.afloop, kosten: 1 }),
        gelukt: (u: { afloop: string }) => u.afloop === 'klaar',
      },
    };
  }

  it('behandelt een GebruikersFout als een mislukte run en gaat door', async () => {
    const { gezien, opzet } = opzetVoor((item) => {
      if (item.issue === 1) throw new GebruikersFout('main is verder gelopen en botst');
      return { afloop: 'klaar' };
    });
    const uitkomst = await draaiReeks(opzet);

    // #1 strandde, maar #2 en #3 draaiden alsnog.
    expect(gezien).toEqual([1, 2, 3]);
    expect(uitkomst.gedaan).toBe(3);
    expect(uitkomst.geslaagd).toBe(2);
    expect(uitkomst.einde).toBe('aantal');
    // De gestrande run staat mét reden in het log — geboekt, niet verdwenen.
    expect(readFileSync(paden.logPad, 'utf8')).toMatch(/#1 factory bouw afgebroken.*botst/);
  });

  it('stopt alsnog na twee gestrande runs op rij', async () => {
    const { gezien, opzet } = opzetVoor(() => {
      throw new GebruikersFout('kon niet landen');
    });
    const uitkomst = await draaiReeks(opzet);

    expect(gezien).toEqual([1, 2]);
    expect(uitkomst.einde).toBe('twee-mislukt');
  });

  it('laat een echte machinefout wél door — dat is niet "dit item kon niet landen"', async () => {
    const { opzet } = opzetVoor((item) => {
      if (item.issue === 1) throw new Error('spawn claude ENOENT');
      return { afloop: 'klaar' };
    });
    await expect(draaiReeks(opzet)).rejects.toThrow(/ENOENT/);
  });
});
