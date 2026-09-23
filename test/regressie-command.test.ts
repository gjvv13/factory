import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evalueer,
  leesEvalSoort,
  type EvalWorktree,
  type MaakEvalWorktree,
} from '../src/commands/eval.js';
import { leesBasislijn } from '../src/eval/basislijn.js';
import type { JudgeFn, JudgeVerzoek } from '../src/eval/judge.js';
import { GebruikersFout } from '../src/shell.js';
import type { BouwUitkomst, WerkerOpdracht, WerkerUitkomst } from '../src/werker.js';

const GOUDEN_SET = {
  judgeModel: 'test-model',
  judgeEffort: 'medium',
  items: [
    { issue: 1, app: 'assistant', soort: 'refine', titel: 'Item een', body: 'body-een' },
    { issue: 2, app: 'assistant', soort: 'refine', titel: 'Item twee', body: 'body-twee' },
  ],
};

/** Een gemengde set: twee refine-items en één bouw-item. */
const GEMENGDE_SET = {
  judgeModel: 'test-model',
  judgeEffort: 'medium',
  items: [
    { issue: 1, app: 'assistant', soort: 'refine', titel: 'Refine een', body: 'body-een' },
    { issue: 2, app: 'assistant', soort: 'refine', titel: 'Refine twee', body: 'body-twee' },
    { issue: 3, app: 'beheer', soort: 'bouw', titel: 'Bouw drie', body: 'body-bouw' },
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

function klaarBouwer(): BouwUitkomst {
  return {
    afloop: 'klaar',
    sessie: 's',
    weigeringen: 0,
    kosten: 0.5,
    verdict: {
      uitkomst: 'klaar',
      samenvatting: 'gebouwd',
      criteria: [{ criterium: 'C1', bewijs: 'test.ts:werkt' }],
      doorloop: [],
    },
  };
}

function mislukteBouwer(): BouwUitkomst {
  return { afloop: 'mislukt', sessie: 's', weigeringen: 0, fout: 'de bouwer viel om' };
}

function judgeMet(scores: number[]): JudgeFn {
  return () => Promise.resolve({ scores, toelichtingen: scores.map(() => 'x'), kosten: 0.02 });
}

const HOOG_BOUW = [2, 2, 2, 2, 2]; // 10,0 over vijf bouw-criteria

/** Een gespioneerde worktree-maker die per issue de opruim-aanroepen telt. */
function worktreeSpion(): { maak: MaakEvalWorktree; opgeruimd: number[] } {
  const opgeruimd: number[] = [];
  const maak: MaakEvalWorktree = (app, issue): EvalWorktree => ({
    werkmap: `/tmp/wt/${app}/${String(issue)}`,
    factoryMap: '/tmp/wt/factory',
    opruim: () => {
      opgeruimd.push(issue);
    },
  });
  return { maak, opgeruimd };
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

  it('--dry respecteert --soort: toont alleen wat er zou draaien', async () => {
    await evalueer({ dry: true, soort: 'bouw', goudenSetPad: goudenSetPad(GEMENGDE_SET) });
    // Alleen het bouw-item (#3), niet de refine-items (#1, #2).
    expect(tekst()).toContain('#3');
    expect(tekst()).not.toContain('#1');
    expect(tekst()).not.toContain('#2');
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

  describe('--soort bouw', () => {
    it('draait de bouw-werker in een eval-worktree, scoort met de bouw-rubriek en ruimt op', async () => {
      const spion = worktreeSpion();
      const opdrachten: WerkerOpdracht[] = [];
      const verzoeken: JudgeVerzoek[] = [];
      await evalueer({
        soort: 'bouw',
        goudenSetPad: goudenSetPad(GEMENGDE_SET),
        basislijnPad: basislijnPad({}),
        bouwerFn: (o) => {
          opdrachten.push(o);
          return Promise.resolve(klaarBouwer());
        },
        judgeFn: (v) => {
          verzoeken.push(v);
          return Promise.resolve({ scores: HOOG_BOUW, toelichtingen: HOOG_BOUW.map(() => 'x') });
        },
        maakWorktree: spion.maak,
        diffFn: () => 'DE-DIFF',
        gedrag: 'waarschuw',
      });

      // Alleen het bouw-item (#3) draaide; de refine-items bleven buiten beschouwing.
      expect(opdrachten).toHaveLength(1);
      expect(opdrachten[0]?.agent).toBe('bouwer');
      expect(tekst()).toContain('#3');
      expect(tekst()).toContain('10.0');
      // De judge kreeg de bouw-soort en de diff.
      expect(verzoeken[0]?.soort).toBe('bouw');
      expect(verzoeken[0]?.diff).toBe('DE-DIFF');
      // De worktree is opgeruimd.
      expect(spion.opgeruimd).toEqual([3]);
    });

    it('ruimt de worktree ook op als de bouw-werker gooit (finally)', async () => {
      const spion = worktreeSpion();
      await expect(
        evalueer({
          soort: 'bouw',
          goudenSetPad: goudenSetPad(GEMENGDE_SET),
          basislijnPad: basislijnPad({}),
          bouwerFn: () => Promise.reject(new Error('bouwer klapte')),
          judgeFn: judgeMet(HOOG_BOUW),
          maakWorktree: spion.maak,
          diffFn: () => '',
          gedrag: 'waarschuw',
        }),
      ).rejects.toThrow('bouwer klapte');
      // Ondanks de fout is de worktree opgeruimd.
      expect(spion.opgeruimd).toEqual([3]);
    });

    it('scoort een mislukte bouw-werker als 0 zonder de judge, maar ruimt wél op', async () => {
      const spion = worktreeSpion();
      const judgeFn = vi.fn(judgeMet(HOOG_BOUW));
      await evalueer({
        soort: 'bouw',
        goudenSetPad: goudenSetPad(GEMENGDE_SET),
        basislijnPad: basislijnPad({}),
        bouwerFn: () => Promise.resolve(mislukteBouwer()),
        judgeFn,
        maakWorktree: spion.maak,
        diffFn: () => '',
        gedrag: 'waarschuw',
      });
      expect(tekst()).toContain('MISLUKT');
      expect(judgeFn).not.toHaveBeenCalled();
      expect(spion.opgeruimd).toEqual([3]);
    });

    it('gebruikt $5 als standaard bouw-budget zonder FACTORY_EVAL_BUDGET_USD', async () => {
      const oud = process.env['FACTORY_EVAL_BUDGET_USD'];
      delete process.env['FACTORY_EVAL_BUDGET_USD'];
      const spion = worktreeSpion();
      const opdrachten: WerkerOpdracht[] = [];
      try {
        await evalueer({
          soort: 'bouw',
          goudenSetPad: goudenSetPad(GEMENGDE_SET),
          basislijnPad: basislijnPad({}),
          bouwerFn: (o) => {
            opdrachten.push(o);
            return Promise.resolve(klaarBouwer());
          },
          judgeFn: judgeMet(HOOG_BOUW),
          maakWorktree: spion.maak,
          diffFn: () => '',
          gedrag: 'waarschuw',
        });
      } finally {
        if (oud !== undefined) process.env['FACTORY_EVAL_BUDGET_USD'] = oud;
      }
      expect(opdrachten[0]?.budgetUsd).toBe(5);
    });
  });

  describe('leesEvalSoort', () => {
    it('geeft undefined zonder waarde (beide soorten)', () => {
      expect(leesEvalSoort(undefined)).toBeUndefined();
    });
    it('accepteert refine en bouw', () => {
      expect(leesEvalSoort('refine')).toBe('refine');
      expect(leesEvalSoort('bouw')).toBe('bouw');
    });
    it('weigert een onbekende soort (accepteer heeft geen eval)', () => {
      expect(() => leesEvalSoort('accepteer')).toThrow(GebruikersFout);
    });
  });

  describe('zonder --soort (beide)', () => {
    it('draait zowel de refine- als de bouw-items in één tabel', async () => {
      const spion = worktreeSpion();
      const refineOpdrachten: WerkerOpdracht[] = [];
      const bouwOpdrachten: WerkerOpdracht[] = [];
      await evalueer({
        goudenSetPad: goudenSetPad(GEMENGDE_SET),
        basislijnPad: basislijnPad({}),
        werkerFn: (o) => {
          refineOpdrachten.push(o);
          return Promise.resolve(klaarWerker());
        },
        bouwerFn: (o) => {
          bouwOpdrachten.push(o);
          return Promise.resolve(klaarBouwer());
        },
        judgeFn: (v) =>
          Promise.resolve(
            v.soort === 'bouw'
              ? { scores: HOOG_BOUW, toelichtingen: HOOG_BOUW.map(() => 'x') }
              : { scores: HOOG, toelichtingen: HOOG.map(() => 'x') },
          ),
        versWerkmap: (app) => path.join(tmp, app),
        maakWorktree: spion.maak,
        diffFn: () => 'd',
        gedrag: 'waarschuw',
      });

      expect(refineOpdrachten).toHaveLength(2); // #1 en #2
      expect(bouwOpdrachten).toHaveLength(1); // #3
      expect(tekst()).toContain('#1');
      expect(tekst()).toContain('#3');
      expect(spion.opgeruimd).toEqual([3]);
    });
  });
});
