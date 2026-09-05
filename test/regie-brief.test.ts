/**
 * Unit-tests voor de regie-brief (#404): briefbouw met vaste data, elke sectie
 * gevuld, lege brief, stil-detectie op grensgevallen, en de runlog-parser.
 */
import { describe, expect, it } from 'vitest';
import {
  bouwBrief,
  parseRunlog,
  parseRunlogRegel,
  STIL_DREMPEL_MS,
  type BriefBronnen,
  type DeployRunStatus,
  type EscalatieContext,
  type RunlogEntry,
} from '../src/regie-brief.js';
import type { BacklogItem } from '../src/board.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function maakBronnen(overrides: Partial<BriefBronnen> = {}): BriefBronnen {
  return {
    items: [],
    escalatieNummers: new Set(),
    escalatieContext: [],
    runlog: [],
    deployRuns: [],
    nu: NU,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// bouwBrief
// ---------------------------------------------------------------------------

describe('bouwBrief', () => {
  it('toont "niets te melden" als alles leeg is', () => {
    const tekst = bouwBrief(maakBronnen());
    expect(tekst).toBe('Niets te melden — alles stil.');
  });

  it('toont de sectie "gebouwd/gemergd" met runlog-entries van de afgelopen 24 uur', () => {
    const runlog: RunlogEntry[] = [
      {
        moment: '2026-09-04T20:00:00.000Z',
        issue: 91,
        app: 'assistant',
        soort: 'bouw',
        uitkomst: 'klaar',
        kosten: '$2.09',
      },
    ];
    const tekst = bouwBrief(maakBronnen({ runlog }));

    expect(tekst).toContain('Gebouwd / gemergd');
    expect(tekst).toContain('#91');
    expect(tekst).toContain('assistant');
    expect(tekst).toContain('$2.09');
  });

  it('filtert runlog-entries ouder dan 24 uur weg', () => {
    const runlog: RunlogEntry[] = [
      {
        moment: '2026-09-03T06:00:00.000Z',
        issue: 91,
        app: 'assistant',
        soort: 'bouw',
        uitkomst: 'klaar',
      },
    ];
    const tekst = bouwBrief(maakBronnen({ runlog }));
    expect(tekst).toBe('Niets te melden — alles stil.');
  });

  it('toont de sectie "wacht op akkoord" voor items op akkoord-kolommen, zonder escalaties', () => {
    const items: BacklogItem[] = [
      maakItem({ issue: 42, kolom: 'Technisch refinen', app: 'beheer' }),
      maakItem({ issue: 43, kolom: 'Wacht op akkoord' }),
      // Escalatie: mag niet in deze sectie
      maakItem({ issue: 44, kolom: 'Technisch refinen', labels: ['escalatie'] }),
    ];
    const tekst = bouwBrief(maakBronnen({ items, escalatieNummers: new Set([44]) }));

    expect(tekst).toContain('Wacht op jouw akkoord');
    expect(tekst).toContain('#42');
    expect(tekst).toContain('#43');
    // #44 is geëscaleerd en hoort niet in de akkoord-sectie
    const akkoordSectie = tekst.split('###').find((s) => s.includes('Wacht op jouw akkoord'));
    expect(akkoordSectie).toBeDefined();
    expect(akkoordSectie).not.toContain('#44');
  });

  it('toont de sectie "geëscaleerd" met vraag en advies', () => {
    const items: BacklogItem[] = [
      maakItem({
        issue: 99,
        kolom: 'Klaar voor technische refinement',
        app: 'assistant',
        labels: ['escalatie'],
      }),
    ];
    const escalatieContext: EscalatieContext[] = [
      { issue: 99, vraag: 'Welke tabel?', advies: 'Gebruik de users-tabel.' },
    ];
    const tekst = bouwBrief(
      maakBronnen({
        items,
        escalatieNummers: new Set([99]),
        escalatieContext,
      }),
    );

    expect(tekst).toContain('Geëscaleerd');
    expect(tekst).toContain('#99');
    expect(tekst).toContain('Welke tabel?');
    expect(tekst).toContain('Gebruik de users-tabel.');
  });

  it('toont de sectie "vastgelopen/stil" voor items op een werkkolom met updatedAt > 72 uur', () => {
    // 72 uur vóór NU = 2026-09-02T07:30:00.000Z — een item bijgewerkt op 09-01 is stil.
    const items: BacklogItem[] = [
      maakItem({
        issue: 10,
        kolom: 'Bouwen',
        bijgewerkt: '2026-09-01T00:00:00.000Z',
        app: 'factory',
      }),
    ];
    const tekst = bouwBrief(maakBronnen({ items }));

    expect(tekst).toContain('Vastgelopen / stil');
    expect(tekst).toContain('#10');
    expect(tekst).toContain('factory');
  });

  it('toont geen "vastgelopen/stil" voor items op een niet-werkkolom', () => {
    const items: BacklogItem[] = [
      maakItem({ issue: 10, kolom: 'Idee', bijgewerkt: '2026-08-01T00:00:00.000Z' }),
    ];
    const tekst = bouwBrief(maakBronnen({ items }));
    expect(tekst).toBe('Niets te melden — alles stil.');
  });

  it('toont geen "vastgelopen/stil" voor items die recent zijn bijgewerkt', () => {
    const items: BacklogItem[] = [
      maakItem({ issue: 10, kolom: 'Bouwen', bijgewerkt: '2026-09-04T00:00:00.000Z' }),
    ];
    const tekst = bouwBrief(maakBronnen({ items }));
    // Niet stil: bijgewerkt is minder dan 72 uur geleden
    expect(tekst).not.toContain('Vastgelopen');
  });

  it('72-uur-grenswaarde: exact op de grens telt niet als stil', () => {
    // NU = 2026-09-05T07:30:00.000Z, exact 72 uur eerder = 2026-09-02T07:30:00.000Z
    const items: BacklogItem[] = [
      maakItem({ issue: 10, kolom: 'Bouwen', bijgewerkt: '2026-09-02T07:30:00.000Z' }),
    ];
    const tekst = bouwBrief(maakBronnen({ items }));
    // Exact op de grens: bijgewerkt === grens, niet < grens, dus niet stil
    expect(tekst).not.toContain('Vastgelopen');
  });

  it('72-uur-grenswaarde: één ms voor de grens telt als stil', () => {
    const items: BacklogItem[] = [
      maakItem({ issue: 10, kolom: 'Bouwen', bijgewerkt: '2026-09-02T07:29:59.999Z' }),
    ];
    const tekst = bouwBrief(maakBronnen({ items }));
    expect(tekst).toContain('Vastgelopen');
  });

  it('toont de deploy-status per app', () => {
    const deployRuns: DeployRunStatus[] = [
      {
        app: 'assistant',
        conclusion: 'success',
        url: 'https://github.com/gjvv13/assistant/actions/runs/123',
        createdAt: '2026-09-05T04:00:00.000Z',
      },
      {
        app: 'beheer',
        conclusion: 'failure',
        url: 'https://github.com/gjvv13/beheer/actions/runs/456',
        createdAt: '2026-09-04T20:00:00.000Z',
      },
    ];
    const tekst = bouwBrief(maakBronnen({ deployRuns }));

    expect(tekst).toContain('Laatste deploy per app');
    expect(tekst).toContain('assistant');
    expect(tekst).toContain('✅');
    expect(tekst).toContain('beheer');
    expect(tekst).toContain('❌');
  });

  it('verbergt lege secties (geen ruis)', () => {
    // Alleen een deploy-run, geen andere data
    const deployRuns: DeployRunStatus[] = [
      {
        app: 'assistant',
        conclusion: 'success',
        url: 'https://example.com/run/1',
        createdAt: '2026-09-05T04:00:00.000Z',
      },
    ];
    const tekst = bouwBrief(maakBronnen({ deployRuns }));

    expect(tekst).toContain('Laatste deploy per app');
    expect(tekst).not.toContain('Gebouwd');
    expect(tekst).not.toContain('Wacht op jouw akkoord');
    expect(tekst).not.toContain('Geëscaleerd');
    expect(tekst).not.toContain('Vastgelopen');
  });

  it('toont alle vier secties tegelijk als er data is', () => {
    const items: BacklogItem[] = [
      maakItem({ issue: 42, kolom: 'Wacht op akkoord' }),
      maakItem({ issue: 99, kolom: 'Bouwen', labels: ['escalatie'] }),
      maakItem({ issue: 10, kolom: 'Uitrollen', bijgewerkt: '2026-08-01T00:00:00.000Z' }),
    ];
    const runlog: RunlogEntry[] = [
      {
        moment: '2026-09-05T04:00:00.000Z',
        issue: 91,
        app: 'assistant',
        soort: 'bouw',
        uitkomst: 'klaar',
      },
    ];
    const deployRuns: DeployRunStatus[] = [
      {
        app: 'assistant',
        conclusion: 'success',
        url: 'https://example.com/run/1',
        createdAt: '2026-09-05T04:00:00.000Z',
      },
    ];
    const tekst = bouwBrief(
      maakBronnen({
        items,
        escalatieNummers: new Set([99]),
        escalatieContext: [{ issue: 99, vraag: 'Hoe?', advies: 'Zo.' }],
        runlog,
        deployRuns,
      }),
    );

    expect(tekst).toContain('Gebouwd / gemergd');
    expect(tekst).toContain('Wacht op jouw akkoord');
    expect(tekst).toContain('Geëscaleerd');
    expect(tekst).toContain('Vastgelopen / stil');
    expect(tekst).toContain('Laatste deploy per app');
  });
});

// ---------------------------------------------------------------------------
// parseRunlogRegel
// ---------------------------------------------------------------------------

describe('parseRunlogRegel', () => {
  it('parset een gewone runlog-regel', () => {
    const entry = parseRunlogRegel(
      '2026-09-04T04:12:00.000Z #91 assistant bouw klaar $2.09 14 beurten',
    );
    expect(entry).toEqual({
      moment: '2026-09-04T04:12:00.000Z',
      issue: 91,
      app: 'assistant',
      soort: 'bouw',
      uitkomst: 'klaar',
      kosten: '$2.09',
    });
  });

  it('geeft undefined voor een lege regel', () => {
    expect(parseRunlogRegel('')).toBeUndefined();
  });

  it('geeft undefined voor een ongeldige regel', () => {
    expect(parseRunlogRegel('dit is geen runlog')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseRunlog
// ---------------------------------------------------------------------------

describe('parseRunlog', () => {
  const inhoud = [
    '2026-09-03T04:00:00.000Z #80 factory refine klaar $1.50 8 beurten',
    '2026-09-04T20:00:00.000Z #91 assistant bouw klaar $2.09 14 beurten',
    '2026-09-05T04:00:00.000Z #92 beheer bouw escalatie $0.50 3 beurten',
    '',
  ].join('\n');

  it('filtert op de afgelopen 24 uur', () => {
    const entries = parseRunlog(inhoud, NU);
    // NU = 2026-09-05T07:30:00.000Z, grens = 2026-09-04T07:30:00.000Z
    // #80 valt eruit (2026-09-03), #91 en #92 blijven
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.issue)).toEqual([91, 92]);
  });

  it('levert een lege array bij lege inhoud', () => {
    expect(parseRunlog('', NU)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// STIL_DREMPEL_MS
// ---------------------------------------------------------------------------

describe('STIL_DREMPEL_MS', () => {
  it('is precies 72 uur in milliseconden', () => {
    expect(STIL_DREMPEL_MS).toBe(72 * 60 * 60 * 1000);
  });
});
