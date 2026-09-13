import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { draaiReeks, type ReeksContext, type ReeksItem } from '../src/reeks.js';
import { standaardPaden, type OrkestratorPaden } from '../src/orkestrator-instellingen.js';
import {
  GebruikersFout,
  OmgevingsFout,
  herstelUitvoerder,
  stelUitvoerderIn,
} from '../src/shell.js';
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
        beoordeel: (u: { afloop: string }) =>
          (u.afloop === 'klaar' ? 'gelukt' : u.afloop) as 'gelukt' | 'escalatie' | 'mislukt',
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

// ---------------------------------------------------------------------------
// Serieel stapelen per app (#327)
// ---------------------------------------------------------------------------

describe('draaiReeks — reeks-context (positie, #558)', () => {
  let home: string;
  let paden: OrkestratorPaden;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-reeks-positie-'));
    paden = standaardPaden(home);
    stelUitvoerderIn(maakUitvoerderOpnemer().uitvoerder);
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    herstelUitvoerder();
  });

  it('geeft elke run een context met positie en totaal, zonder basis-branch (#558)', async () => {
    const rij: ReeksItem[] = [
      { issue: 10, app: 'factory', titel: 'een' },
      { issue: 20, app: 'factory', titel: 'twee' },
    ];
    const ontvangen: (ReeksContext | undefined)[] = [];

    await draaiReeks({
      paden,
      nu: new Date('2026-08-24T04:00:00'),
      soort: 'bouw',
      pot: 'interactief',
      noemer: 'deze reeks',
      aantal: 2,
      leesRij: () => rij,
      werkAf: (_item, reeks) => {
        ontvangen.push(reeks);
        return Promise.resolve({ afloop: 'klaar' });
      },
      beschrijf: () => ({ uitkomst: 'klaar', kosten: 0 }),
      beoordeel: () => 'gelukt',
    });

    // Sinds #558 stapelen slices niet meer: elke run krijgt positie/totaal, geen basis.
    expect(ontvangen[0]).toEqual({ positie: 1, totaal: 2 });
    expect(ontvangen[1]).toEqual({ positie: 2, totaal: 2 });
    expect(ontvangen[0]).not.toHaveProperty('basis');
  });

  it('neemt de positie over alle apps heen en het totaal uit opzet.aantal', async () => {
    const rij: ReeksItem[] = [
      { issue: 10, app: 'factory', titel: 'een' },
      { issue: 42, app: 'assistant', titel: 'twee' },
      { issue: 20, app: 'factory', titel: 'drie' },
    ];
    const posities: { positie: number; totaal: number }[] = [];

    await draaiReeks({
      paden,
      nu: new Date('2026-08-24T04:00:00'),
      soort: 'bouw',
      pot: 'interactief',
      noemer: 'deze reeks',
      aantal: 5,
      leesRij: () => rij,
      werkAf: (_item, reeks) => {
        if (reeks !== undefined) {
          posities.push({ positie: reeks.positie, totaal: reeks.totaal });
        }
        return Promise.resolve({ afloop: 'klaar' });
      },
      beschrijf: () => ({ uitkomst: 'klaar', kosten: 0 }),
      beoordeel: () => 'gelukt',
    });

    expect(posities).toEqual([
      { positie: 1, totaal: 5 },
      { positie: 2, totaal: 5 },
      { positie: 3, totaal: 5 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Escalaties tellen niet mee voor de noodstop (#383)
// ---------------------------------------------------------------------------

describe('draaiReeks — escalaties tellen niet mee voor de noodstop (#383)', () => {
  let home: string;
  let paden: OrkestratorPaden;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-reeks-esc-'));
    paden = standaardPaden(home);
    stelUitvoerderIn(maakUitvoerderOpnemer().uitvoerder);
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    herstelUitvoerder();
  });

  function opzetMet(afloop: (issue: number) => 'gelukt' | 'escalatie' | 'mislukt') {
    const gezien: number[] = [];
    return {
      gezien,
      opzet: {
        paden,
        nu: new Date('2026-08-26T04:00:00'),
        soort: 'bouw' as const,
        pot: 'interactief' as const,
        noemer: 'deze reeks',
        aantal: 3,
        leesRij: () => vasteRij(),
        werkAf: (item: ReeksItem) => {
          gezien.push(item.issue);
          return Promise.resolve({ afloop: afloop(item.issue) });
        },
        beschrijf: (u: { afloop: string }) => ({ uitkomst: u.afloop, kosten: 0 }),
        beoordeel: (u: { afloop: string }) => u.afloop as 'gelukt' | 'escalatie' | 'mislukt',
      },
    };
  }

  it('een escalatie gevolgd door klaar stopt niet bij de noodstop', async () => {
    const { gezien, opzet } = opzetMet((issue) => (issue === 1 ? 'escalatie' : 'gelukt'));
    const uitkomst = await draaiReeks(opzet);

    // Alle drie gedraaid; de escalatie telde niet als mislukking.
    expect(gezien).toEqual([1, 2, 3]);
    expect(uitkomst.einde).toBe('aantal');
    expect(uitkomst.geslaagd).toBe(2);
  });

  it('twee escalaties op rij stoppen niet — ze zijn geen mislukking', async () => {
    const { gezien, opzet } = opzetMet((issue) => (issue <= 2 ? 'escalatie' : 'gelukt'));
    const uitkomst = await draaiReeks(opzet);

    expect(gezien).toEqual([1, 2, 3]);
    expect(uitkomst.einde).toBe('aantal');
    expect(uitkomst.geslaagd).toBe(1);
  });

  it('een escalatie gevolgd door een mislukking geeft mislukteOpRij 1, niet 2', async () => {
    const { gezien, opzet } = opzetMet((issue) => {
      if (issue === 1) return 'escalatie';
      if (issue === 2) return 'mislukt';
      return 'gelukt';
    });
    const uitkomst = await draaiReeks(opzet);

    // #1 escaleert (niet meegeteld), #2 mislukt (mislukteOpRij=1), #3 slaagt.
    // De noodstop (twee op rij) is niet bereikt.
    expect(gezien).toEqual([1, 2, 3]);
    expect(uitkomst.einde).toBe('aantal');
    expect(uitkomst.geslaagd).toBe(1);
  });

  it('een geworpen OmgevingsFout telt als escalatie, niet als mislukking (#383)', async () => {
    const gezien: number[] = [];
    const uitkomst = await draaiReeks({
      paden,
      nu: new Date('2026-08-26T04:00:00'),
      soort: 'bouw' as const,
      pot: 'interactief' as const,
      noemer: 'deze reeks',
      aantal: 3,
      leesRij: () => vasteRij(),
      werkAf: (item: ReeksItem) => {
        gezien.push(item.issue);
        // De omgeving is stuk vóór de run — een OmgevingsFout, geen inhoudelijke fout.
        if (item.issue <= 2) throw new OmgevingsFout('Kon package.json niet lezen');
        return Promise.resolve({ afloop: 'klaar' });
      },
      beschrijf: (u: { afloop: string }) => ({ uitkomst: u.afloop, kosten: 0 }),
      beoordeel: (u: { afloop: string }) => u.afloop as 'gelukt' | 'escalatie' | 'mislukt',
    });

    // Twee geworpen OmgevingsFouten op rij stoppen de reeks NIET: het zijn escalaties,
    // geen mislukkingen. Zonder de fix zou de noodstop na #2 afgaan (einde 'twee-mislukt').
    expect(gezien).toEqual([1, 2, 3]);
    expect(uitkomst.einde).toBe('aantal');
  });
});
