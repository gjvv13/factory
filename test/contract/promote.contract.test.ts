/**
 * Contract-tests voor de versie-parse in promote.ts: `versieUitHealth` leest de
 * versie uit een /health-JSON-body. De test draait de échte parse tegen opgenomen
 * bodies, zodat een wijziging in de health-structuur meteen zichtbaar wordt.
 *
 * De fixtures zijn opgenomen met `scripts/neem-fixtures-op.sh` en worden niet in
 * de poort ververst; dat script is handwerk na een API-wijziging.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { versieUitHealth } from '../../src/commands/promote.js';

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
// versieUitHealth: versie uit /health-JSON-body
// ---------------------------------------------------------------------------

describe('versieUitHealth — versie-parse tegen opgenomen /health-body', () => {
  it('leest de versie uit een body met een version-veld', () => {
    const body = leesFixture('health-body.json').trim();
    const versie = versieUitHealth(body);

    expect(versie).toBe('1.15.54');
  });

  it('geeft undefined bij een body zonder version-veld', () => {
    const body = leesFixture('health-body-zonder-versie.json').trim();
    const versie = versieUitHealth(body);

    expect(versie).toBeUndefined();
  });

  it('geeft undefined bij een version die geen string is', () => {
    expect(versieUitHealth('{"version":42}')).toBeUndefined();
    expect(versieUitHealth('{"version":null}')).toBeUndefined();
    expect(versieUitHealth('{"version":true}')).toBeUndefined();
  });

  it('geeft undefined bij ongeldige JSON', () => {
    expect(versieUitHealth('geen json')).toBeUndefined();
    expect(versieUitHealth('')).toBeUndefined();
  });
});
