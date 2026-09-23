import { describe, expect, it } from 'vitest';
import {
  BOUW_RUBRIEK,
  formatRubriek,
  maxPunten,
  normaliseerScore,
  REFINE_RUBRIEK,
} from '../src/eval/rubriek.js';

describe('de refine-rubriek', () => {
  it('heeft zeven criteria met oplopende nummers 1 t/m 7', () => {
    expect(REFINE_RUBRIEK).toHaveLength(7);
    expect(REFINE_RUBRIEK.map((c) => c.nummer)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(maxPunten()).toBe(14);
  });

  it('normaliseert de maximale score naar 10,0', () => {
    expect(normaliseerScore([2, 2, 2, 2, 2, 2, 2])).toBe(10);
  });

  it('normaliseert een lege score naar 0', () => {
    expect(normaliseerScore([0, 0, 0, 0, 0, 0, 0])).toBe(0);
  });

  it('rondt (som / 14) × 10 af op één decimaal', () => {
    // 12 / 14 × 10 = 8,571… → 8,6
    expect(normaliseerScore([2, 2, 1, 2, 2, 2, 1])).toBe(8.6);
    // 7 / 14 × 10 = 5,0
    expect(normaliseerScore([1, 1, 1, 1, 1, 1, 1])).toBe(5);
  });

  it('weigert een score-reeks die niet met de rubriek overeenkomt', () => {
    expect(() => normaliseerScore([2, 2, 2])).toThrow(/verwacht 7 scores/);
  });

  it('giet alle criteria in een leesbare tabel voor de judge-prompt', () => {
    const tabel = formatRubriek();
    for (const criterium of REFINE_RUBRIEK) {
      expect(tabel).toContain(criterium.naam);
    }
    expect(tabel).toContain('| # | Criterium | 0 | 1 | 2 |');
  });
});

describe('de bouw-rubriek', () => {
  it('heeft vijf criteria met oplopende nummers 1 t/m 5', () => {
    expect(BOUW_RUBRIEK).toHaveLength(5);
    expect(BOUW_RUBRIEK.map((c) => c.nummer)).toEqual([1, 2, 3, 4, 5]);
    expect(maxPunten(BOUW_RUBRIEK)).toBe(10);
  });

  it('scoort op criteriadekking, testdekking, laagindeling, verify en verzonnen imports', () => {
    const namen = BOUW_RUBRIEK.map((c) => c.naam);
    expect(namen).toEqual([
      'Criteriadekking',
      'Testdekking',
      'Laagindeling',
      'Verify-resultaat',
      'Geen verzonnen imports',
    ]);
  });

  it('normaliseert over vijf criteria: (som / 10) × 10', () => {
    expect(normaliseerScore([2, 2, 2, 2, 2], BOUW_RUBRIEK)).toBe(10);
    expect(normaliseerScore([0, 0, 0, 0, 0], BOUW_RUBRIEK)).toBe(0);
    // 7 / 10 × 10 = 7,0
    expect(normaliseerScore([2, 2, 1, 1, 1], BOUW_RUBRIEK)).toBe(7);
    // 5 / 10 × 10 = 5,0
    expect(normaliseerScore([1, 1, 1, 1, 1], BOUW_RUBRIEK)).toBe(5);
  });

  it('weigert een score-reeks die niet met de bouw-rubriek overeenkomt', () => {
    expect(() => normaliseerScore([2, 2, 2], BOUW_RUBRIEK)).toThrow(/verwacht 5 scores/);
  });

  it('giet de bouw-criteria in een leesbare tabel', () => {
    const tabel = formatRubriek(BOUW_RUBRIEK);
    for (const criterium of BOUW_RUBRIEK) {
      expect(tabel).toContain(criterium.naam);
    }
  });
});
