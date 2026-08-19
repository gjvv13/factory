import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * De helptekst is de enige plek waar een gebruiker een commando ontdekt. Elk commando
 * dat de CLI aanneemt hoort erin te staan; anders bestaat het wel maar vindt niemand het.
 */
function cliBron(): string {
  const hier = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(hier, '..', 'src', 'cli.ts'), 'utf8');
}

describe('factory help', () => {
  it('noemt elk commando dat de CLI aanneemt', () => {
    const bron = cliBron();
    const hulp = /const HULP = `([\s\S]*?)`;/.exec(bron)?.[1] ?? '';
    expect(hulp).not.toBe('');

    // De `case '<naam>':`-takken van de switch zijn de waarheid over wat er bestaat.
    const commandos = [...bron.matchAll(/^\s+case '([a-z-]+)': \{/gm)].map((m) => m[1]);
    expect(commandos.length).toBeGreaterThan(10);

    const ontbreekt = commandos.filter((naam) => !hulp.includes(`factory ${naam ?? ''}`));
    expect(ontbreekt).toEqual([]);
  });
});
