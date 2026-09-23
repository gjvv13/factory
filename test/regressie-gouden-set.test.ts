import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appsVan,
  GOUDEN_SET_PAD,
  itemsVanSoort,
  leesGoudenSet,
  parseGoudenSet,
  STANDAARD_JUDGE_EFFORT,
  STANDAARD_JUDGE_MODEL,
} from '../src/eval/gouden-set.js';
import { GebruikersFout } from '../src/shell.js';

function geldigItem(overschrijf: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issue: 803,
    app: 'assistant',
    soort: 'refine',
    titel: 'Een titel',
    body: 'Een bevroren body',
    ...overschrijf,
  };
}

describe('de gouden set', () => {
  it('vult het judge-model en de effort aan met de standaardwaarden', () => {
    const set = parseGoudenSet({ items: [geldigItem()] }, 'test');
    expect(set.judgeModel).toBe(STANDAARD_JUDGE_MODEL);
    expect(set.judgeEffort).toBe(STANDAARD_JUDGE_EFFORT);
  });

  it('behoudt een expliciet judge-model en -effort', () => {
    const set = parseGoudenSet(
      { judgeModel: 'claude-sonnet-4-20250514', judgeEffort: 'low', items: [geldigItem()] },
      'test',
    );
    expect(set.judgeModel).toBe('claude-sonnet-4-20250514');
    expect(set.judgeEffort).toBe('low');
  });

  it('weigert een set zonder items met een GebruikersFout', () => {
    expect(() => parseGoudenSet({ items: [] }, 'test')).toThrow(GebruikersFout);
  });

  it('accepteert sinds slice 2 een bouw-item', () => {
    const set = parseGoudenSet({ items: [geldigItem({ soort: 'bouw' })] }, 'test');
    expect(set.items[0]?.soort).toBe('bouw');
  });

  it('weigert een item met een onbekende soort', () => {
    expect(() => parseGoudenSet({ items: [geldigItem({ soort: 'accepteer' })] }, 'test')).toThrow(
      GebruikersFout,
    );
  });

  it('filtert de items op soort', () => {
    const set = parseGoudenSet(
      {
        items: [
          geldigItem({ issue: 1, soort: 'refine' }),
          geldigItem({ issue: 2, soort: 'bouw' }),
          geldigItem({ issue: 3, soort: 'refine' }),
        ],
      },
      'test',
    );
    expect(itemsVanSoort(set, 'refine').map((i) => i.issue)).toEqual([1, 3]);
    expect(itemsVanSoort(set, 'bouw').map((i) => i.issue)).toEqual([2]);
  });

  it('weigert een item zonder bevroren body', () => {
    expect(() => parseGoudenSet({ items: [geldigItem({ body: '' })] }, 'test')).toThrow(
      GebruikersFout,
    );
  });

  it('leest de unieke apps in volgorde van eerste voorkomen', () => {
    const set = parseGoudenSet(
      {
        items: [
          geldigItem({ app: 'assistant', issue: 1 }),
          geldigItem({ app: 'beheer', issue: 2 }),
          geldigItem({ app: 'assistant', issue: 3 }),
        ],
      },
      'test',
    );
    expect(appsVan(set)).toEqual(['assistant', 'beheer']);
  });

  describe('van schijf', () => {
    let tmp: string;
    beforeEach(() => {
      tmp = mkdtempSync(path.join(os.tmpdir(), 'gouden-set-'));
    });
    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it('faalt luid op een ontbrekend bestand', () => {
      expect(() => leesGoudenSet(path.join(tmp, 'weg.json'))).toThrow(GebruikersFout);
    });

    it('faalt luid op kapotte JSON', () => {
      const pad = path.join(tmp, 'kapot.json');
      writeFileSync(pad, '{ dit is geen json');
      expect(() => leesGoudenSet(pad)).toThrow(GebruikersFout);
    });

    it('leest de meegeleverde gouden set met ≥3 refine- en ≥2 bouw-items', () => {
      const set = leesGoudenSet(GOUDEN_SET_PAD);
      expect(itemsVanSoort(set, 'refine').length).toBeGreaterThanOrEqual(3);
      expect(itemsVanSoort(set, 'bouw').length).toBeGreaterThanOrEqual(2);
      // Sinds slice 2 (#361) staan beide soorten in de gouden set.
      expect(new Set(set.items.map((item) => item.soort))).toEqual(new Set(['refine', 'bouw']));
    });
  });
});
