import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Dekkingscijfers } from '../src/coverage-merge.js';
import {
  BASISLIJN_BESTAND,
  beoordeelRatchet,
  leesBasislijn,
  schrijfBasislijn,
} from '../src/dekking-basislijn.js';

function maakApp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'factory-ratchet-'));
}

/** Vier gelijke metrics: kort houden in de tests waar alleen de beweging telt. */
function cijfers(waarde: number, overschrijf: Partial<Dekkingscijfers> = {}): Dekkingscijfers {
  return { lines: waarde, statements: waarde, functions: waarde, branches: waarde, ...overschrijf };
}

describe('leesBasislijn / schrijfBasislijn', () => {
  it('leest terug wat is weggeschreven', () => {
    const app = maakApp();
    const c = cijfers(85, { branches: 80 });
    schrijfBasislijn(app, c);
    expect(leesBasislijn(app)).toEqual(c);
  });

  it('geeft undefined als er nog geen basislijn is', () => {
    expect(leesBasislijn(maakApp())).toBeUndefined();
  });

  it('geeft undefined bij een onleesbare basislijn in plaats van te crashen', () => {
    const app = maakApp();
    // Een half metric-object valt buiten het schema: behandelen als afwezig.
    schrijfBasislijn(app, cijfers(90));
    writeFileSync(path.join(app, BASISLIJN_BESTAND), '{ "lines": 90 }');
    expect(leesBasislijn(app)).toBeUndefined();
  });
});

describe('beoordeelRatchet', () => {
  it('bootstrapt zonder basislijn: legt de meting vast, oordeelt niet', () => {
    const nu = cijfers(85);
    const oordeel = beoordeelRatchet(nu, undefined, 0.5);
    expect(oordeel.bootstrap).toBe(true);
    expect(oordeel.regressies).toEqual([]);
    expect(oordeel.nieuweBasislijn).toEqual(nu);
  });

  it('meldt geen regressie binnen de tolerantie', () => {
    const oordeel = beoordeelRatchet(cijfers(84.6), cijfers(85), 0.5);
    expect(oordeel.regressies).toEqual([]);
    expect(oordeel.nieuweBasislijn).toBeUndefined();
  });

  it('meldt een regressie zodra een metric verder dan de tolerantie zakt', () => {
    const oordeel = beoordeelRatchet(cijfers(85, { branches: 84 }), cijfers(85), 0.5);
    expect(oordeel.regressies).toEqual([{ naam: 'branches', nu: 84, was: 85 }]);
  });

  it('verhoogt de basislijn per metric die verder dan de tolerantie stijgt', () => {
    const oordeel = beoordeelRatchet(cijfers(85, { lines: 90 }), cijfers(85), 0.5);
    expect(oordeel.verhogingen).toEqual([{ naam: 'lines', nu: 90, was: 85 }]);
    expect(oordeel.nieuweBasislijn).toEqual(cijfers(85, { lines: 90 }));
  });

  it('verlaagt de basislijn nooit: niet-stijgende metrics behouden hun oude waarde', () => {
    // lines stijgt, branches zakt binnen tolerantie: de nieuwe basislijn houdt branches op 85.
    const oordeel = beoordeelRatchet(cijfers(85, { lines: 90, branches: 84.7 }), cijfers(85), 0.5);
    expect(oordeel.nieuweBasislijn).toEqual(cijfers(85, { lines: 90 }));
  });

  it('legt bij een gelijkblijvende meting niets nieuws vast (geen git-ruis)', () => {
    const oordeel = beoordeelRatchet(cijfers(85), cijfers(85), 0.5);
    expect(oordeel.regressies).toEqual([]);
    expect(oordeel.verhogingen).toEqual([]);
    expect(oordeel.nieuweBasislijn).toBeUndefined();
  });
});
