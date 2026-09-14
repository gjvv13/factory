import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { valideerAgentDefinities, zoekDodeSymlinks } from '../src/agent-validatie.js';
import { leesAgentGrenzen } from '../src/agent-definitie.js';
import { factoryPakketDir } from '../src/paths.js';
import { AGENT_BOUWER, AGENT_REVIEWER, AGENT_REFINER, AGENT_ACCEPTEERDER } from '../src/werker.js';

/**
 * Statische validatie van agent-definities en dode-symlinkdetectie (#552).
 *
 * Deze tests draaien op de echte bestanden in `agents/` en `.claude/`, zodat
 * drift tussen definitie en code direct zichtbaar is — geen fixtures die
 * achterlopen.
 */

// -- valideerAgentDefinities --------------------------------------------------

describe('valideerAgentDefinities', () => {
  const VERWACHTE_ROLLEN = [AGENT_BOUWER, AGENT_REVIEWER, AGENT_REFINER, AGENT_ACCEPTEERDER];

  it('valideert alle vier de rollen zonder fouten', () => {
    const resultaten = valideerAgentDefinities();

    for (const rol of VERWACHTE_ROLLEN) {
      const resultaat = resultaten.find((r) => r.bestand === `${rol}.md`);
      expect(resultaat, `Resultaat voor ${rol} ontbreekt`).toBeDefined();
      expect(resultaat?.ok, `${rol}: ${resultaat?.fout ?? 'onbekende fout'}`).toBe(true);
    }
  });

  it('vindt alle vier de rollen in de resultaten', () => {
    const resultaten = valideerAgentDefinities();
    const namen = resultaten.map((r) => path.basename(r.bestand, '.md'));

    for (const rol of VERWACHTE_ROLLEN) {
      expect(namen, `Rol '${rol}' ontbreekt in agents/`).toContain(rol);
    }
  });
});

// -- zoekDodeSymlinks ---------------------------------------------------------

describe('zoekDodeSymlinks', () => {
  it('vindt geen dode symlinks in .claude/ van de repo', () => {
    const claudeDir = path.join(factoryPakketDir, '.claude');
    const dode = zoekDodeSymlinks(claudeDir);

    expect(dode, `Dode symlinks gevonden: ${dode.join(', ')}`).toEqual([]);
  });

  describe('tmpdir met dode symlink', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), 'dode-symlink-test-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('detecteert een dode symlink', () => {
      // Maak een symlink die naar een niet-bestaand doel wijst.
      const dodeLink = path.join(tmpDir, 'kapotte-link');
      symlinkSync('/dit/pad/bestaat/niet/echt', dodeLink);

      const resultaat = zoekDodeSymlinks(tmpDir);

      expect(resultaat).toContain(dodeLink);
    });

    it('detecteert een dode symlink in een submap', () => {
      const submap = path.join(tmpDir, 'dieper');
      mkdirSync(submap);
      const dodeLink = path.join(submap, 'ook-kapot');
      symlinkSync('../niet-bestaand-doel', dodeLink);

      const resultaat = zoekDodeSymlinks(tmpDir);

      expect(resultaat).toContain(dodeLink);
    });
  });
});

// -- Grensconsistentie --------------------------------------------------------

describe('grensconsistentie van agent-definities', () => {
  it('bouwer heeft Write in allowedTools en mist Bash(git push:*)', () => {
    const grenzen = leesAgentGrenzen(AGENT_BOUWER);

    expect(grenzen.allowedTools).toContain('Write');
    expect(grenzen.allowedTools).not.toContain('Bash(git push:*)');
    // git push staat op de verboden lijst.
    expect(grenzen.disallowedTools).toContain('Bash(git push:*)');
  });

  it('reviewer heeft Write niet in allowedTools', () => {
    const grenzen = leesAgentGrenzen(AGENT_REVIEWER);

    expect(grenzen.allowedTools).not.toContain('Write');
  });

  it('refiner heeft Write niet in allowedTools', () => {
    const grenzen = leesAgentGrenzen(AGENT_REFINER);

    expect(grenzen.allowedTools).not.toContain('Write');
  });

  it('accepteerder heeft Write niet in allowedTools', () => {
    const grenzen = leesAgentGrenzen(AGENT_ACCEPTEERDER);

    expect(grenzen.allowedTools).not.toContain('Write');
  });
});
