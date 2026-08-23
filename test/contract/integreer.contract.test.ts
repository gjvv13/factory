/**
 * Contract-tests voor de interpretatie-plekken in integreer.ts: de
 * `gh pr list --json`-parse (wachtrij) en de `package.json`-parse
 * (factory-dependency). Elke test draait de échte parse tegen een opgenomen
 * respons, zodat een wijziging in de structuur meteen zichtbaar wordt.
 *
 * De fixtures zijn opgenomen met `scripts/neem-fixtures-op.sh` en worden niet in
 * de poort ververst; dat script is handwerk na een API-wijziging.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWachtrij, parseFactoryDep } from '../../src/commands/integreer.js';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'contract',
);

function leesFixture(bestand: string): string {
  return readFileSync(path.join(FIXTURES, bestand), 'utf8');
}

// ---------------------------------------------------------------------------
// parseWachtrij: gh pr list --json number,createdAt
// ---------------------------------------------------------------------------

describe('parseWachtrij — gh pr list --json parse tegen opgenomen respons', () => {
  it('leest nummer en createdAt uit meerdere PRs', () => {
    const json = leesFixture('gh-pr-list.json').trim();
    const rij = parseWachtrij(json);

    expect(rij).toHaveLength(3);
    expect(rij[0]).toHaveProperty('nummer');
    expect(rij[0]).toHaveProperty('createdAt');
  });

  it('sorteert de wachtrij op createdAt (oudste eerst)', () => {
    const json = leesFixture('gh-pr-list.json').trim();
    const rij = parseWachtrij(json);

    // De fixture heeft 313 (19 aug), 325 (20 aug), 326 (21 aug) — bewust niet
    // in volgorde in het bestand, zodat de sorteerlogica getoetst wordt.
    expect(rij[0]?.nummer).toBe(313);
    expect(rij[1]?.nummer).toBe(325);
    expect(rij[2]?.nummer).toBe(326);
  });

  it('mapt number naar nummer', () => {
    const json = leesFixture('gh-pr-list.json').trim();
    const rij = parseWachtrij(json);

    // De bron-JSON heeft `number`, de uitvoer `nummer`.
    expect(rij.every((item) => typeof item.nummer === 'number')).toBe(true);
    expect(rij.map((item) => item.nummer)).toEqual([313, 325, 326]);
  });

  it('geeft een lege lijst bij een lege JSON-array', () => {
    const json = leesFixture('gh-pr-list-leeg.json').trim();
    const rij = parseWachtrij(json);

    expect(rij).toEqual([]);
  });

  it('geeft een lege lijst bij een lege string (geen resultaten)', () => {
    expect(parseWachtrij('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseFactoryDep: devDependencies.factory uit package.json
// ---------------------------------------------------------------------------

describe('parseFactoryDep — factory-dependency uit opgenomen package.json', () => {
  it('leest de factory-dependency uit devDependencies', () => {
    const inhoud = leesFixture('app-package.json');
    const dep = parseFactoryDep(inhoud);

    expect(dep).toBe('git+https://github.com/gjvv13/factory.git#v1.15.54');
  });

  it('geeft undefined als devDependencies ontbreekt', () => {
    const inhoud = JSON.stringify({ name: 'test', version: '1.0.0' });

    expect(parseFactoryDep(inhoud)).toBeUndefined();
  });

  it('geeft undefined als factory niet in devDependencies staat', () => {
    const inhoud = JSON.stringify({
      name: 'test',
      devDependencies: { typescript: '^6.0.0' },
    });

    expect(parseFactoryDep(inhoud)).toBeUndefined();
  });

  it('geeft undefined bij een lege string als waarde', () => {
    const inhoud = JSON.stringify({
      devDependencies: { factory: '' },
    });

    expect(parseFactoryDep(inhoud)).toBeUndefined();
  });
});
