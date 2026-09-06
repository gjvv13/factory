import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claudeBeschikbaar,
  draaiCodeReview,
  leesDiff,
  maakGateComment,
  parseReviewUitvoer,
} from '../src/code-review.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type UitkomstBepaler } from './helpers.js';

function fixture(naam: string): string {
  const hier = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(hier, 'fixtures', naam), 'utf8');
}

describe('parseReviewUitvoer', () => {
  it('parseert een verdict met bevindingen', () => {
    const verdict = parseReviewUitvoer(fixture('code-review-gate-bevindingen.json'));
    expect(verdict).toBeDefined();
    expect(verdict!.bevindingen).toHaveLength(2);
    expect(verdict!.bevindingen[0]!.ernst).toBe('hoog');
    expect(verdict!.bevindingen[0]!.bestand).toBe('src/commands/promote.ts');
    expect(verdict!.bevindingen[0]!.regel).toBe(42);
    expect(verdict!.oordeel).toContain('correctheid');
  });

  it('parseert een schoon verdict zonder bevindingen', () => {
    const verdict = parseReviewUitvoer(fixture('code-review-gate-schoon.json'));
    expect(verdict).toBeDefined();
    expect(verdict!.bevindingen).toHaveLength(0);
    expect(verdict!.oordeel).toContain('goed');
  });

  it('geeft undefined bij een crash (is_error: true)', () => {
    const verdict = parseReviewUitvoer(fixture('code-review-gate-crash.json'));
    expect(verdict).toBeUndefined();
  });

  it('geeft undefined bij ongeldige JSON', () => {
    expect(parseReviewUitvoer('dit is geen json')).toBeUndefined();
  });

  it('geeft undefined bij een ontbrekend oordeel', () => {
    const ongeldig = JSON.stringify({
      type: 'result',
      is_error: false,
      structured_output: { bevindingen: [] },
    });
    expect(parseReviewUitvoer(ongeldig)).toBeUndefined();
  });

  it('geeft undefined bij een bevinding zonder verplichte velden', () => {
    const ongeldig = JSON.stringify({
      type: 'result',
      is_error: false,
      structured_output: {
        bevindingen: [{ bestand: 'foo.ts' }],
        oordeel: 'test',
      },
    });
    expect(parseReviewUitvoer(ongeldig)).toBeUndefined();
  });
});

describe('maakGateComment', () => {
  it('bouwt een tabel bij bevindingen', () => {
    const verdict = parseReviewUitvoer(fixture('code-review-gate-bevindingen.json'))!;
    const comment = maakGateComment(verdict);
    expect(comment).toContain('Code-review gate (inleveren)');
    expect(comment).toContain('| Bestand | Regel | Ernst | Bevinding |');
    expect(comment).toContain('src/commands/promote.ts');
    expect(comment).toContain('42');
    expect(comment).toContain('hoog');
    expect(comment).toContain('**Oordeel:**');
  });

  it('meldt geen bevindingen bij een schoon verdict', () => {
    const verdict = parseReviewUitvoer(fixture('code-review-gate-schoon.json'))!;
    const comment = maakGateComment(verdict);
    expect(comment).toContain('Code-review gate (inleveren)');
    expect(comment).toContain('Geen bevindingen');
    expect(comment).not.toContain('| Bestand |');
  });

  it('toont een streepje bij een bevinding zonder regelnummer', () => {
    const comment = maakGateComment({
      bevindingen: [{ bestand: 'src/foo.ts', ernst: 'laag', bevinding: 'naamgeving onduidelijk' }],
      oordeel: 'prima',
    });
    expect(comment).toContain('| — |');
  });
});

describe('claudeBeschikbaar', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  it('geeft true als claude --version slaagt', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: '2.3.0' })).uitvoerder);
    expect(claudeBeschikbaar()).toBe(true);
  });

  it('geeft false als claude --version faalt', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ code: 1 })).uitvoerder);
    expect(claudeBeschikbaar()).toBe(false);
  });
});

describe('leesDiff', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  it('geeft de diff als origin/main bestaat en er verschil is', () => {
    const bepaal: UitkomstBepaler = ({ argumenten }) => {
      if (argumenten.includes('--verify')) return { stdout: 'abc123' };
      if (argumenten[0] === 'diff') return { stdout: '--- a/foo\n+++ b/foo' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);
    expect(leesDiff('/tmp/test')).toBe('--- a/foo\n+++ b/foo');
  });

  it('geeft undefined als origin/main niet bestaat', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ code: 1 })).uitvoerder);
    expect(leesDiff('/tmp/test')).toBeUndefined();
  });

  it('geeft undefined bij een lege diff', () => {
    const bepaal: UitkomstBepaler = ({ argumenten }) => {
      if (argumenten.includes('--verify')) return { stdout: 'abc123' };
      if (argumenten[0] === 'diff') return { stdout: '' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);
    expect(leesDiff('/tmp/test')).toBeUndefined();
  });
});

describe('draaiCodeReview', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('slaat over bij instelling "uit"', () => {
    const resultaat = draaiCodeReview('uit', '/tmp/test');
    expect(resultaat.doorgaan).toBe(true);
    expect(resultaat.verdict).toBeUndefined();
  });

  it('waarschuwt en gaat door als claude niet beschikbaar is', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ code: 1, startfout: 'not found' })).uitvoerder);
    const resultaat = draaiCodeReview('waarschuw', '/tmp/test');
    expect(resultaat.doorgaan).toBe(true);
    expect(resultaat.melding).toContain('niet beschikbaar');
  });

  it('gaat door bij een lege diff', () => {
    const bepaal: UitkomstBepaler = ({ argumenten }) => {
      // claude --version slaagt
      if (argumenten[0] === '--version') return { stdout: '2.3.0' };
      // git rev-parse --verify origin/main slaagt
      if (argumenten.includes('--verify')) return { stdout: 'abc' };
      // git diff leeg
      if (argumenten[0] === 'diff') return { stdout: '' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);
    const resultaat = draaiCodeReview('waarschuw', '/tmp/test');
    expect(resultaat.doorgaan).toBe(true);
  });

  it('gaat door bij bevindingen en instelling "waarschuw"', () => {
    const reviewUitvoer = fixture('code-review-gate-bevindingen.json');
    const bepaal: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'claude') return { stdout: reviewUitvoer };
      if (argumenten[0] === '--version') return { stdout: '2.3.0' };
      if (argumenten.includes('--verify')) return { stdout: 'abc' };
      if (argumenten[0] === 'diff') return { stdout: '--- a/foo\n+++ b/foo' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);
    const resultaat = draaiCodeReview('waarschuw', '/tmp/test');
    expect(resultaat.doorgaan).toBe(true);
    expect(resultaat.verdict).toBeDefined();
    expect(resultaat.verdict!.bevindingen).toHaveLength(2);
  });

  it('blokkeert bij bevindingen en instelling "blokkeer"', () => {
    const reviewUitvoer = fixture('code-review-gate-bevindingen.json');
    const bepaal: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'claude') return { stdout: reviewUitvoer };
      if (argumenten[0] === '--version') return { stdout: '2.3.0' };
      if (argumenten.includes('--verify')) return { stdout: 'abc' };
      if (argumenten[0] === 'diff') return { stdout: '--- a/foo\n+++ b/foo' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);
    const resultaat = draaiCodeReview('blokkeer', '/tmp/test');
    expect(resultaat.doorgaan).toBe(false);
    expect(resultaat.verdict).toBeDefined();
    expect(resultaat.verdict!.bevindingen).toHaveLength(2);
  });

  it('gaat door bij een schone review ongeacht de instelling', () => {
    const reviewUitvoer = fixture('code-review-gate-schoon.json');
    const bepaal: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'claude') return { stdout: reviewUitvoer };
      if (argumenten[0] === '--version') return { stdout: '2.3.0' };
      if (argumenten.includes('--verify')) return { stdout: 'abc' };
      if (argumenten[0] === 'diff') return { stdout: '--- a/foo\n+++ b/foo' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);
    const resultaat = draaiCodeReview('blokkeer', '/tmp/test');
    expect(resultaat.doorgaan).toBe(true);
    expect(resultaat.verdict).toBeDefined();
    expect(resultaat.verdict!.bevindingen).toHaveLength(0);
  });

  it('degradeert graceful bij een claude-crash', () => {
    const reviewUitvoer = fixture('code-review-gate-crash.json');
    const bepaal: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'claude') return { stdout: reviewUitvoer };
      if (argumenten[0] === '--version') return { stdout: '2.3.0' };
      if (argumenten.includes('--verify')) return { stdout: 'abc' };
      if (argumenten[0] === 'diff') return { stdout: '--- a/foo\n+++ b/foo' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);
    const resultaat = draaiCodeReview('blokkeer', '/tmp/test');
    // Zelfs bij `blokkeer`: een crash degradeert, gaat door.
    expect(resultaat.doorgaan).toBe(true);
    expect(resultaat.verdict).toBeUndefined();
    expect(resultaat.melding).toContain('geen bruikbaar verdict');
  });
});
