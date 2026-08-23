/**
 * Contract-tests voor de PR-parse in inleveren.ts: `parsePrView` leest url en
 * state uit de JSON-uitvoer van `gh pr view --json url,state`. De test draait de
 * échte parse tegen een opgenomen respons, zodat een wijziging in de gh-uitvoer
 * meteen zichtbaar wordt.
 *
 * De fixtures zijn opgenomen met `scripts/neem-fixtures-op.sh` en worden niet in
 * de poort ververst; dat script is handwerk na een API-wijziging.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePrView } from '../../src/commands/inleveren.js';

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
// parsePrView: gh pr view --json url,state
// ---------------------------------------------------------------------------

describe('parsePrView — gh pr view parse tegen opgenomen respons', () => {
  it('leest url en state uit een PR-respons', () => {
    const json = leesFixture('gh-pr-view-url.json').trim();
    const resultaat = parsePrView(json);

    expect(resultaat).toBeDefined();
    expect(resultaat?.url).toBe('https://github.com/gjvv13/factory/pull/325');
    expect(resultaat?.state).toBe('OPEN');
  });

  it('geeft undefined bij een lege string (geen PR voor deze branch)', () => {
    expect(parsePrView('')).toBeUndefined();
  });
});
