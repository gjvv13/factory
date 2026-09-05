/**
 * Unit-tests voor de I/O-orkestratie van `factory brief` (#404): het commando
 * zelf (`brief`) en de escalatie-context-ophaler (`haalEscalatieContext`). De
 * pure briefbouw staat in `regie-brief.test.ts`, het deploy-run-parsen in
 * `brief.test.ts`; hier mocken we de bronnen en toetsen we dat de orkestratie
 * ze correct samenbrengt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// brief.ts leest zijn bronnen uit deze modules; we vervangen alleen de
// I/O-randen en laten de pure logica (regie-brief.ts) echt draaien.
vi.mock('../src/board.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bordItems: vi.fn(),
  escalaties: vi.fn(),
  appOpties: vi.fn(),
  orkestratorComments: vi.fn(),
}));
vi.mock('../src/orkestrator-instellingen.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  standaardPaden: vi.fn(),
}));
vi.mock('../src/shell.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uitvoerVan: vi.fn(),
}));
// brief.ts gebruikt alleen leesEscalatie uit orkestreer.js — de rest van die
// (zware) module hoeven we niet te laden.
vi.mock('../src/commands/orkestreer.js', () => ({ leesEscalatie: vi.fn() }));

import { appOpties, bordItems, escalaties, orkestratorComments } from '../src/board.js';
import type { BacklogItem } from '../src/board.js';
import { standaardPaden } from '../src/orkestrator-instellingen.js';
import { uitvoerVan } from '../src/shell.js';
import { leesEscalatie } from '../src/commands/orkestreer.js';
import { brief, haalEscalatieContext } from '../src/commands/brief.js';

const NU = new Date('2026-09-05T07:30:00.000Z');

function maakItem(overrides: Partial<BacklogItem> & { issue: number }): BacklogItem {
  return {
    titel: `Item ${String(overrides.issue)}`,
    kolom: 'Bouwen',
    aangemaakt: '2026-08-01T00:00:00.000Z',
    labels: [],
    ...overrides,
  };
}

function vangStdout(): string[] {
  const uit: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
    uit.push(String(tekst));
    return true;
  });
  return uit;
}

describe('brief', () => {
  beforeEach(() => {
    vi.mocked(standaardPaden).mockReturnValue({
      // Alleen logPad wordt gelezen; een niet-bestaand pad dwingt de lees-catch af.
      logPad: '/tmp/factory-brief-bestaat-niet-xyz.log',
    } as ReturnType<typeof standaardPaden>);
    vi.mocked(uitvoerVan).mockReturnValue(
      JSON.stringify([
        {
          conclusion: 'success',
          createdAt: '2026-09-05T05:30:00.000Z',
          url: 'https://github.com/gjvv13/assistant/actions/runs/1',
        },
      ]),
    );
    vi.mocked(orkestratorComments).mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leest de bronnen en schrijft de opgebouwde brief naar stdout', () => {
    const uit = vangStdout();
    // Een oud-bijgewerkt item op een werkkolom vult de "vastgelopen/stil"-sectie,
    // zodat de brief gegarandeerd inhoud heeft.
    vi.mocked(bordItems).mockReturnValue([
      maakItem({
        issue: 91,
        app: 'assistant',
        kolom: 'Bouwen',
        bijgewerkt: '2026-08-01T00:00:00.000Z',
      }),
    ]);
    vi.mocked(escalaties).mockReturnValue(new Set<number>());
    vi.mocked(appOpties).mockReturnValue(['assistant']);

    brief(NU);

    const tekst = uit.join('');
    expect(tekst).not.toBe('');
    expect(tekst).toContain('91');
    // De deploy-run-status is via de echte ghRunList-wrapper (gemockte shell) gehaald.
    expect(vi.mocked(uitvoerVan)).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['run', 'list', '--repo', 'gjvv13/assistant']),
    );
  });

  it('waarschuwt en stopt als het board niet leesbaar is', () => {
    const uit = vangStdout();
    vi.mocked(bordItems).mockReturnValue(undefined);

    brief(NU);

    expect(uit.join('')).toContain('board kon niet worden gelezen');
  });
});

describe('haalEscalatieContext', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pakt de laatste escalatie met vraag en advies uit de comments', () => {
    vi.mocked(orkestratorComments).mockReturnValue(['oude comment', 'nieuwe escalatie']);
    vi.mocked(leesEscalatie).mockImplementation((comment: string) =>
      comment === 'nieuwe escalatie'
        ? ({ vraag: 'Welke tabel?', advies: 'Gebruik users.' } as ReturnType<typeof leesEscalatie>)
        : undefined,
    );

    const context = haalEscalatieContext([maakItem({ issue: 99 })]);

    expect(context).toEqual([{ issue: 99, vraag: 'Welke tabel?', advies: 'Gebruik users.' }]);
  });

  it('geeft niets terug als geen comment een escalatie bevat', () => {
    vi.mocked(orkestratorComments).mockReturnValue(['losse comment']);
    vi.mocked(leesEscalatie).mockReturnValue(undefined);

    const context = haalEscalatieContext([maakItem({ issue: 42 })]);

    expect(context).toEqual([]);
  });
});
