import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { leesAgentGrenzen, voegToolToe } from '../src/agent-definitie.js';
import { agentsDir } from '../src/paths.js';

/**
 * Tests voor `voegToolToe`: het toevoegen van een patroon aan het frontmatter van een
 * agent-definitie (#543).
 *
 * De tests werken op een kopie van het echte `agents/bouwer.md`, zodat ze de parse-logica
 * niet nabootsen maar echt toetsen.
 */
describe('voegToolToe', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'agent-def-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('voegt een patroon toe aan allowedTools in het frontmatter', () => {
    // Mini-agent-bestand met het frontmatter-formaat dat de parser verwacht.
    const agentPad = path.join(agentsDir, 'test-auto-groei.md');
    writeFileSync(
      agentPad,
      [
        '---',
        'name: test-auto-groei',
        'allowedTools:',
        '  - Read',
        "  - 'Bash(ls:*)'",
        'disallowedTools:',
        '  - Write',
        '---',
        '',
        'Een test-agent.',
      ].join('\n'),
    );

    try {
      voegToolToe('test-auto-groei', 'Bash(diff:*)');

      const grenzen = leesAgentGrenzen('test-auto-groei');
      expect(grenzen.allowedTools).toContain('Bash(diff:*)');
      // De bestaande tools zijn er nog.
      expect(grenzen.allowedTools).toContain('Read');
      expect(grenzen.allowedTools).toContain('Bash(ls:*)');
    } finally {
      rmSync(agentPad, { force: true });
    }
  });

  it('is een no-op als het patroon al bestaat', () => {
    const agentPad = path.join(agentsDir, 'test-auto-groei-noop.md');
    writeFileSync(
      agentPad,
      [
        '---',
        'name: test-auto-groei-noop',
        'allowedTools:',
        '  - Read',
        "  - 'Bash(diff:*)'",
        'disallowedTools:',
        '  - Write',
        '---',
        '',
        'Een test-agent.',
      ].join('\n'),
    );

    try {
      const vooraf = readFileSync(agentPad, 'utf8');
      voegToolToe('test-auto-groei-noop', 'Bash(diff:*)');
      const achteraf = readFileSync(agentPad, 'utf8');

      // Bestand niet aangeraakt.
      expect(achteraf).toBe(vooraf);
    } finally {
      rmSync(agentPad, { force: true });
    }
  });

  it('gooit bij een onbekend agent-bestand', () => {
    expect(() => {
      voegToolToe('niet-bestaand-agent-xyz', 'Bash(diff:*)');
    }).toThrow();
  });
});
