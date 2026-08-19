import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { skillsDir } from '../src/paths.js';

/**
 * Het escalatiecontract is de enige rem op een werker die niemand ziet werken. Staat
 * de gesloten lijst er niet meer in, dan blijft alles groen terwijl de werker voortaan
 * zelf beslist — precies wat #189 aan het licht bracht.
 */
function skill(): string {
  return readFileSync(path.join(skillsDir, 'onbemand-werken', 'SKILL.md'), 'utf8');
}

describe('onbemand-werken-skill', () => {
  it('bevat de gesloten lijst en de vuistregel', () => {
    const tekst = skill();

    for (const punt of [
      'datamodel',
      'externe koppeling',
      'dependency',
      'feature flag',
      'dekkings-basislijn',
      'productie',
    ]) {
      expect(tekst).toContain(punt);
    }
    expect(tekst).toContain('twijfel telt als een treffer');
  });

  it('zegt wat er zonder vragen mag, niet alleen wat niet mag', () => {
    // Een lijst die alles verbiedt wordt genegeerd: in het overduidelijke geval levert
    // hij onzin op, en dan geldt hij in het twijfelgeval ook niet meer (#189).
    expect(skill()).toMatch(/Doorgaan mag ook/);
  });

  it('beschrijft het uitvoerformaat met vraag én advies', () => {
    const tekst = skill();

    expect(tekst).toContain('uitkomst: "klaar"');
    expect(tekst).toContain('uitkomst: "escalatie"');
    // Een escalatie zonder advies schuift het denkwerk door in plaats van het te doen.
    expect(tekst).toMatch(/advies/i);
  });

  it('staat als skill klaar voor de factory zelf', () => {
    // De factory gebruikt zijn eigen skills via een symlink in .claude/skills, zodat
    // de regels ook voor haar eigen code gelden zonder een tweede kopie.
    const hier = path.dirname(fileURLToPath(import.meta.url));
    expect(existsSync(path.join(hier, '..', '.claude', 'skills', 'onbemand-werken'))).toBe(true);
  });
});

describe('de werker-prompt', () => {
  it('verwijst naar de skill in plaats van de lijst te herhalen', () => {
    const hier = path.dirname(fileURLToPath(import.meta.url));
    const prompt = readFileSync(path.join(hier, '..', 'templates', 'werker-refine.md'), 'utf8');

    // Twee kopieën van dezelfde regels drijven uit elkaar, en dan geldt de verkeerde.
    expect(prompt).toContain('skills/onbemand-werken/SKILL.md');
    expect(prompt).toMatch(/vlak voordat je je verdict geeft/);
  });
});
