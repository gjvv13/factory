import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bouwBouwEvalPrompt, bouwEvalPrompt } from '../src/commands/eval.js';
import { templatesDir } from '../src/paths.js';
import type { GoudenItem } from '../src/eval/gouden-set.js';

const ITEM: GoudenItem = {
  issue: 803,
  app: 'assistant',
  soort: 'refine',
  titel: 'Een herinnering zetten',
  body: 'BEVROREN-BODY: dit is de opgeslagen issue-tekst.',
};

const BOUW_ITEM: GoudenItem = {
  issue: 828,
  app: 'beheer',
  soort: 'bouw',
  titel: 'Health toont de versie',
  body: 'BEVROREN-BOUW-BODY: acceptatiecriteria hieronder.',
};

/** De echte instructieregel in het productie-sjabloon, waar de eval op pint. */
function werkerRefine(): string {
  return readFileSync(path.join(templatesDir, 'werker-refine.md'), 'utf8');
}

describe('de eval-prompt-opbouw', () => {
  it('bevat de te vervangen lees-instructieregel in het productie-sjabloon (drift-pin)', () => {
    // Pin op de inhoud, niet op een regelnummer: de regel begint met "1. Lees het
    // issue:" en bevat `gh issue view`. Verandert die formulering, dan faalt deze test
    // en moet de eval-promptopbouw meebewegen — precies de bedoeling.
    const regels = werkerRefine().split('\n');
    const instructie = regels.filter(
      (regel) => regel.includes('1. Lees het issue:') && regel.includes('gh issue view'),
    );
    expect(instructie).toHaveLength(1);
  });

  it('vervangt de gh issue view-instructie door de bevroren body inline', () => {
    const prompt = bouwEvalPrompt(ITEM, '/werkmap', '/factory', ['assistant', 'beheer']);
    expect(prompt).toContain('Het issue staat hieronder:');
    expect(prompt).toContain('BEVROREN-BODY: dit is de opgeslagen issue-tekst.');
    // De lees-instructie is weg: geen `gh issue view` meer, geen open placeholder.
    expect(prompt).not.toContain('gh issue view {{ISSUE}}');
    expect(prompt).not.toContain('1. Lees het issue:');
  });

  it('interpoleert dezelfde feiten als de productie-prompt', () => {
    const prompt = bouwEvalPrompt(ITEM, '/de/werkmap', '/de/factory', ['assistant']);
    expect(prompt).toContain('#803');
    expect(prompt).toContain('Een herinnering zetten');
    expect(prompt).toContain('/de/werkmap');
    expect(prompt).toContain('/de/factory');
    expect(prompt).not.toContain('{{ISSUE}}');
    expect(prompt).not.toContain('{{WERKMAP}}');
  });

  it('faalt luid als het sjabloon de lees-instructieregel niet meer bevat (drift)', () => {
    const gedrift = 'Een sjabloon zonder de bekende instructieregel.\n{{ISSUE}} {{TITEL}}\n';
    expect(() => bouwEvalPrompt(ITEM, '/w', '/f', [], gedrift)).toThrow(/gedrift/);
  });
});

/** De echte instructieregel in het bouw-sjabloon, waar de bouw-eval op pint. */
function werkerBouw(): string {
  return readFileSync(path.join(templatesDir, 'werker-bouw.md'), 'utf8');
}

describe('de eval-prompt-opbouw voor bouw', () => {
  it('bevat de te vervangen lees-instructieregel in werker-bouw.md (drift-pin)', () => {
    const regels = werkerBouw().split('\n');
    const instructie = regels.filter(
      (regel) => regel.includes('1. Lees het issue:') && regel.includes('gh issue view'),
    );
    expect(instructie).toHaveLength(1);
  });

  it('vervangt de gh issue view-instructie in werker-bouw.md door de bevroren body', () => {
    const prompt = bouwBouwEvalPrompt(BOUW_ITEM, '/werkmap', '/factory', ['beheer', 'assistant']);
    expect(prompt).toContain('Het issue staat hieronder:');
    expect(prompt).toContain('BEVROREN-BOUW-BODY: acceptatiecriteria hieronder.');
    expect(prompt).not.toContain('gh issue view {{ISSUE}}');
    expect(prompt).not.toContain('1. Lees het issue:');
  });

  it('interpoleert dezelfde feiten als de productie-bouwprompt', () => {
    const prompt = bouwBouwEvalPrompt(BOUW_ITEM, '/de/werkmap', '/de/factory', ['beheer']);
    expect(prompt).toContain('#828');
    expect(prompt).toContain('Health toont de versie');
    expect(prompt).toContain('/de/werkmap');
    expect(prompt).toContain('slice/828-1'); // de {{BRANCH}}-substitutie
    expect(prompt).not.toContain('{{ISSUE}}');
    expect(prompt).not.toContain('{{BRANCH}}');
    expect(prompt).not.toContain('{{BRON_MAPPEN}}');
  });

  it('faalt luid als werker-bouw.md de lees-instructieregel niet meer bevat (drift)', () => {
    const gedrift = 'Een bouw-sjabloon zonder de bekende instructieregel.\n{{ISSUE}} {{BRANCH}}\n';
    expect(() => bouwBouwEvalPrompt(BOUW_ITEM, '/w', '/f', [], gedrift)).toThrow(/gedrift/);
  });
});
