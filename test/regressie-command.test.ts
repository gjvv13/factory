import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evalueer } from '../src/commands/eval.js';
import { leesBasislijn } from '../src/eval/basislijn.js';
import type { JudgeFn } from '../src/eval/judge.js';
import { GebruikersFout } from '../src/shell.js';
import type { WerkerOpdracht, WerkerUitkomst } from '../src/werker.js';

const GOUDEN_SET = {
  judgeModel: 'test-model',
  judgeEffort: 'medium',
  items: [
    { issue: 1, app: 'assistant', soort: 'refine', titel: 'Item een', body: 'body-een' },
    { issue: 2, app: 'assistant', soort: 'refine', titel: 'Item twee', body: 'body-twee' },
  ],
};

function klaarWerker(body = 'de uitwerking'): WerkerUitkomst {
  return {
    afloop: 'klaar',
    sessie: 's',
    weigeringen: 0,
    kosten: 0.1,
    verdict: { uitkomst: 'klaar', samenvatting: 's', slices: 1, body, doorloop: [] },
  };
}

function mislukteWerker(): WerkerUitkomst {
  return { afloop: 'mislukt', sessie: 's', weigeringen: 0, fout: 'de werker viel om' };
}

function judgeMet(scores: number[]): JudgeFn {
  return () => Promise.resolve({ scores, toelichtingen: scores.map(() => 'x'), kosten: 0.02 });
}

const HOOG = [2, 2, 2, 2, 2, 2, 2]; // 10,0
const LAAG = [1, 1, 1, 1, 1, 1, 1]; // 5,0

describe('factory eval (orchestratie)', () => {
  let tmp: string;
  let uitvoer: string[];

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'eval-cmd-'));
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function goudenSetPad(set: unknown = GOUDEN_SET): string {
    const pad = path.join(tmp, 'gouden-set.json');
    writeFileSync(pad, JSON.stringify(set));
    return pad;
  }

  function basislijnPad(inhoud?: unknown): string {
    const pad = path.join(tmp, 'basislijn.json');
    if (inhoud !== undefined) {
      writeFileSync(pad, JSON.stringify(inhoud));
    }
    return pad;
  }

  function tekst(): string {
    return uitvoer.join('');
  }

  it('--dry toont de gouden set en het judge-model zonder iets te draaien', async () => {
    const werkerFn = vi.fn();
    const judgeFn = vi.fn();
    await evalueer({ dry: true, goudenSetPad: goudenSetPad(), werkerFn, judgeFn });

    expect(tekst()).toContain('#1');
    expect(tekst()).toContain('#2');
    expect(tekst()).toContain('test-model');
    expect(werkerFn).not.toHaveBeenCalled();
    expect(judgeFn).not.toHaveBeenCalled();
  });

  it('draait de werker per item, scoort via de judge en toont het totaal naast de basislijn', async () => {
    const opdrachten: WerkerOpdracht[] = [];
    const werkerFn = (opdracht: WerkerOpdracht): Promise<WerkerUitkomst> => {
      opdrachten.push(opdracht);
      return Promise.resolve(klaarWerker());
    };
    const judgeFn = vi.fn(judgeMet(HOOG));

    await evalueer({
      goudenSetPad: goudenSetPad(),
      basislijnPad: basislijnPad({}),
      werkerFn,
      judgeFn,
      versWerkmap: (app) => path.join(tmp, app),
      budgetUsd: 3,
      gedrag: 'waarschuw',
    });

    expect(tekst()).toContain('10.0');
    expect(tekst()).toContain('nieuw'); // bootstrap: nog geen basislijn
    // De werker draait met de refiner-agent en het meegegeven budget.
    expect(opdrachten).toHaveLength(2);
    expect(opdrachten[0]?.agent).toBe('refiner');
    expect(opdrachten[0]?.budgetUsd).toBe(3);
    // De judge kreeg het vastgepinde model en de effort uit de gouden set.
    expect(judgeFn).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test-model', effort: 'medium' }),
    );
  });

  it('meldt een regressie geel bij gedrag "waarschuw" en houdt de poort groen', async () => {
    await expect(
      evalueer({
        goudenSetPad: goudenSetPad(),
        basislijnPad: basislijnPad({
          '1': { totaal: 10, criteria: HOOG, tijdstempel: 't' },
          '2': { totaal: 10, criteria: HOOG, tijdstempel: 't' },
        }),
        werkerFn: () => Promise.resolve(klaarWerker()),
        judgeFn: judgeMet(LAAG),
        versWerkmap: (app) => path.join(tmp, app),
        gedrag: 'waarschuw',
      }),
    ).resolves.toBeUndefined();
    expect(tekst()).toContain('REGRESSIE');
    expect(tekst()).toContain('onder de basislijn');
  });

  it('faalt met een GebruikersFout (exit 1) bij een regressie in gedrag "blokkeer"', async () => {
    await expect(
      evalueer({
        goudenSetPad: goudenSetPad(),
        basislijnPad: basislijnPad({
          '1': { totaal: 10, criteria: HOOG, tijdstempel: 't' },
          '2': { totaal: 10, criteria: HOOG, tijdstempel: 't' },
        }),
        werkerFn: () => Promise.resolve(klaarWerker()),
        judgeFn: judgeMet(LAAG),
        versWerkmap: (app) => path.join(tmp, app),
        gedrag: 'blokkeer',
      }),
    ).rejects.toThrow(GebruikersFout);
  });

  it('--bijwerk schrijft de huidige scores als nieuwe basislijn', async () => {
    const pad = basislijnPad({});
    await evalueer({
      bijwerk: true,
      goudenSetPad: goudenSetPad(),
      basislijnPad: pad,
      werkerFn: () => Promise.resolve(klaarWerker()),
      judgeFn: judgeMet(HOOG),
      versWerkmap: (app) => path.join(tmp, app),
      nu: new Date(Date.UTC(2026, 8, 23, 12, 0, 0)),
    });

    const geschreven = leesBasislijn(pad);
    expect(geschreven['1']?.totaal).toBe(10);
    expect(geschreven['2']?.totaal).toBe(10);
    expect(geschreven['1']?.tijdstempel).toBe('2026-09-23T12:00:00.000Z');
    expect(tekst()).toContain('basislijn bijgewerkt');
  });

  it('scoort een mislukte werker als 0 zonder de judge aan te roepen', async () => {
    const judgeFn = vi.fn(judgeMet(HOOG));
    await evalueer({
      goudenSetPad: goudenSetPad(),
      basislijnPad: basislijnPad({}),
      werkerFn: () => Promise.resolve(mislukteWerker()),
      judgeFn,
      versWerkmap: (app) => path.join(tmp, app),
      gedrag: 'waarschuw',
    });
    expect(tekst()).toContain('MISLUKT');
    expect(judgeFn).not.toHaveBeenCalled();
  });

  it('valt terug op het gedrag uit package.json ("waarschuw") als er geen wordt meegegeven', async () => {
    // Geen `gedrag`: dan leest evalueer package.json, waar "eval": "waarschuw" staat.
    await expect(
      evalueer({
        goudenSetPad: goudenSetPad(),
        basislijnPad: basislijnPad({
          '1': { totaal: 10, criteria: HOOG, tijdstempel: 't' },
          '2': { totaal: 10, criteria: HOOG, tijdstempel: 't' },
        }),
        werkerFn: () => Promise.resolve(klaarWerker()),
        judgeFn: judgeMet(LAAG),
        versWerkmap: (app) => path.join(tmp, app),
      }),
    ).resolves.toBeUndefined();
    expect(tekst()).toContain('REGRESSIE');
  });

  it('gebruikt $1 als standaardbudget zonder FACTORY_EVAL_BUDGET_USD', async () => {
    const oud = process.env['FACTORY_EVAL_BUDGET_USD'];
    delete process.env['FACTORY_EVAL_BUDGET_USD'];
    const opdrachten: WerkerOpdracht[] = [];
    try {
      await evalueer({
        goudenSetPad: goudenSetPad(),
        basislijnPad: basislijnPad({}),
        werkerFn: (o) => {
          opdrachten.push(o);
          return Promise.resolve(klaarWerker());
        },
        judgeFn: judgeMet(HOOG),
        versWerkmap: (app) => path.join(tmp, app),
        gedrag: 'waarschuw',
      });
    } finally {
      if (oud !== undefined) process.env['FACTORY_EVAL_BUDGET_USD'] = oud;
    }
    expect(opdrachten[0]?.budgetUsd).toBe(1);
  });

  it('toont "omhoog" als de score verder dan de tolerantie boven de basislijn komt', async () => {
    await evalueer({
      goudenSetPad: goudenSetPad(),
      basislijnPad: basislijnPad({
        '1': { totaal: 5, criteria: LAAG, tijdstempel: 't' },
        '2': { totaal: 5, criteria: LAAG, tijdstempel: 't' },
      }),
      werkerFn: () => Promise.resolve(klaarWerker()),
      judgeFn: judgeMet(HOOG),
      versWerkmap: (app) => path.join(tmp, app),
      gedrag: 'waarschuw',
    });
    expect(tekst()).toContain('omhoog');
    expect(tekst()).toContain('geen regressies');
  });

  it('geeft de tijdsgrens door aan de werker', async () => {
    const opdrachten: WerkerOpdracht[] = [];
    await evalueer({
      goudenSetPad: goudenSetPad(),
      basislijnPad: basislijnPad({}),
      werkerFn: (o) => {
        opdrachten.push(o);
        return Promise.resolve(klaarWerker());
      },
      judgeFn: judgeMet(HOOG),
      versWerkmap: (app) => path.join(tmp, app),
      timeoutMs: 1234,
      gedrag: 'waarschuw',
    });
    expect(opdrachten[0]?.timeoutMs).toBe(1234);
  });

  it('draait ook als noch de werker noch de judge kosten meldt', async () => {
    const werkerZonderKosten: WerkerUitkomst = {
      afloop: 'klaar',
      sessie: 's',
      weigeringen: 0,
      verdict: { uitkomst: 'klaar', samenvatting: 's', slices: 1, body: 'b', doorloop: [] },
    };
    await evalueer({
      goudenSetPad: goudenSetPad(),
      basislijnPad: basislijnPad({}),
      werkerFn: () => Promise.resolve(werkerZonderKosten),
      judgeFn: () => Promise.resolve({ scores: HOOG, toelichtingen: HOOG.map(() => 'x') }),
      versWerkmap: (app) => path.join(tmp, app),
      gedrag: 'waarschuw',
    });
    expect(tekst()).toContain('10.0');
  });

  it('weigert --dry en --bijwerk samen', async () => {
    await expect(
      evalueer({ dry: true, bijwerk: true, goudenSetPad: goudenSetPad() }),
    ).rejects.toThrow(GebruikersFout);
  });
});
