import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * De helptekst is de enige plek waar een gebruiker een commando ontdekt. Elk commando
 * dat de CLI aanneemt hoort erin te staan; anders bestaat het wel maar vindt niemand het.
 */
function cliBron(): string {
  return leesUitWortel('src', 'cli.ts');
}

function leesUitWortel(...delen: string[]): string {
  const hier = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(hier, '..', ...delen), 'utf8');
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

describe('CLAUDE.md', () => {
  it('noemt elk commando dat ook in de helptekst staat', () => {
    // De commandotabel is waar een lezer (of een werker) ontdekt wat de CLI kan. Staat
    // een commando er niet in, dan bestaat het wel maar vindt niemand het — precies
    // wat de helptekst-toets hierboven voor `factory help` doet.
    const claude = leesUitWortel('CLAUDE.md');
    const hulp = /const HULP = `([\s\S]*?)`;/.exec(cliBron())?.[1] ?? '';
    const uitHulp = [...hulp.matchAll(/^ {2}factory ([a-z-]+)/gm)].map((m) => m[1]);
    expect(uitHulp.length).toBeGreaterThan(10);

    // `heeft-migratie` is een interne poort voor de workflow, geen commando dat je
    // zelf draait; die hoort bewust niet in de tabel.
    const ontbreekt = uitHulp.filter(
      (naam) => naam !== 'heeft-migratie' && !claude.includes(`\`factory ${naam ?? ''}`),
    );
    expect(ontbreekt).toEqual([]);
  });
});
