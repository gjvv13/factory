import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `/bouw` is de instructie waar elke bouwsessie mee begint. Staat daar nog de oude
 * `git switch -c` in, dan bouwt iedereen weer in de gedeelde werkmap en is de
 * worktree-isolatie uit #118 er wel, maar gebruikt niemand hem.
 */
function bouwCommando(): string {
  const hier = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(hier, '..', 'claude-commands', 'bouw.md'), 'utf8');
}

describe('/bouw', () => {
  it('begint de slice in een eigen werkplek', () => {
    expect(bouwCommando()).toContain('factory werkplek <issuenummer>');
  });

  it('stuurt niet meer naar een branch in de gedeelde werkmap', () => {
    // De oude stap 4. Blijft die staan, dan is er een tweede, tegenstrijdige route.
    expect(bouwCommando()).not.toMatch(/git (switch -c|checkout -b) slice\//);
  });
});
