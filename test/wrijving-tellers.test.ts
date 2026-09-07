import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GROEI_DREMPEL, leesTellers, werkTellersBij } from '../src/wrijving-tellers.js';

describe('GROEI_DREMPEL', () => {
  it('is 3', () => {
    expect(GROEI_DREMPEL).toBe(3);
  });
});

describe('leesTellers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tellers-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('levert een leeg object bij een ontbrekend bestand', () => {
    const pad = path.join(tmpDir, 'niet-bestaand.json');
    expect(leesTellers(pad)).toEqual({});
  });

  it('leest een geldig JSON-bestand', () => {
    const pad = path.join(tmpDir, 'tellers.json');
    writeFileSync(pad, JSON.stringify({ diff: 2, sort: 3 }));
    expect(leesTellers(pad)).toEqual({ diff: 2, sort: 3 });
  });

  it('levert een leeg object bij een corrupt bestand', () => {
    const pad = path.join(tmpDir, 'corrupt.json');
    writeFileSync(pad, 'dit is geen json');
    expect(leesTellers(pad)).toEqual({});
  });

  it('levert een leeg object bij een array in plaats van een object', () => {
    const pad = path.join(tmpDir, 'array.json');
    writeFileSync(pad, '[1, 2, 3]');
    expect(leesTellers(pad)).toEqual({});
  });

  it('negeert niet-numerieke waarden', () => {
    const pad = path.join(tmpDir, 'mix.json');
    writeFileSync(pad, JSON.stringify({ diff: 2, fout: 'tekst', ok: 3 }));
    expect(leesTellers(pad)).toEqual({ diff: 2, ok: 3 });
  });
});

describe('werkTellersBij', () => {
  let tmpDir: string;
  let pad: string;
  const echoPat = (label: string) => `Bash(${label}:*)`;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tellers-test-'));
    pad = path.join(tmpDir, 'tellers.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('hoogt tellers op en schrijft het bestand', () => {
    werkTellersBij(pad, ['diff', 'diff', 'sort'], echoPat);

    const tellers = leesTellers(pad);
    expect(tellers['diff']).toBe(2);
    expect(tellers['sort']).toBe(1);
  });

  it('detecteert de drempel exact op N', () => {
    // Schrijf een initiële teller op drempel-1.
    writeFileSync(pad, JSON.stringify({ diff: 2 }));

    const groei = werkTellersBij(pad, ['diff'], echoPat);

    expect(groei).toHaveLength(1);
    expect(groei[0]?.label).toBe('diff');
    expect(groei[0]?.patroon).toBe('Bash(diff:*)');
    expect(groei[0]?.nieuweTelling).toBe(3);
  });

  it('meldt een label dat al boven de drempel was niet opnieuw', () => {
    // Teller al op 3 (drempel bereikt in een eerdere run).
    writeFileSync(pad, JSON.stringify({ diff: 3 }));

    const groei = werkTellersBij(pad, ['diff'], echoPat);

    // De drempel was al bereikt; geen herhaling.
    expect(groei).toHaveLength(0);
    // De teller stijgt wél door.
    expect(leesTellers(pad)['diff']).toBe(4);
  });

  it('meldt een label dat al boven de drempel was en nóg hoger gaat niet', () => {
    writeFileSync(pad, JSON.stringify({ diff: 5 }));

    const groei = werkTellersBij(pad, ['diff'], echoPat);

    expect(groei).toHaveLength(0);
  });

  it('maakt de map aan als die niet bestaat', () => {
    const diepPad = path.join(tmpDir, 'sub', 'dir', 'tellers.json');

    werkTellersBij(diepPad, ['sort'], echoPat);

    expect(leesTellers(diepPad)).toEqual({ sort: 1 });
  });

  it('geeft een lege lijst bij een leeg labels-array', () => {
    const groei = werkTellersBij(pad, [], echoPat);

    expect(groei).toHaveLength(0);
  });

  it('verwerkt een ontbrekend bestand als een schone start', () => {
    // Drie keer hetzelfde label: de drempel wordt in één keer bereikt.
    const groei = werkTellersBij(pad, ['jq', 'jq', 'jq'], echoPat);

    expect(groei).toHaveLength(1);
    expect(groei[0]?.label).toBe('jq');
    expect(groei[0]?.nieuweTelling).toBe(3);
  });
});
