import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { golf, golfKosten, golfSelectie, type GolfDeps } from '../src/commands/golf.js';
import type { Bouwitem } from '../src/commands/orkestreer-bouw.js';
import type { BacklogItem } from '../src/board.js';

function bouwitem(issue: number, app: string, titel = `Item ${String(issue)}`): Bouwitem {
  return { issue, titel, app, kolom: 'Klaar voor Bouwen', aangemaakt: '2026-09-01', labels: [] };
}

/** Een board-item dat door `bouwWachtrij` heen komt (Klaar voor Bouwen, type:task, met App). */
function bordItem(issue: number, app: string, titel = `Item ${String(issue)}`): BacklogItem {
  return {
    issue,
    titel,
    app,
    kolom: 'Klaar voor Bouwen',
    aangemaakt: '2026-09-01',
    labels: ['type:task'],
  };
}

describe('golfSelectie', () => {
  const rij = [bouwitem(1, 'assistant'), bouwitem(2, 'beheer'), bouwitem(3, 'assistant')];

  it('geeft de hele rij zonder filters', () => {
    const { gekozen, onbekend } = golfSelectie(rij, [], []);
    expect(gekozen.map((i) => i.issue)).toEqual([1, 2, 3]);
    expect(onbekend).toEqual([]);
  });

  it('filtert op app', () => {
    const { gekozen } = golfSelectie(rij, ['assistant'], []);
    expect(gekozen.map((i) => i.issue)).toEqual([1, 3]);
  });

  it('filtert op issue-nummers', () => {
    const { gekozen } = golfSelectie(rij, [], [2, 3]);
    expect(gekozen.map((i) => i.issue)).toEqual([2, 3]);
  });

  it('meldt gevraagde issues die niet in de rij staan als onbekend', () => {
    const { gekozen, onbekend } = golfSelectie(rij, [], [2, 99]);
    expect(gekozen.map((i) => i.issue)).toEqual([2]);
    expect(onbekend).toEqual([99]);
  });

  it('bepaalt onbekend tegen de hele rij, los van het app-filter', () => {
    // #2 (beheer) bestaat wél in de rij maar valt buiten het app-filter: geen onbekende.
    const { gekozen, onbekend } = golfSelectie(rij, ['assistant'], [2]);
    expect(gekozen).toEqual([]);
    expect(onbekend).toEqual([]);
  });
});

describe('golfKosten', () => {
  it('is (bouw + review) per item', () => {
    expect(golfKosten(3, 10, 3)).toBe(39);
    expect(golfKosten(0, 10, 3)).toBe(0);
  });
});

describe('golf', () => {
  let uitvoer: string;

  beforeEach(() => {
    uitvoer = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      uitvoer += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const budget = { bouw: 10, review: 3 };

  it('toont de wachtrij en de kosten bij --dry, zonder te dispatchen', async () => {
    const dispatch = vi.fn(() => 0);
    const deps: GolfDeps = {
      leesBord: () => [bordItem(1, 'assistant'), bordItem(2, 'beheer')],
      dispatch,
      budget,
    };
    await golf({ dry: true }, deps);

    expect(uitvoer).toContain('#1 — Item 1 (assistant)');
    expect(uitvoer).toContain('#2 — Item 2 (beheer)');
    expect(uitvoer).toContain('2 items, ~$26 (~$13/item)');
    expect(uitvoer).toContain('Dry-run');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('weigert boven het plafond van 5 met een filter-tip', async () => {
    const deps: GolfDeps = {
      leesBord: () => Array.from({ length: 6 }, (_, i) => bordItem(i + 1, 'assistant')),
      budget,
    };
    await expect(golf({}, deps)).rejects.toThrow(/plafond van 5/);
  });

  it('meldt een lege wachtrij en dispatcht niets', async () => {
    const dispatch = vi.fn(() => 0);
    await golf({}, { leesBord: () => [], dispatch, budget });
    expect(uitvoer).toContain('Bouw-wachtrij is leeg');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatcht niets als het akkoord nee is', async () => {
    const dispatch = vi.fn(() => 0);
    const deps: GolfDeps = {
      leesBord: () => [bordItem(1, 'assistant')],
      dispatch,
      bevestigFn: () => Promise.resolve(false),
      budget,
    };
    await golf({}, deps);
    expect(uitvoer).toContain('Afgebroken');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('faalt hard als het board niet leesbaar is', async () => {
    await expect(golf({}, { leesBord: () => undefined, budget })).rejects.toThrow(
      /board niet lezen/,
    );
  });

  it('dispatcht serieel na akkoord en vat de uitkomsten samen', async () => {
    const dispatch = vi.fn((item: Bouwitem) => (item.issue === 2 ? 1 : 0));
    const leesUitkomst = vi.fn((item: Bouwitem, code: number) => {
      if (code !== 0) return 'mislukt' as const;
      return item.issue === 3 ? ('geëscaleerd' as const) : ('geslaagd' as const);
    });
    const boekFn = vi.fn();
    const deps: GolfDeps = {
      leesBord: () => [bordItem(1, 'assistant'), bordItem(2, 'beheer'), bordItem(3, 'assistant')],
      dispatch,
      leesUitkomst,
      bevestigFn: () => Promise.resolve(true),
      boekFn,
      budget,
    };

    await golf({}, deps);

    // Serieel: elk item één dispatch en één boeking.
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(boekFn).toHaveBeenCalledTimes(3);
    // #1 geslaagd, #2 mislukt (exit 1), #3 geëscaleerd.
    expect(uitvoer).toContain('1 geslaagd, 1 geëscaleerd, 1 mislukt (van 3)');
    expect(uitvoer).toContain('factory brief');
  });

  it('gaat door na een falende build (faal-door, niet faal-stop)', async () => {
    const dispatch = vi.fn(() => 1); // alles faalt
    const deps: GolfDeps = {
      leesBord: () => [bordItem(1, 'assistant'), bordItem(2, 'assistant')],
      dispatch,
      bevestigFn: () => Promise.resolve(true),
      boekFn: () => undefined,
      budget,
    };

    await golf({}, deps);

    expect(dispatch).toHaveBeenCalledTimes(2); // de eerste fout stopt de golf niet
    expect(uitvoer).toContain('0 geslaagd, 0 geëscaleerd, 2 mislukt (van 2)');
  });
});
