import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accepteerWachtrij,
  accPoortVan,
  ACCEPTEER_MARKERING,
  orkestreerAccepteer,
  verwerkAcceptatie,
  versieDekt,
  verwachteTag,
  type Accepteeritem,
} from '../src/commands/orkestreer-accepteer.js';
import { bordItems } from '../src/board.js';
import { herstelUitvoerder, herstelAsyncUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import {
  maakUitvoerderOpnemer,
  zetBoardOmgeving,
  zetBeideUitvoerdersOp,
  type ProcesAanroep,
} from './helpers.js';
import type { AccepteerUitkomst } from '../src/werker.js';

const hier = path.dirname(fileURLToPath(import.meta.url));

/** De opgenomen board-uitvoer met Uitrollen-items. */
function bord(): string {
  return readFileSync(path.join(hier, 'fixtures', 'project-items-uitrollen.json'), 'utf8');
}

/** De opgenomen /health-respons van acc. */
function healthBody(): string {
  return readFileSync(path.join(hier, 'fixtures', 'acc-health.json'), 'utf8');
}

/** Een uitvoerder die elke board-lezing met de fixture antwoordt. */
function metBord(commentAntwoorden?: Map<number, string>) {
  return maakUitvoerderOpnemer(({ commando, argumenten }) => {
    if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql') {
      return { stdout: bord() };
    }
    // orkestratorComments: REST-aanroep voor comments per issue.
    if (
      commando === 'gh' &&
      argumenten[0] === 'api' &&
      typeof argumenten[1] === 'string' &&
      argumenten[1].includes('/comments')
    ) {
      // Haal het issuenummer uit de URL.
      const match = /issues\/(\d+)\/comments/.exec(argumenten[1]);
      if (match?.[1] !== undefined) {
        const issueNr = Number(match[1]);
        const antwoord = commentAntwoorden?.get(issueNr);
        if (antwoord !== undefined) {
          return { stdout: antwoord };
        }
      }
      // Geen comments: leeg antwoord.
      return { stdout: '' };
    }
    return {};
  });
}

/** Telt het aantal board-lezingen (GraphQL-aanroepen met de wachtrij-query). */
function boardLezingen(aanroepen: ProcesAanroep[]): number {
  return aanroepen.filter((a) =>
    a.argumenten.some((arg) => arg.startsWith('query=') && arg.includes('items(first:100')),
  ).length;
}

/** Maakt een base64-gecodeerd JSON-antwoord zoals orkestratorComments het verwacht. */
function commentFixture(bodies: string[]): string {
  return Buffer.from(JSON.stringify(bodies)).toString('base64');
}

describe('de accepteer-wachtrij', () => {
  let herstelOmgeving: () => void;
  let uitvoer: string[];

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('neemt alleen items uit Uitrollen, oudste eerst', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = accepteerWachtrij(bordItems() ?? []);

    // Alleen #201, #202, #203 staan op Uitrollen. #204 staat op Klaar voor Bouwen,
    // #205 staat op Done.
    expect(rij.map((item) => item.issue)).toEqual([201, 202, 203]);
  });

  it('filtert items die al een bewijs-comment dragen (idempotent)', () => {
    // #202 heeft al een bewijs-comment van de accepteer-werker.
    const comments = new Map<number, string>();
    comments.set(
      202,
      commentFixture([`Acceptatie-bewijs\n\n${ACCEPTEER_MARKERING}\nAlles getoetst.`]),
    );
    stelUitvoerderIn(metBord(comments).uitvoerder);

    const rij = accepteerWachtrij(bordItems() ?? []);

    expect(rij.map((item) => item.issue)).toEqual([201, 203]);
    // #202 is eruit gefilterd: al geaccepteerd.
    expect(rij.map((item) => item.issue)).not.toContain(202);
  });
});

describe('orkestreer --soort accepteer --dry', () => {
  let herstelOmgeving: () => void;
  let uitvoer: string[];

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('toont de wachtrij en schrijft niets', async () => {
    const { uitvoerder, aanroepen } = metBord();
    stelUitvoerderIn(uitvoerder);

    await orkestreerAccepteer({ dry: true });

    // De wachtrij verschijnt in de uitvoer.
    const tekst = uitvoer.join('');
    expect(tekst).toMatch(/#201/);
    expect(tekst).toMatch(/#202/);
    expect(tekst).toMatch(/#203/);

    // Geen claude, geen git, geen schrijvende gh-aanroep.
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'git')).toBe(false);
    expect(
      aanroepen.some(
        (a) =>
          a.commando === 'gh' &&
          (a.argumenten[0] === 'project' ||
            a.argumenten[0] === 'issue' ||
            a.argumenten[0] === 'pr'),
      ),
    ).toBe(false);
  });

  it('leest het board precies één keer', async () => {
    const { uitvoerder, aanroepen } = metBord();
    stelUitvoerderIn(uitvoerder);

    await orkestreerAccepteer({ dry: true });

    // De harness-regel van #153: één board-lezing per run, ook met meerdere items.
    expect(boardLezingen(aanroepen)).toBe(1);
  });

  it('weigert te draaien zonder --dry', async () => {
    stelUitvoerderIn(metBord().uitvoerder);

    await expect(orkestreerAccepteer({})).rejects.toThrow(/--dry/);
  });

  it('meldt de acc-poort en draaiende versie voor het gekozen item', async () => {
    // Schrijf een factory.json naar een tijdelijke werkplaats zodat accPoortVan hem vindt.
    const tmpWortel = path.join(hier, '..', 'test-werkplaats-accepteer');
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const appDir = path.join(tmpWortel, 'assistant');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'factory.json'),
      JSON.stringify({
        naam: 'assistant',
        poorten: { dev: 3001, acc: 3002, prod: 3000 },
        envRoot: '~/AppEnvs/assistant',
      }),
    );

    try {
      // Mock fetch om de health-respons te geven.
      const oorspronkelijkeFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(healthBody()),
      }) as typeof fetch;

      stelUitvoerderIn(metBord().uitvoerder);

      await orkestreerAccepteer({ dry: true, werkplaatsWortel: tmpWortel });

      const tekst = uitvoer.join('');
      expect(tekst).toMatch(/acc-poort:\s*3002/);
      expect(tekst).toMatch(/acc draait:\s*1\.15\.54/);

      globalThis.fetch = oorspronkelijkeFetch;
    } finally {
      rmSync(tmpWortel, { recursive: true, force: true });
    }
  });

  it('meldt als acc niet bereikbaar is', async () => {
    const tmpWortel = path.join(hier, '..', 'test-werkplaats-accepteer-2');
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const appDir = path.join(tmpWortel, 'assistant');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'factory.json'),
      JSON.stringify({
        naam: 'assistant',
        poorten: { dev: 3001, acc: 3002, prod: 3000 },
        envRoot: '~/AppEnvs/assistant',
      }),
    );

    try {
      const oorspronkelijkeFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof fetch;

      stelUitvoerderIn(metBord().uitvoerder);

      await orkestreerAccepteer({ dry: true, werkplaatsWortel: tmpWortel });

      const tekst = uitvoer.join('');
      expect(tekst).toMatch(/acc-poort:\s*3002/);
      expect(tekst).toMatch(/niet bereikbaar/);

      globalThis.fetch = oorspronkelijkeFetch;
    } finally {
      rmSync(tmpWortel, { recursive: true, force: true });
    }
  });
});

describe('accPoortVan', () => {
  it('leest de acc-poort uit factory.json in de werkplaats', async () => {
    const tmpWortel = path.join(hier, '..', 'test-werkplaats-port');
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const appDir = path.join(tmpWortel, 'assistant');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'factory.json'),
      JSON.stringify({
        naam: 'assistant',
        poorten: { dev: 3001, acc: 3002, prod: 3000 },
        envRoot: '~/AppEnvs/assistant',
      }),
    );

    try {
      expect(accPoortVan('assistant', tmpWortel)).toBe(3002);
    } finally {
      rmSync(tmpWortel, { recursive: true, force: true });
    }
  });

  it('geeft undefined als factory.json niet bestaat', () => {
    expect(accPoortVan('onbekend', '/niet-bestaand')).toBeUndefined();
  });
});

describe('leesSoort accepteert accepteer', () => {
  // leesSoort wordt al getest in orkestreer-bouw.test.ts; hier alleen de nieuwe waarde.
  it('retourneert accepteer voor --soort accepteer', async () => {
    const { leesSoort } = await import('../src/commands/orkestreer-bouw.js');
    expect(leesSoort('accepteer')).toBe('accepteer');
  });
});

describe('versieDekt', () => {
  it('geeft true als draaiend gelijk is aan verwacht', () => {
    expect(versieDekt('1.15.54', 'v1.15.54')).toBe(true);
  });

  it('geeft true als draaiend nieuwer is (patch)', () => {
    expect(versieDekt('1.15.55', 'v1.15.54')).toBe(true);
  });

  it('geeft true als draaiend nieuwer is (minor)', () => {
    expect(versieDekt('1.16.0', 'v1.15.54')).toBe(true);
  });

  it('geeft false als draaiend ouder is', () => {
    expect(versieDekt('1.15.53', 'v1.15.54')).toBe(false);
  });

  it('behandelt v-prefix in beide strings', () => {
    expect(versieDekt('v1.15.54', 'v1.15.54')).toBe(true);
  });
});

describe('verwachteTag', () => {
  beforeEach(() => {
    herstelUitvoerder();
  });

  afterEach(() => {
    herstelUitvoerder();
  });

  it('vindt de oudste tag die de merge van een issue bevat', () => {
    stelUitvoerderIn(
      maakUitvoerderOpnemer(({ commando, argumenten }) => {
        if (commando === 'git' && argumenten[0] === 'log') {
          return { stdout: 'abc123def' };
        }
        if (commando === 'git' && argumenten[0] === 'tag') {
          return { stdout: 'v1.15.54\nv1.15.55\nv1.16.0' };
        }
        return {};
      }).uitvoerder,
    );

    expect(verwachteTag(201, '/pad/naar/app')).toBe('v1.15.54');
  });

  it('geeft undefined als er geen merge-commit gevonden wordt', () => {
    stelUitvoerderIn(
      maakUitvoerderOpnemer(({ commando }) => {
        if (commando === 'git') {
          return { stdout: '' };
        }
        return {};
      }).uitvoerder,
    );

    expect(verwachteTag(201, '/pad/naar/app')).toBeUndefined();
  });

  it('geeft undefined als er geen tag de commit bevat', () => {
    stelUitvoerderIn(
      maakUitvoerderOpnemer(({ commando, argumenten }) => {
        if (commando === 'git' && argumenten[0] === 'log') {
          return { stdout: 'abc123def' };
        }
        if (commando === 'git' && argumenten[0] === 'tag') {
          return { stdout: '' };
        }
        return {};
      }).uitvoerder,
    );

    expect(verwachteTag(201, '/pad/naar/app')).toBeUndefined();
  });
});

// --- verwerkAcceptatie unit-tests (#178) ---

/** Een test-item op Uitrollen. */
function testItem(overrides?: Partial<Accepteeritem>): Accepteeritem {
  return {
    issue: 201,
    titel: 'Nieuwe intentie: boodschappen toevoegen',
    app: 'assistant',
    kolom: 'Uitrollen',
    aangemaakt: '2026-08-10T00:00:00Z',
    labels: ['type:task'],
    ...overrides,
  };
}

describe('verwerkAcceptatie', () => {
  let herstelOmgeving: () => void;

  beforeEach(() => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('plaatst precies één bewijs-comment bij alles-waargenomen', () => {
    const { aanroepen } = zetBeideUitvoerdersOp();
    const item = testItem();
    const uitkomst: AccepteerUitkomst = {
      afloop: 'klaar',
      sessie: 'test-sessie',
      weigeringen: 0,
      kosten: 1.23,
      beurten: 8,
      verdict: {
        uitkomst: 'klaar',
        criteria: [
          {
            criterium: 'Health geeft ok',
            status: 'waargenomen',
            bewijs: { aanroep: 'GET /health', antwoord: '200 ok' },
          },
        ],
      },
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    // Er is precies één comment geplaatst.
    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);

    // De comment bevat de bewijs-markering.
    const body = comments[0]?.argumenten.find((arg) => arg.includes(ACCEPTEER_MARKERING));
    expect(body).toBeDefined();
  });

  it('verplaatst het item niet bij alles-waargenomen', () => {
    const { aanroepen } = zetBeideUitvoerdersOp();
    const item = testItem();
    const uitkomst: AccepteerUitkomst = {
      afloop: 'klaar',
      sessie: 'test-sessie',
      weigeringen: 0,
      verdict: {
        uitkomst: 'klaar',
        criteria: [
          {
            criterium: 'Health geeft ok',
            status: 'waargenomen',
            bewijs: { aanroep: 'GET /health', antwoord: '200 ok' },
          },
        ],
      },
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    // Geen kolom-mutatie: het item blijft in Uitrollen.
    const kolomMutaties = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'api' &&
        a.argumenten[1] === 'graphql' &&
        a.argumenten.some((arg) => arg.includes('updateProjectV2ItemFieldValue')),
    );
    expect(kolomMutaties).toHaveLength(0);
  });

  it('plaatst geen bewijs-comment als niet alles waargenomen is', () => {
    const { aanroepen } = zetBeideUitvoerdersOp();
    const item = testItem();
    const uitkomst: AccepteerUitkomst = {
      afloop: 'klaar',
      sessie: 'test-sessie',
      weigeringen: 0,
      verdict: {
        uitkomst: 'klaar',
        criteria: [
          {
            criterium: 'Health geeft ok',
            status: 'waargenomen',
            bewijs: { aanroep: 'GET /health', antwoord: '200 ok' },
          },
          {
            criterium: 'Tests dekken het gedrag',
            status: 'niet-waarneembaar',
          },
        ],
      },
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    // Er is een comment geplaatst, maar zonder de bewijs-markering.
    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);
    const body = comments[0]?.argumenten.find((arg) => arg.includes(ACCEPTEER_MARKERING));
    expect(body).toBeUndefined();
  });

  it('plaatst geen bewijs-comment bij een mislukte run (is_error)', () => {
    const { aanroepen } = zetBeideUitvoerdersOp();
    const item = testItem();
    const uitkomst: AccepteerUitkomst = {
      afloop: 'mislukt',
      sessie: 'test-sessie',
      weigeringen: 0,
      fout: 'run mislukt: acc niet bereikbaar',
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    // Er is een comment geplaatst, maar zonder de bewijs-markering.
    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);
    const body = comments[0]?.argumenten.find((arg) => arg.includes(ACCEPTEER_MARKERING));
    expect(body).toBeUndefined();

    // Het item krijgt het escalatie-label.
    const labels = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'issue' &&
        a.argumenten[1] === 'edit' &&
        a.argumenten.includes('--add-label'),
    );
    expect(labels).toHaveLength(1);
  });
});

describe('acc-versie-preconditie', () => {
  let herstelOmgeving: () => void;
  let uitvoer: string[];

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('meldt dat acc de nieuwe versie dekt als de draaiende versie nieuw genoeg is', async () => {
    const tmpWortel = path.join(hier, '..', 'test-werkplaats-accepteer-dekt');
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const appDir = path.join(tmpWortel, 'assistant');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'factory.json'),
      JSON.stringify({
        naam: 'assistant',
        poorten: { dev: 3001, acc: 3002, prod: 3000 },
        envRoot: '~/AppEnvs/assistant',
      }),
    );

    try {
      const oorspronkelijkeFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(healthBody()),
      }) as typeof fetch;

      // Board + git: merge-commit gevonden, tag gevonden, versie dekt.
      stelUitvoerderIn(
        maakUitvoerderOpnemer(({ commando, argumenten }) => {
          if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql') {
            return { stdout: bord() };
          }
          if (
            commando === 'gh' &&
            argumenten[0] === 'api' &&
            typeof argumenten[1] === 'string' &&
            argumenten[1].includes('/comments')
          ) {
            return { stdout: '' };
          }
          // git log: merge-commit voor issue 201
          if (commando === 'git' && argumenten[0] === 'log') {
            return { stdout: 'abc123def456' };
          }
          // git tag --contains: de tag die de merge bevat
          if (commando === 'git' && argumenten[0] === 'tag') {
            return { stdout: 'v1.15.54' };
          }
          return {};
        }).uitvoerder,
      );

      await orkestreerAccepteer({ dry: true, werkplaatsWortel: tmpWortel });

      const tekst = uitvoer.join('');
      expect(tekst).toMatch(/1\.15\.54 ✓/);
      expect(tekst).toMatch(/verwacht ≥ v1\.15\.54/);

      globalThis.fetch = oorspronkelijkeFetch;
    } finally {
      rmSync(tmpWortel, { recursive: true, force: true });
    }
  });

  it('meldt dat acc de nieuwe versie nog niet draait als de versie te oud is', async () => {
    const tmpWortel = path.join(hier, '..', 'test-werkplaats-accepteer-oud');
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const appDir = path.join(tmpWortel, 'assistant');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'factory.json'),
      JSON.stringify({
        naam: 'assistant',
        poorten: { dev: 3001, acc: 3002, prod: 3000 },
        envRoot: '~/AppEnvs/assistant',
      }),
    );

    try {
      const oorspronkelijkeFetch = globalThis.fetch;
      // Acc draait een oudere versie.
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ version: '1.15.50', status: 'ok' })),
      }) as typeof fetch;

      stelUitvoerderIn(
        maakUitvoerderOpnemer(({ commando, argumenten }) => {
          if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql') {
            return { stdout: bord() };
          }
          if (
            commando === 'gh' &&
            argumenten[0] === 'api' &&
            typeof argumenten[1] === 'string' &&
            argumenten[1].includes('/comments')
          ) {
            return { stdout: '' };
          }
          if (commando === 'git' && argumenten[0] === 'log') {
            return { stdout: 'abc123def456' };
          }
          if (commando === 'git' && argumenten[0] === 'tag') {
            return { stdout: 'v1.15.54' };
          }
          return {};
        }).uitvoerder,
      );

      await orkestreerAccepteer({ dry: true, werkplaatsWortel: tmpWortel });

      const tekst = uitvoer.join('');
      expect(tekst).toMatch(/1\.15\.50 ✗/);
      expect(tekst).toMatch(/verwacht ≥ v1\.15\.54/);
      expect(tekst).toMatch(/nog niet/);

      globalThis.fetch = oorspronkelijkeFetch;
    } finally {
      rmSync(tmpWortel, { recursive: true, force: true });
    }
  });

  it('meldt dat acc niet bereikbaar is zonder te accepteren', async () => {
    const tmpWortel = path.join(hier, '..', 'test-werkplaats-accepteer-onb');
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const appDir = path.join(tmpWortel, 'assistant');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'factory.json'),
      JSON.stringify({
        naam: 'assistant',
        poorten: { dev: 3001, acc: 3002, prod: 3000 },
        envRoot: '~/AppEnvs/assistant',
      }),
    );

    try {
      const oorspronkelijkeFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof fetch;

      stelUitvoerderIn(
        maakUitvoerderOpnemer(({ commando, argumenten }) => {
          if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql') {
            return { stdout: bord() };
          }
          if (
            commando === 'gh' &&
            argumenten[0] === 'api' &&
            typeof argumenten[1] === 'string' &&
            argumenten[1].includes('/comments')
          ) {
            return { stdout: '' };
          }
          return {};
        }).uitvoerder,
      );

      await orkestreerAccepteer({ dry: true, werkplaatsWortel: tmpWortel });

      const tekst = uitvoer.join('');
      expect(tekst).toMatch(/niet bereikbaar/);
      expect(tekst).toMatch(/nog niet/);

      globalThis.fetch = oorspronkelijkeFetch;
    } finally {
      rmSync(tmpWortel, { recursive: true, force: true });
    }
  });
});
