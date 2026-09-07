import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leesRunLog, parseRunLogRegel } from '../src/runlog.js';
import { logRun, standaardPaden, type OrkestratorPaden } from '../src/orkestrator-instellingen.js';
import { orkestreerWrijving } from '../src/commands/orkestreer.js';

function fixture(naam: string): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'contract', naam);
}

// ---------------------------------------------------------------------------
// parseRunLogRegel
// ---------------------------------------------------------------------------

describe('parseRunLogRegel', () => {
  it('parset een oude regel zonder wrijvingssuffix', () => {
    const regel = '2026-08-20T04:12:03.000Z #87 assistant bouw klaar $2.09 31 beurten';
    const record = parseRunLogRegel(regel);

    expect(record).toBeDefined();
    expect(record!.issue).toBe(87);
    expect(record!.app).toBe('assistant');
    expect(record!.soort).toBe('bouw');
    expect(record!.uitkomst).toBe('klaar');
    expect(record!.kosten).toBeCloseTo(2.09, 2);
    expect(record!.beurten).toBe(31);
    expect(record!.weigeringen).toBe(0);
    expect(record!.geweigerd).toEqual([]);
  });

  it('parset een regel met uitsplitsing zonder wrijving', () => {
    const regel =
      '2026-08-20T04:15:23.000Z #91 assistant bouw klaar $3.81 58 beurten (bouw $2.09 · review $1.12)';
    const record = parseRunLogRegel(regel);

    expect(record).toBeDefined();
    expect(record!.kosten).toBeCloseTo(3.81, 2);
    expect(record!.beurten).toBe(58);
    expect(record!.weigeringen).toBe(0);
    expect(record!.geweigerd).toEqual([]);
  });

  it('parset een regel met wrijvingssuffix', () => {
    const regel =
      '2026-08-22T04:10:00.000Z #110 assistant bouw klaar $4.20 45 beurten (bouw $3.00 · review $1.20) [w:9:mkdir,rm,git-C]';
    const record = parseRunLogRegel(regel);

    expect(record).toBeDefined();
    expect(record!.weigeringen).toBe(9);
    // `git-C` wordt teruggezet naar `git C` (koppelteken → spatie).
    expect(record!.geweigerd).toEqual(['mkdir', 'rm', 'git C']);
  });

  it('parset een regel met alleen wrijving en geen uitsplitsing', () => {
    const regel = '2026-08-22T04:30:00.000Z #111 factory bouw klaar $2.50 30 beurten [w:3:mkdir]';
    const record = parseRunLogRegel(regel);

    expect(record).toBeDefined();
    expect(record!.weigeringen).toBe(3);
    expect(record!.geweigerd).toEqual(['mkdir']);
  });

  it('parset een refine-regel', () => {
    const regel = '2026-08-21T04:00:01.000Z #100 factory refine klaar $0.42 9 beurten';
    const record = parseRunLogRegel(regel);

    expect(record).toBeDefined();
    expect(record!.soort).toBe('refine');
  });

  it('parset een accepteer-regel', () => {
    const regel = '2026-09-01T04:00:01.000Z #200 assistant accepteer klaar $1.00 5 beurten';
    const record = parseRunLogRegel(regel);

    expect(record).toBeDefined();
    expect(record!.soort).toBe('accepteer');
  });

  it('retourneert undefined voor een ongeldige regel', () => {
    expect(parseRunLogRegel('dit is geen logregel')).toBeUndefined();
    expect(parseRunLogRegel('')).toBeUndefined();
  });

  it('handelt onbekende kosten en beurten af', () => {
    const regel = '2026-08-20T04:12:03.000Z #51 assistant bouw escalatie ? ? beurten';
    const record = parseRunLogRegel(regel);

    expect(record).toBeDefined();
    expect(record!.kosten).toBeUndefined();
    expect(record!.beurten).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// leesRunLog
// ---------------------------------------------------------------------------

describe('leesRunLog', () => {
  it('parset de gemengde fixture met oude en nieuwe regels', () => {
    const records = leesRunLog(fixture('runlog-gemengd.log'));

    // 7 regels totaal: 5 bouw + 1 refine + 1 bouw-escalatie = 7 geldige records.
    expect(records.length).toBe(7);
  });

  it('beperkt tot de laatste N records', () => {
    const records = leesRunLog(fixture('runlog-gemengd.log'), 3);

    expect(records.length).toBe(3);
    expect(records[0]!.issue).toBe(110);
    expect(records[1]!.issue).toBe(111);
    expect(records[2]!.issue).toBe(120);
  });

  it('retourneert een leeg array bij een ontbrekend bestand', () => {
    expect(leesRunLog('/pad/dat/niet/bestaat.log')).toEqual([]);
  });

  it('retourneert een leeg array bij een leeg bestand', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'runlog-test-'));
    const pad = path.join(tmp, 'leeg.log');
    writeFileSync(pad, '');
    try {
      expect(leesRunLog(pad)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('slaat ongeldige regels over zonder te crashen', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'runlog-test-'));
    const pad = path.join(tmp, 'rommelig.log');
    writeFileSync(
      pad,
      'dit is rommel\n2026-08-20T04:12:03.000Z #87 assistant bouw klaar $2.09 31 beurten\nook rommel\n',
    );
    try {
      const records = leesRunLog(pad);
      expect(records.length).toBe(1);
      expect(records[0]!.issue).toBe(87);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Contract: de fixture pindt het logformaat vast tegen de parser (#544)
// ---------------------------------------------------------------------------

describe('contract: runlog-formaat', () => {
  it('parset elke geldige regel in de fixture', () => {
    const inhoud = readFileSync(fixture('runlog-gemengd.log'), 'utf8');
    const regels = inhoud.trim().split('\n');

    for (const regel of regels) {
      const record = parseRunLogRegel(regel);
      expect(record, `zou moeten parsen: ${regel}`).toBeDefined();
    }
  });

  it('herkent wrijving in de fixture-regels die het hebben', () => {
    const records = leesRunLog(fixture('runlog-gemengd.log'));
    const metWrijving = records.filter((r) => r.weigeringen > 0);

    // Twee regels in de fixture hebben [w:…].
    expect(metWrijving.length).toBe(2);
    expect(metWrijving[0]!.issue).toBe(110);
    expect(metWrijving[0]!.weigeringen).toBe(9);
    expect(metWrijving[1]!.issue).toBe(111);
    expect(metWrijving[1]!.weigeringen).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// logRun met wrijving (#544)
// ---------------------------------------------------------------------------

describe('logRun met wrijving', () => {
  let home: string;
  let paden: OrkestratorPaden;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-ork-wrijving-'));
    paden = standaardPaden(home);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('schrijft de wrijvingssuffix als er weigeringen zijn', () => {
    logRun(paden, new Date('2026-08-22T04:10:00Z'), {
      issue: 110,
      app: 'assistant',
      soort: 'bouw',
      uitkomst: 'klaar',
      kosten: 4.2,
      beurten: 45,
      weigeringen: 9,
      geweigerd: ['mkdir', 'rm', 'git -C'],
    });

    const regel = readFileSync(paden.logPad, 'utf8').trim();
    expect(regel).toContain('[w:9:mkdir,rm,git--C]');
  });

  it('schrijft geen suffix zonder weigeringen — achterwaarts compatibel', () => {
    logRun(paden, new Date('2026-08-22T04:10:00Z'), {
      issue: 110,
      app: 'assistant',
      soort: 'bouw',
      uitkomst: 'klaar',
      kosten: 2.0,
      beurten: 30,
    });

    const regel = readFileSync(paden.logPad, 'utf8').trim();
    expect(regel).not.toContain('[w:');
    expect(regel).toMatch(/30 beurten$/);
  });

  it('schrijft geen suffix bij weigeringen=0', () => {
    logRun(paden, new Date('2026-08-22T04:10:00Z'), {
      issue: 110,
      app: 'assistant',
      soort: 'bouw',
      uitkomst: 'klaar',
      kosten: 2.0,
      beurten: 30,
      weigeringen: 0,
      geweigerd: [],
    });

    const regel = readFileSync(paden.logPad, 'utf8').trim();
    expect(regel).not.toContain('[w:');
  });

  it('round-trip: logRun schrijft, leesRunLog parset', () => {
    logRun(paden, new Date('2026-08-22T04:10:00Z'), {
      issue: 110,
      app: 'assistant',
      soort: 'bouw',
      uitkomst: 'klaar',
      kosten: 4.2,
      beurten: 45,
      uitsplitsing: '(bouw $3.00 · review $1.20)',
      weigeringen: 9,
      geweigerd: ['mkdir', 'rm'],
    });

    const records = leesRunLog(paden.logPad);
    expect(records.length).toBe(1);
    const record = records[0]!;
    expect(record.weigeringen).toBe(9);
    expect(record.geweigerd).toContain('mkdir');
    expect(record.geweigerd).toContain('rm');
    expect(record.kosten).toBeCloseTo(4.2, 1);
  });
});

// ---------------------------------------------------------------------------
// orkestreerWrijving (#544)
// ---------------------------------------------------------------------------

describe('orkestreerWrijving', () => {
  let home: string;
  let paden: OrkestratorPaden;
  let uitvoer: string[];

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-ork-wrijving-'));
    paden = standaardPaden(home);
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('toont een schone melding bij een leeg log', () => {
    orkestreerWrijving(undefined, paden.logPad);

    const tekst = uitvoer.join('');
    expect(tekst).toContain('Geen bouw-runs in het log');
  });

  it('toont "geen wrijving" als er bouw-runs zijn zonder weigeringen', () => {
    logRun(paden, new Date('2026-08-20T04:12:03Z'), {
      issue: 87,
      app: 'assistant',
      soort: 'bouw',
      uitkomst: 'klaar',
      kosten: 2.09,
      beurten: 31,
    });
    logRun(paden, new Date('2026-08-21T04:12:03Z'), {
      issue: 91,
      app: 'assistant',
      soort: 'bouw',
      uitkomst: 'klaar',
      kosten: 3.0,
      beurten: 40,
    });

    orkestreerWrijving(undefined, paden.logPad);

    const tekst = uitvoer.join('');
    expect(tekst).toContain('Geen wrijving');
    expect(tekst).toContain('Runs: 2');
  });

  it('toont per-tool frequenties en markeert ≥ 3', () => {
    logRun(paden, new Date('2026-08-20T04:12:03Z'), {
      issue: 87,
      app: 'assistant',
      soort: 'bouw',
      uitkomst: 'klaar',
      kosten: 2.0,
      beurten: 30,
      weigeringen: 3,
      geweigerd: ['mkdir'],
    });
    logRun(paden, new Date('2026-08-21T04:12:03Z'), {
      issue: 91,
      app: 'assistant',
      soort: 'bouw',
      uitkomst: 'klaar',
      kosten: 3.0,
      beurten: 40,
      weigeringen: 2,
      geweigerd: ['mkdir', 'rm'],
    });
    logRun(paden, new Date('2026-08-22T04:12:03Z'), {
      issue: 100,
      app: 'factory',
      soort: 'bouw',
      uitkomst: 'klaar',
      kosten: 2.5,
      beurten: 30,
      weigeringen: 1,
      geweigerd: ['mkdir'],
    });

    orkestreerWrijving(undefined, paden.logPad);

    const tekst = uitvoer.join('');
    // mkdir verschijnt in 3 runs → markering ▸
    expect(tekst).toContain('mkdir: 3×');
    expect(tekst).toContain('▸');
    // rm verschijnt in 1 run → geen markering
    expect(tekst).toContain('rm: 1×');
    // Totalen.
    expect(tekst).toContain('Runs: 3');
    expect(tekst).toContain('kosten: $7.50');
    expect(tekst).toContain('met wrijving: 3');
  });

  it('filtert refine-runs eruit (besluit 6)', () => {
    logRun(paden, new Date('2026-08-20T04:12:03Z'), {
      issue: 100,
      app: 'factory',
      soort: 'refine',
      uitkomst: 'klaar',
      kosten: 0.5,
      beurten: 9,
      weigeringen: 5,
      geweigerd: ['Write', 'Edit'],
    });
    logRun(paden, new Date('2026-08-21T04:12:03Z'), {
      issue: 101,
      app: 'assistant',
      soort: 'bouw',
      uitkomst: 'klaar',
      kosten: 2.0,
      beurten: 30,
    });

    orkestreerWrijving(undefined, paden.logPad);

    const tekst = uitvoer.join('');
    expect(tekst).toContain('Runs: 1');
    expect(tekst).toContain('Geen wrijving');
  });

  it('respecteert het N-argument', () => {
    // Schrijf 5 bouw-runs, vraag de laatste 2.
    for (let i = 1; i <= 5; i++) {
      logRun(paden, new Date(`2026-08-${String(19 + i).padStart(2, '0')}T04:12:03Z`), {
        issue: 80 + i,
        app: 'assistant',
        soort: 'bouw',
        uitkomst: 'klaar',
        kosten: 2.0,
        beurten: 30,
        ...(i >= 4 ? { weigeringen: 1, geweigerd: ['mkdir'] } : {}),
      });
    }

    orkestreerWrijving(2, paden.logPad);

    const tekst = uitvoer.join('');
    expect(tekst).toContain('laatste 2 bouw-runs');
    // Runs 4 en 5 hebben wrijving.
    expect(tekst).toContain('met wrijving: 2');
  });
});
