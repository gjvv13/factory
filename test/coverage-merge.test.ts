import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { schrijfGecombineerdeDekking } from '../src/coverage-merge.js';

function maakApp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'factory-merge-'));
}

/**
 * Bouwt een istanbul `coverage-final.json` voor één bestand met een statement per regel.
 * `hits[i]` is het aantal keer dat regel i+1 geraakt is (0 = ongedekt).
 */
function finalVoor(bestand: string, hits: readonly number[]): unknown {
  const statementMap: Record<string, unknown> = {};
  const s: Record<string, number> = {};
  hits.forEach((hit, i) => {
    statementMap[String(i)] = {
      start: { line: i + 1, column: 0 },
      end: { line: i + 1, column: 5 },
    };
    s[String(i)] = hit;
  });
  return { [bestand]: { path: bestand, statementMap, fnMap: {}, branchMap: {}, s, f: {}, b: {} } };
}

function schrijfFinal(appDir: string, soort: string, data: unknown): void {
  const dir = path.join(appDir, 'coverage', soort);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'coverage-final.json'), JSON.stringify(data));
}

describe('schrijfGecombineerdeDekking', () => {
  it('geeft undefined als er geen enkele coverage-final.json is', () => {
    expect(schrijfGecombineerdeDekking(maakApp())).toBeUndefined();
  });

  it('merget de per-soort-maps: een regel die door één soort geraakt is, telt als gedekt', () => {
    const app = maakApp();
    const bestand = path.join(app, 'app', 'src', 'foo.ts');
    // Zelfde bestand, drie regels. Unit dekt regel 1; e2e dekt regel 1 en 2; regel 3 blijft leeg.
    schrijfFinal(app, 'unit', finalVoor(bestand, [1, 0, 0]));
    schrijfFinal(app, 'e2e', finalVoor(bestand, [1, 1, 0]));

    const resultaat = schrijfGecombineerdeDekking(app);

    // 2 van 3 regels gedekt na de merge (regel 1 door beide, niet dubbel geteld).
    const summary = JSON.parse(
      readFileSync(path.join(app, 'coverage', 'combined', 'coverage-summary.json'), 'utf8'),
    ) as { total: { lines: { total: number; covered: number; pct: number } } };
    expect(summary.total.lines.total).toBe(3);
    expect(summary.total.lines.covered).toBe(2);
    expect(resultaat?.cijfers.lines).toBeCloseTo(66.67, 1);
  });

  it('met verwacht en alle bestanden aanwezig merget correct', () => {
    const app = maakApp();
    const bestand = path.join(app, 'app', 'src', 'foo.ts');
    schrijfFinal(app, 'unit', finalVoor(bestand, [1, 0, 0]));
    schrijfFinal(app, 'e2e', finalVoor(bestand, [1, 1, 0]));

    const resultaat = schrijfGecombineerdeDekking(app, ['unit', 'e2e']);

    expect(resultaat).toBeDefined();
    // 2 van 3 regels gedekt
    expect(resultaat?.cijfers.lines).toBeCloseTo(66.67, 1);
  });

  it('met verwacht en één ontbrekend bestand geeft undefined', () => {
    const app = maakApp();
    const bestand = path.join(app, 'app', 'src', 'foo.ts');
    schrijfFinal(app, 'unit', finalVoor(bestand, [1, 1]));
    // e2e coverage-final.json ontbreekt

    const resultaat = schrijfGecombineerdeDekking(app, ['unit', 'e2e']);

    expect(resultaat).toBeUndefined();
  });

  it('met verwacht negeert een coverage-bestand van een niet-verwachte soort', () => {
    const app = maakApp();
    const bestand = path.join(app, 'app', 'src', 'foo.ts');
    // unit: alle 3 regels gedekt
    schrijfFinal(app, 'unit', finalVoor(bestand, [1, 1, 1]));
    // stale e2e data die niet in verwacht staat en het cijfer zou verlagen
    schrijfFinal(app, 'e2e', finalVoor(bestand, [0, 0, 0]));

    const resultaat = schrijfGecombineerdeDekking(app, ['unit']);

    expect(resultaat).toBeDefined();
    // Alleen unit: 3/3 = 100%
    expect(resultaat?.cijfers.statements).toBe(100);
  });

  it('zonder verwacht behoudt het bestaande gedrag: alle SOORTEN, ontbrekende overslaan', () => {
    const app = maakApp();
    const bestand = path.join(app, 'app', 'src', 'foo.ts');
    // Alleen unit aanwezig; contract en e2e ontbreken
    schrijfFinal(app, 'unit', finalVoor(bestand, [1, 1]));

    const resultaat = schrijfGecombineerdeDekking(app);

    // Geen undefined, want zonder verwacht worden ontbrekende soorten overgeslagen
    expect(resultaat).toBeDefined();
    expect(resultaat?.cijfers.lines).toBe(100);
  });

  it('geeft de onderliggende CoverageMap terug naast de cijfers', () => {
    const app = maakApp();
    const bestand = path.join(app, 'app', 'src', 'foo.ts');
    schrijfFinal(app, 'unit', finalVoor(bestand, [1, 0]));

    const resultaat = schrijfGecombineerdeDekking(app);

    expect(resultaat).toBeDefined();
    expect(resultaat!.coverageMap.files()).toContain(bestand);
    expect(resultaat!.cijfers.lines).toBe(50);
  });

  it('schrijft een gecombineerd rapport op de vaste plek', () => {
    const app = maakApp();
    schrijfFinal(app, 'unit', finalVoor(path.join(app, 'app', 'src', 'foo.ts'), [1, 1]));

    schrijfGecombineerdeDekking(app);

    expect(existsSync(path.join(app, 'coverage', 'combined', 'coverage-summary.json'))).toBe(true);
    expect(existsSync(path.join(app, 'coverage', 'combined', 'index.html'))).toBe(true);
  });
});
