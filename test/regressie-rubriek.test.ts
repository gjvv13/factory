import { describe, expect, it } from 'vitest';
import { formatRubriek, maxPunten, normaliseerScore, REFINE_RUBRIEK } from '../src/eval/rubriek.js';

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
