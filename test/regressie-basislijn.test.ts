import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  beoordeelItem,
  EVAL_TOLERANTIE,
  leesBasislijn,
  schrijfBasislijn,
  type EvalBasislijn,
} from '../src/eval/basislijn.js';

describe('de eval-basislijn-ratchet', () => {
  it('bootstrapt zonder basislijn: eerste meting, geen oordeel', () => {
    const oordeel = beoordeelItem(7.5, undefined);
    expect(oordeel.bootstrap).toBe(true);
    expect(oordeel.regressie).toBe(false);
    expect(oordeel.winst).toBe(false);
  });

  it('meldt een regressie als het totaal verder dan de tolerantie onder de basislijn zakt', () => {
    // 8,0 < 9,0 − 0,5 → regressie
    const oordeel = beoordeelItem(8.0, 9.0);
    expect(oordeel.regressie).toBe(true);
    expect(oordeel.winst).toBe(false);
  });

  it('vangt ruis binnen de tolerantie op zonder te oordelen', () => {
    // 8,6 ligt binnen 0,5 van 9,0 → geen regressie, geen winst
    const oordeel = beoordeelItem(8.6, 9.0);
    expect(oordeel.regressie).toBe(false);
    expect(oordeel.winst).toBe(false);
  });

  it('laat de lat omhoog schuiven bij winst boven de tolerantie', () => {
    // 9,6 > 9,0 + 0,5 → winst
    const oordeel = beoordeelItem(9.6, 9.0);
    expect(oordeel.winst).toBe(true);
    expect(oordeel.regressie).toBe(false);
  });

  it('gebruikt 0,5 punt als standaardtolerantie', () => {
    expect(EVAL_TOLERANTIE).toBe(0.5);
    // Precies op de grens (was − tol) telt niet als regressie: strikt kleiner.
    expect(beoordeelItem(8.5, 9.0).regressie).toBe(false);
  });

  describe('lezen en schrijven', () => {
    let tmp: string;
    beforeEach(() => {
      tmp = mkdtempSync(path.join(os.tmpdir(), 'eval-basislijn-'));
    });
    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it('behandelt een ontbrekend bestand als een lege basislijn', () => {
      expect(leesBasislijn(path.join(tmp, 'weg.json'))).toEqual({});
    });

    it('behandelt een kapot bestand als afwezig, niet als een fout', () => {
      const pad = path.join(tmp, 'kapot.json');
      writeFileSync(pad, 'geen json');
      expect(leesBasislijn(pad)).toEqual({});
    });

    it('schrijft op issue-nummer numeriek gesorteerd met een sluitende newline', () => {
      const pad = path.join(tmp, 'basislijn.json');
      const basislijn: EvalBasislijn = {
        '512': { totaal: 7.1, criteria: [1, 2, 1, 1, 1, 2, 2], tijdstempel: 'toen' },
        '73': { totaal: 8.6, criteria: [2, 2, 1, 2, 2, 2, 1], tijdstempel: 'toen' },
      };
      schrijfBasislijn(pad, basislijn);
      const rauw = readFileSync(pad, 'utf8');
      expect(rauw.endsWith('\n')).toBe(true);
      // 73 hoort vóór 512 te staan (numeriek, niet lexicografisch).
      expect(rauw.indexOf('"73"')).toBeLessThan(rauw.indexOf('"512"'));
      expect(leesBasislijn(pad)).toEqual(basislijn);
    });
  });
});
