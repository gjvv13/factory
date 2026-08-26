import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { draaiReeks, type ReeksContext, type ReeksItem } from '../src/reeks.js';
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

describe('draaiReeks — serieel stapelen per app (#327)', () => {
  let home: string;
  let paden: OrkestratorPaden;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-reeks-stack-'));
    paden = standaardPaden(home);
    stelUitvoerderIn(maakUitvoerderOpnemer().uitvoerder);
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    herstelUitvoerder();
  });

  /** Branchnaam van een item, zoals `bouwBranch` in orkestreer-bouw.ts. */
  const branchVan = (item: ReeksItem): string => `slice/${String(item.issue)}-1`;

  it('geeft het tweede item in dezelfde app de branch van het eerste als basis', async () => {
    const rij: ReeksItem[] = [
      { issue: 10, app: 'factory', titel: 'eerste' },
      { issue: 20, app: 'factory', titel: 'tweede' },
      { issue: 30, app: 'factory', titel: 'derde' },
    ];
    const ontvangen: (ReeksContext | undefined)[] = [];

    await draaiReeks({
      paden,
      nu: new Date('2026-08-24T04:00:00'),
      soort: 'bouw',
      pot: 'interactief',
      noemer: 'deze reeks',
      aantal: 3,
      leesRij: () => rij,
      branchVan,
      werkAf: (_item, reeks) => {
        ontvangen.push(reeks);
        return Promise.resolve({ afloop: 'klaar' });
      },
      beschrijf: () => ({ uitkomst: 'klaar', kosten: 0 }),
      beoordeel: () => 'gelukt',
    });

    // Eerste item: geen basis (start van origin/main).
    expect(ontvangen[0]).toMatchObject({ basis: undefined, basisIssue: undefined, positie: 1 });
    // Tweede item: basis is de branch van #10.
    expect(ontvangen[1]).toMatchObject({ basis: 'slice/10-1', basisIssue: 10, positie: 2 });
    // Derde item: basis is de branch van #20.
    expect(ontvangen[2]).toMatchObject({ basis: 'slice/20-1', basisIssue: 20, positie: 3 });
  });

  it('stapelt items in verschillende apps onafhankelijk van elkaar', async () => {
    const rij: ReeksItem[] = [
      { issue: 10, app: 'factory', titel: 'factory-een' },
      { issue: 42, app: 'assistant', titel: 'assistant-een' },
      { issue: 20, app: 'factory', titel: 'factory-twee' },
    ];
    const ontvangen: { issue: number; reeks: ReeksContext | undefined }[] = [];

    await draaiReeks({
      paden,
      nu: new Date('2026-08-24T04:00:00'),
      soort: 'bouw',
      pot: 'interactief',
      noemer: 'deze reeks',
      aantal: 3,
      leesRij: () => rij,
      branchVan,
      werkAf: (item, reeks) => {
        ontvangen.push({ issue: item.issue, reeks });
        return Promise.resolve({ afloop: 'klaar' });
      },
      beschrijf: () => ({ uitkomst: 'klaar', kosten: 0 }),
      beoordeel: () => 'gelukt',
    });

    // factory #10: eerste in factory, geen basis.
    expect(ontvangen[0]?.reeks?.basis).toBeUndefined();
    // assistant #42: eerste in assistant, geen basis.
    expect(ontvangen[1]?.reeks?.basis).toBeUndefined();
    // factory #20: tweede in factory, basis is de branch van #10.
    expect(ontvangen[2]?.reeks).toMatchObject({ basis: 'slice/10-1', basisIssue: 10 });
  });

  it('slaat een mislukt item over in de keten — het volgende vertrekt van het laatst geslaagde', async () => {
    const rij: ReeksItem[] = [
      { issue: 10, app: 'factory', titel: 'slaagt' },
      { issue: 20, app: 'factory', titel: 'faalt' },
      { issue: 30, app: 'factory', titel: 'slaagt ook' },
    ];
    const ontvangen: { issue: number; basis: string | undefined }[] = [];

    await draaiReeks({
      paden,
      nu: new Date('2026-08-24T04:00:00'),
      soort: 'bouw',
      pot: 'interactief',
      noemer: 'deze reeks',
      aantal: 3,
      leesRij: () => rij,
      branchVan,
      werkAf: (item, reeks) => {
        ontvangen.push({ issue: item.issue, basis: reeks?.basis });
        return Promise.resolve({ afloop: item.issue === 20 ? 'mislukt' : 'klaar' });
      },
      beschrijf: () => ({ uitkomst: 'klaar', kosten: 0 }),
      beoordeel: (u) =>
        (u.afloop === 'klaar' ? 'gelukt' : u.afloop) as 'gelukt' | 'escalatie' | 'mislukt',
    });

    // #10 slaagt, basis is undefined (eerste).
    expect(ontvangen[0]?.basis).toBeUndefined();
    // #20 krijgt basis van #10, maar faalt.
    expect(ontvangen[1]?.basis).toBe('slice/10-1');
    // #30 krijgt basis van #10 (niet #20, want die mislukte).
    expect(ontvangen[2]?.basis).toBe('slice/10-1');
  });

  it('geeft geen ReeksContext als branchVan niet gezet is', async () => {
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
      // Bewust geen branchVan: het bestaande gedrag.
      werkAf: (_item, reeks) => {
        ontvangen.push(reeks);
        return Promise.resolve({ afloop: 'klaar' });
      },
      beschrijf: () => ({ uitkomst: 'klaar', kosten: 0 }),
      beoordeel: () => 'gelukt',
    });

    expect(ontvangen[0]).toBeUndefined();
    expect(ontvangen[1]).toBeUndefined();
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
      branchVan,
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
});
