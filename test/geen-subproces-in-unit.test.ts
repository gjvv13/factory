import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard: geen enkel unit-testbestand importeert node:child_process (#293).
 *
 * De unit-run hoort vrij te zijn van echte subprocessen — die maken de suite flaky
 * onder belasting. Tests die met opzet een subproces starten (npm pack, node, bash)
 * horen in test/integration/, met een eigen ruimere timeout.
 */
describe('unit-tests zijn vrij van echte subprocessen (#293)', () => {
  const testDir = path.join(import.meta.dirname);

  // Alleen de bestanden in test/ zelf, niet in submappen (integration/, contract/).
  const unitBestanden = readdirSync(testDir)
    .filter((bestand) => bestand.endsWith('.test.ts'))
    .map((bestand) => path.join(testDir, bestand));

  it('geen enkel unit-testbestand importeert node:child_process', () => {
    const overtreders: string[] = [];
    for (const bestand of unitBestanden) {
      const inhoud = readFileSync(bestand, 'utf8');
      // Zoek naar een echte import-regel, niet naar een vermelding in een comment.
      if (/^\s*import\b.*['"]node:child_process['"]/m.test(inhoud)) {
        overtreders.push(path.basename(bestand));
      }
    }
    expect(
      overtreders,
      `Deze unit-tests importeren node:child_process en horen in test/integration/: ${overtreders.join(', ')}`,
    ).toEqual([]);
  });
});
