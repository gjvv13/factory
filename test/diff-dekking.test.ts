import { readFileSync } from 'node:fs';
import path from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import type { CoverageMapData } from 'istanbul-lib-coverage';
import { describe, expect, it } from 'vitest';
import { berekenDiffDekking, parseDiffRegels } from '../src/diff-dekking.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'diff');

function leesFixture(naam: string): string {
  return readFileSync(path.join(FIXTURES, naam), 'utf8');
}

/**
 * Bouwt een istanbul CoverageMapData voor één bestand. `regels` is een record van
 * regelnummer → hitcount; regels die ontbreken tellen als niet-uitvoerbaar.
 */
function maakCoverageData(absoluutPad: string, regels: Record<number, number>): CoverageMapData {
  const statementMap: Record<string, unknown> = {};
  const s: Record<string, number> = {};
  let idx = 0;
  for (const [regel, hits] of Object.entries(regels)) {
    const key = String(idx++);
    const line = Number(regel);
    statementMap[key] = {
      start: { line, column: 0 },
      end: { line, column: 10 },
    };
    s[key] = hits;
  }
  return {
    [absoluutPad]: {
      path: absoluutPad,
      statementMap,
      fnMap: {},
      branchMap: {},
      s,
      f: {},
      b: {},
    },
  } as unknown as CoverageMapData;
}

// ---------------------------------------------------------------------------
// parseDiffRegels
// ---------------------------------------------------------------------------

describe('parseDiffRegels', () => {
  it('parseert een nieuw bestand met alle toegevoegde regels', () => {
    const result = parseDiffRegels(leesFixture('nieuw-bestand.diff'));

    expect(result.size).toBe(1);
    const regels = result.get('src/nieuw.ts');
    expect(regels).toBeDefined();
    // @@ -0,0 +1,4 @@ → regels 1 t/m 4
    expect([...regels!].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it('parseert een wijziging met meerdere hunks', () => {
    const result = parseDiffRegels(leesFixture('wijziging.diff'));

    expect(result.size).toBe(1);
    const regels = result.get('src/bestaand.ts');
    expect(regels).toBeDefined();
    // Hunk 1: @@ -3,0 +4,2 @@ → regels 4, 5
    // Hunk 2: @@ -10,0 +13 @@ → regel 13 (count afwezig = 1)
    expect([...regels!].sort((a, b) => a - b)).toEqual([4, 5, 13]);
  });

  it('parseert een hernoeming en gebruikt het nieuwe pad', () => {
    const result = parseDiffRegels(leesFixture('hernoeming.diff'));

    expect(result.size).toBe(1);
    // Het oude pad (src/oud.ts) mag niet voorkomen.
    expect(result.has('src/oud.ts')).toBe(false);
    const regels = result.get('src/nieuw-naam.ts');
    expect(regels).toBeDefined();
    expect([...regels!]).toEqual([6]);
  });

  it('slaat een pure verwijdering over', () => {
    const result = parseDiffRegels(leesFixture('pure-verwijdering.diff'));

    // Verwijderd bestand: +++ /dev/null → geen entry.
    expect(result.size).toBe(0);
  });

  it('combineert meerdere bestanden en slaat verwijderingen over', () => {
    const result = parseDiffRegels(leesFixture('meerdere-bestanden.diff'));

    // a.ts: wijziging, b.ts: nieuw, c.ts: verwijderd → 2 entries
    expect(result.size).toBe(2);
    expect(result.has('src/a.ts')).toBe(true);
    expect(result.has('src/b.ts')).toBe(true);
    expect(result.has('src/c.ts')).toBe(false);

    expect([...result.get('src/a.ts')!].sort((a, b) => a - b)).toEqual([2, 3]);
    expect([...result.get('src/b.ts')!].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('geeft een lege map bij lege invoer', () => {
    expect(parseDiffRegels('').size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// berekenDiffDekking
// ---------------------------------------------------------------------------

describe('berekenDiffDekking', () => {
  const REPO = '/repo';

  it('geeft undefined percentage bij een lege diff', () => {
    const map = libCoverage.createCoverageMap({});
    const result = berekenDiffDekking(new Map(), map, REPO);

    expect(result.percentage).toBeUndefined();
    expect(result.totaalRegels).toBe(0);
    expect(result.gedekteRegels).toBe(0);
    expect(result.ongedektPerBestand.size).toBe(0);
  });

  it('berekent volledige dekking als alle gewijzigde regels geraakt zijn', () => {
    const absoluut = path.resolve(REPO, 'src/foo.ts');
    const coverageData = maakCoverageData(absoluut, { 1: 3, 2: 1, 3: 5 });
    const map = libCoverage.createCoverageMap(coverageData);

    const diff = new Map([['src/foo.ts', new Set([1, 2, 3])]]);
    const result = berekenDiffDekking(diff, map, REPO);

    expect(result.percentage).toBe(100);
    expect(result.totaalRegels).toBe(3);
    expect(result.gedekteRegels).toBe(3);
    expect(result.ongedektPerBestand.size).toBe(0);
  });

  it('berekent gedeeltelijke dekking met ongedekte regels', () => {
    const absoluut = path.resolve(REPO, 'src/foo.ts');
    // Regel 1: gedekt (hits=2), regel 2: ongedekt (hits=0), regel 3: gedekt (hits=1)
    const coverageData = maakCoverageData(absoluut, { 1: 2, 2: 0, 3: 1 });
    const map = libCoverage.createCoverageMap(coverageData);

    const diff = new Map([['src/foo.ts', new Set([1, 2, 3])]]);
    const result = berekenDiffDekking(diff, map, REPO);

    expect(result.percentage).toBeCloseTo(66.67, 1);
    expect(result.totaalRegels).toBe(3);
    expect(result.gedekteRegels).toBe(2);
    expect(result.ongedektPerBestand.get('src/foo.ts')).toEqual([2]);
  });

  it('sluit niet-uitvoerbare regels uit van de telling', () => {
    const absoluut = path.resolve(REPO, 'src/foo.ts');
    // Alleen regel 2 en 4 zijn uitvoerbaar; regel 1 en 3 staan niet in de coverage-map.
    const coverageData = maakCoverageData(absoluut, { 2: 1, 4: 0 });
    const map = libCoverage.createCoverageMap(coverageData);

    const diff = new Map([['src/foo.ts', new Set([1, 2, 3, 4])]]);
    const result = berekenDiffDekking(diff, map, REPO);

    // 1 van 2 meetbare regels gedekt → 50%
    expect(result.percentage).toBe(50);
    expect(result.totaalRegels).toBe(2);
    expect(result.gedekteRegels).toBe(1);
    expect(result.ongedektPerBestand.get('src/foo.ts')).toEqual([4]);
  });

  it('telt een bestand dat niet in de coverage-map zit als volledig ongedekt', () => {
    // Lege coverage-map: het bestand is niet gemeten.
    const map = libCoverage.createCoverageMap({});

    const diff = new Map([['src/ongemeten.ts', new Set([1, 2, 3])]]);
    const result = berekenDiffDekking(diff, map, REPO);

    expect(result.percentage).toBe(0);
    expect(result.totaalRegels).toBe(3);
    expect(result.gedekteRegels).toBe(0);
    expect(result.ongedektPerBestand.get('src/ongemeten.ts')).toEqual([1, 2, 3]);
  });

  it('combineert gemeten en niet-gemeten bestanden correct', () => {
    const absoluut = path.resolve(REPO, 'src/gemeten.ts');
    // gemeten.ts: regel 1 gedekt, regel 2 ongedekt
    const coverageData = maakCoverageData(absoluut, { 1: 1, 2: 0 });
    const map = libCoverage.createCoverageMap(coverageData);

    const diff = new Map([
      ['src/gemeten.ts', new Set([1, 2])],
      ['src/niet-gemeten.ts', new Set([10, 11])],
    ]);
    const result = berekenDiffDekking(diff, map, REPO);

    // Gemeten: 1 gedekt, 1 ongedekt. Niet-gemeten: 2 ongedekt. Totaal: 1/4 = 25%.
    expect(result.percentage).toBe(25);
    expect(result.totaalRegels).toBe(4);
    expect(result.gedekteRegels).toBe(1);
    expect(result.ongedektPerBestand.get('src/gemeten.ts')).toEqual([2]);
    expect(result.ongedektPerBestand.get('src/niet-gemeten.ts')).toEqual([10, 11]);
  });

  it('geeft undefined percentage als alle gewijzigde regels niet-uitvoerbaar zijn', () => {
    const absoluut = path.resolve(REPO, 'src/types.ts');
    // Het bestand zit in de coverage-map, maar geen van de gewijzigde regels is uitvoerbaar.
    const coverageData = maakCoverageData(absoluut, { 10: 1 });
    const map = libCoverage.createCoverageMap(coverageData);

    const diff = new Map([['src/types.ts', new Set([1, 2, 3])]]);
    const result = berekenDiffDekking(diff, map, REPO);

    expect(result.percentage).toBeUndefined();
    expect(result.totaalRegels).toBe(0);
  });
});
