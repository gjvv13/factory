import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appsVan,
  GOUDEN_SET_PAD,
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

  it('weigert een bouw-item in slice 1 (alleen refine)', () => {
    expect(() => parseGoudenSet({ items: [geldigItem({ soort: 'bouw' })] }, 'test')).toThrow(
      GebruikersFout,
    );
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

    it('leest de meegeleverde gouden set met minstens drie refine-items', () => {
      const set = leesGoudenSet(GOUDEN_SET_PAD);
      expect(set.items.length).toBeGreaterThanOrEqual(3);
      // Slice 1 evalueert alleen refine; het schema laat niets anders toe.
      expect([...new Set(set.items.map((item) => item.soort))]).toEqual(['refine']);
    });
  });
});
