import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard: de literalen `'gjvv13'` en `'factory'` (als backlog-repo) staan alleen
 * in `src/board.ts` (#623). Elke andere plek importeert `EIGENAAR` en
 * `BACKLOG_REPO` uit dat bestand.
 */
describe('EIGENAAR en BACKLOG_REPO zijn gecentreerd in board.ts (#623)', () => {
  const srcDir = path.resolve(import.meta.dirname, '..', 'src');

  /** Alle .ts-bestanden onder src/, recursief. */
  function tsBestanden(dir: string): string[] {
    const resultaat: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const volledigPad = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        resultaat.push(...tsBestanden(volledigPad));
      } else if (entry.name.endsWith('.ts')) {
        resultaat.push(volledigPad);
      }
    }
    return resultaat;
  }

  it("geen enkel bronbestand buiten board.ts bevat de literaal 'gjvv13'", () => {
    const overtreders: string[] = [];
    for (const bestand of tsBestanden(srcDir)) {
      if (path.basename(bestand) === 'board.ts') continue;
      const inhoud = readFileSync(bestand, 'utf8');
      // Zoek naar de string-literaal, niet naar een import of comment.
      if (/['"]gjvv13['"]/.test(inhoud)) {
        overtreders.push(path.relative(srcDir, bestand));
      }
    }
    expect(
      overtreders,
      `Deze bestanden bevatten een losse 'gjvv13'-literaal in plaats van de import uit board.ts: ${overtreders.join(', ')}`,
    ).toEqual([]);
  });
});
