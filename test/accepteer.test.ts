import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { standaardPaden, type OrkestratorPaden } from '../src/orkestrator-instellingen.js';
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
  type UitkomstBepaler,
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

  it('escaleert bij een niet-waarneembaar criterium: label + comment zonder markering', () => {
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

    // Het item krijgt het escalatie-label (#179).
    const labels = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'issue' &&
        a.argumenten[1] === 'edit' &&
        a.argumenten.includes('--add-label'),
    );
    expect(labels).toHaveLength(1);

    // De comment noemt het criterium en de reden.
    const commentBody = comments[0]?.argumenten.find((arg) => arg.includes('niet-waarneembaar'));
    expect(commentBody).toBeDefined();
  });

  it('escaleert bij een gefaald criterium: label + comment met bewijs', () => {
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
            criterium: 'Boodschap toevoegen werkt',
            status: 'gefaald',
            bewijs: {
              aanroep: 'POST /channels/http/inbound',
              antwoord: '500 Internal Server Error',
            },
          },
        ],
      },
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    // Escalatie-label gezet.
    const labels = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'issue' &&
        a.argumenten[1] === 'edit' &&
        a.argumenten.includes('--add-label'),
    );
    expect(labels).toHaveLength(1);

    // De comment bevat het bewijs: de aanroep en het afwijkende antwoord.
    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);
    const commentBody = comments[0]?.argumenten.join(' ');
    expect(commentBody).toContain('POST /channels/http/inbound');
    expect(commentBody).toContain('500 Internal Server Error');

    // Geen bewijs-markering.
    const markering = comments[0]?.argumenten.find((arg) => arg.includes(ACCEPTEER_MARKERING));
    expect(markering).toBeUndefined();
  });

  it('telt een gemengde uitkomst als niet geaccepteerd: geen markering-comment', () => {
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
          {
            criterium: 'Boodschap toevoegen werkt',
            status: 'gefaald',
            bewijs: {
              aanroep: 'POST /channels/http/inbound',
              antwoord: '500 Internal Server Error',
            },
          },
        ],
      },
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    // Geen bewijs-markering → de wachtrij ziet dit item niet als afgehandeld.
    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);
    const markering = comments[0]?.argumenten.find((arg) => arg.includes(ACCEPTEER_MARKERING));
    expect(markering).toBeUndefined();

    // Het escalatie-label is gezet.
    const labels = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'issue' &&
        a.argumenten[1] === 'edit' &&
        a.argumenten.includes('--add-label'),
    );
    expect(labels).toHaveLength(1);
  });

  it('noemt het item, het criterium en de reden in het escalatiebericht', () => {
    const { aanroepen } = zetBeideUitvoerdersOp();
    const item = testItem({ issue: 42, app: 'assistant', titel: 'Nieuwe feature' });
    const uitkomst: AccepteerUitkomst = {
      afloop: 'klaar',
      sessie: 'test-sessie',
      weigeringen: 0,
      verdict: {
        uitkomst: 'klaar',
        criteria: [
          {
            criterium: 'Refactor in core is doorgevoerd',
            status: 'niet-waarneembaar',
          },
        ],
      },
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);
    const body = comments[0]?.argumenten.join(' ');
    // Noemt het issue en de app.
    expect(body).toContain('#42');
    expect(body).toContain('assistant');
    // Noemt het criterium.
    expect(body).toContain('Refactor in core is doorgevoerd');
    // Noemt de reden.
    expect(body).toContain('niet-waarneembaar');
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

// --- verwerkAcceptatie: de escalatie- en geen-verdict-takken (#178) ---

describe('verwerkAcceptatie — escalatie en geen bruikbaar verdict', () => {
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

  it('escaleert een escalatie-verdict: label + comment met vraag en advies', () => {
    const { aanroepen } = zetBeideUitvoerdersOp();
    const item = testItem();
    const uitkomst: AccepteerUitkomst = {
      afloop: 'escalatie',
      sessie: 'test-sessie',
      weigeringen: 0,
      verdict: {
        uitkomst: 'escalatie',
        vraag: 'Welke acc-omgeving telt als waarheid?',
        advies: 'Neem contact op met de eigenaar.',
      },
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    // Escalatie-label gezet.
    const labels = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'issue' &&
        a.argumenten[1] === 'edit' &&
        a.argumenten.includes('--add-label'),
    );
    expect(labels).toHaveLength(1);

    // Precies één comment, met vraag én advies, zonder bewijs-markering.
    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);
    const body = comments[0]?.argumenten.join(' ');
    expect(body).toContain('Acceptatie-escalatie');
    expect(body).toContain('Welke acc-omgeving telt als waarheid?');
    expect(body).toContain('Neem contact op met de eigenaar.');
    const markering = comments[0]?.argumenten.find((arg) => arg.includes(ACCEPTEER_MARKERING));
    expect(markering).toBeUndefined();
  });

  it('blokkeert zonder comment als er geen bruikbaar verdict is', () => {
    const { aanroepen } = zetBeideUitvoerdersOp();
    const item = testItem();
    // Geen 'mislukt', maar ook geen verdict: de defensieve tak (#178) zet wel een
    // label maar plaatst geen comment.
    const uitkomst: AccepteerUitkomst = {
      afloop: 'klaar',
      sessie: 'test-sessie',
      weigeringen: 0,
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    // Wel een escalatie-label.
    const labels = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'issue' &&
        a.argumenten[1] === 'edit' &&
        a.argumenten.includes('--add-label'),
    );
    expect(labels).toHaveLength(1);

    // Maar geen enkele comment.
    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(0);
  });
});

// --- kiesAccepteerItem: de foutpaden, via de publieke ingang orkestreerAccepteer ---

describe('orkestreer --soort accepteer --issue — de keuze-foutpaden', () => {
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

  it('kiest het gevraagde item als het in de wachtrij staat', async () => {
    // Geen factory.json → de dry-run stopt netjes bij accPoortVan, maar het gekozen
    // item (#202, niet de kop #201) is dan al bepaald.
    stelUitvoerderIn(metBord().uitvoerder);

    await orkestreerAccepteer({ dry: true, issue: 202, werkplaatsWortel: '/niet-bestaand' });

    const tekst = uitvoer.join('');
    expect(tekst).toMatch(/Zou nu toetsen: #202 \(assistant\)/);
    expect(tekst).toMatch(/Geen factory\.json/);
  });

  it('weigert een issue dat op een andere kolom staat, met de kolomnaam', async () => {
    stelUitvoerderIn(metBord().uitvoerder);

    // #204 staat op Klaar voor Bouwen, niet op Uitrollen.
    await expect(orkestreerAccepteer({ dry: true, issue: 204 })).rejects.toThrow(
      /#204 staat niet in de accepteer-wachtrij.*Klaar voor Bouwen.*Uitrollen/s,
    );
  });

  it('weigert een issue op de juiste kolom dat uit de wachtrij valt (al geaccepteerd)', async () => {
    // #202 heeft al een bewijs-comment → het valt uit de wachtrij, maar staat wel op
    // Uitrollen in de board-lezing.
    const comments = new Map<number, string>();
    comments.set(202, commentFixture([`Acceptatie-bewijs\n\n${ACCEPTEER_MARKERING}`]));
    stelUitvoerderIn(metBord(comments).uitvoerder);

    await expect(orkestreerAccepteer({ dry: true, issue: 202 })).rejects.toThrow(
      /#202 staat op Uitrollen maar valt uit de wachtrij/,
    );
  });

  it('weigert een issue dat niet in de board-lezing zit', async () => {
    stelUitvoerderIn(metBord().uitvoerder);

    await expect(orkestreerAccepteer({ dry: true, issue: 999 })).rejects.toThrow(
      /#999 staat niet op het board, of is gesloten/,
    );
  });
});

// --- Kleine gaten: accepteerWachtrij, accPoortVan, versieDekt ---

describe('accepteerWachtrij — item zonder App-veld', () => {
  afterEach(() => {
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('slaat een Uitrollen-item zonder App-veld over', () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stelUitvoerderIn(metBord().uitvoerder);

    const items = [
      {
        issue: 301,
        titel: 'Item zonder app',
        kolom: 'Uitrollen',
        aangemaakt: '2026-08-10T00:00:00Z',
        labels: ['type:task'],
      },
      {
        issue: 302,
        titel: 'Item met app',
        app: 'assistant',
        kolom: 'Uitrollen',
        aangemaakt: '2026-08-11T00:00:00Z',
        labels: ['type:task'],
      },
    ];

    const rij = accepteerWachtrij(items);

    // Alleen het item met een App-veld komt in de rij.
    expect(rij.map((item) => item.issue)).toEqual([302]);
  });
});

describe('accPoortVan — ongeldige factory.json', () => {
  it('geeft undefined als factory.json geen geldige JSON is', async () => {
    const tmpWortel = mkdtempSync(path.join(os.tmpdir(), 'factory-poort-kapot-'));
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const appDir = path.join(tmpWortel, 'assistant');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(path.join(appDir, 'factory.json'), '{ dit is geen json');

    try {
      expect(accPoortVan('assistant', tmpWortel)).toBeUndefined();
    } finally {
      rmSync(tmpWortel, { recursive: true, force: true });
    }
  });
});

describe('versieDekt — major en minor', () => {
  it('geeft true als de major hoger is', () => {
    expect(versieDekt('2.0.0', 'v1.9.9')).toBe(true);
  });

  it('geeft false als de major lager is', () => {
    expect(versieDekt('1.9.9', 'v2.0.0')).toBe(false);
  });

  it('geeft false als de minor lager is bij gelijke major', () => {
    expect(versieDekt('1.14.99', 'v1.15.0')).toBe(false);
  });
});

// --- accVersie: de niet-ok-respons ---

describe('accVersie', () => {
  it('geeft geen draaiende versie bij een niet-ok health-respons', async () => {
    const { accVersie } = await import('../src/commands/orkestreer-accepteer.js');
    const oorspronkelijkeFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('503 Service Unavailable'),
    }) as typeof fetch;

    try {
      const info = await accVersie(3002);
      expect(info.poort).toBe(3002);
      expect(info.draaiend).toBeUndefined();
      expect(info.healthBody).toBeUndefined();
    } finally {
      globalThis.fetch = oorspronkelijkeFetch;
    }
  });
});

// --- De volledige --eenmalig-keten: van preconditie tot bewijs-comment ---

describe('orkestreer --soort accepteer --eenmalig', () => {
  let herstelOmgeving: () => void;
  let uitvoer: string[];
  let wortel: string;
  let home: string;
  let paden: OrkestratorPaden;
  let oorspronkelijkeFetch: typeof fetch;

  beforeEach(async () => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    wortel = mkdtempSync(path.join(os.tmpdir(), 'factory-acc-'));
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-acc-home-'));
    paden = standaardPaden(home);
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
    oorspronkelijkeFetch = globalThis.fetch;
    // Schrijf een factory.json zodat accPoortVan de acc-poort vindt.
    const appDir = path.join(wortel, 'assistant');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, 'factory.json'),
      JSON.stringify({
        naam: 'assistant',
        poorten: { dev: 3001, acc: 3002, prod: 3000 },
        envRoot: '~/AppEnvs/assistant',
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = oorspronkelijkeFetch;
    rmSync(wortel, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    herstelOmgeving();
    herstelUitvoerder();
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  /** Een envelop zoals `claude --json-schema` hem teruggeeft, met een accepteer-verdict. */
  function claudeEnvelop(structured: unknown): string {
    return JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: 'acc-sessie-1',
      num_turns: 7,
      total_cost_usd: 0.42,
      permission_denials: [],
      result: 'zie verdict',
      structured_output: structured,
    });
  }

  /** Machine: board, comments, git-tag, versWerkplaats-clone en de claude-run. */
  function machine(structured: unknown): UitkomstBepaler {
    return ({ commando, argumenten }) => {
      if (commando === 'claude') {
        return { stdout: claudeEnvelop(structured) };
      }
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
      // git log: de merge-commit van het issue; git tag: de dekkende tag.
      if (commando === 'git' && argumenten[0] === 'log') {
        return { stdout: 'abc123def456' };
      }
      if (commando === 'git' && argumenten[0] === 'tag') {
        return { stdout: 'v1.15.54' };
      }
      return {};
    };
  }

  it('plaatst een bewijs-comment als de werker alles waarneemt', async () => {
    // Acc draait een versie die de verwachte tag dekt.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(healthBody()),
    }) as typeof fetch;

    const { aanroepen } = zetBeideUitvoerdersOp(
      machine({
        uitkomst: 'klaar',
        criteria: [
          {
            criterium: 'Health geeft ok',
            status: 'waargenomen',
            bewijs: { aanroep: 'GET /health', antwoord: '200 ok' },
          },
        ],
      }),
    );

    await orkestreerAccepteer({ eenmalig: true, werkplaatsWortel: wortel, paden });

    // De werker is echt gedraaid.
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(true);

    // Precies één bewijs-comment met de markering.
    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);
    const body = comments[0]?.argumenten.find((arg) => arg.includes(ACCEPTEER_MARKERING));
    expect(body).toBeDefined();
  });

  it('slaat de werker over als acc niet bereikbaar is', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof fetch;

    const { aanroepen } = zetBeideUitvoerdersOp(machine({ uitkomst: 'klaar', criteria: [] }));

    await orkestreerAccepteer({ eenmalig: true, werkplaatsWortel: wortel, paden });

    // Geen claude-run, geen comment: de preconditie hield de run tegen.
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    const tekst = uitvoer.join('');
    expect(tekst).toMatch(/niet bereikbaar/);
  });

  it('slaat de werker over als acc de verwachte versie nog niet draait', async () => {
    // Acc draait een oudere versie dan de verwachte tag.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ version: '1.15.50', status: 'ok' })),
    }) as typeof fetch;

    const { aanroepen } = zetBeideUitvoerdersOp(machine({ uitkomst: 'klaar', criteria: [] }));

    await orkestreerAccepteer({ eenmalig: true, werkplaatsWortel: wortel, paden });

    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    const tekst = uitvoer.join('');
    expect(tekst).toMatch(/acceptatie overgeslagen/);
  });

  it('logt kosten noch beurten als de envelop ze weglaat', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(healthBody()),
    }) as typeof fetch;

    // Een envelop zonder num_turns en total_cost_usd: beschrijfAcceptatie moet dan
    // beide velden weglaten in plaats van undefined te loggen.
    const kaleEnvelop = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: 'acc-sessie-kaal',
      permission_denials: [],
      result: 'zie verdict',
      structured_output: {
        uitkomst: 'klaar',
        criteria: [
          {
            criterium: 'Health geeft ok',
            status: 'waargenomen',
            bewijs: { aanroep: 'GET /health', antwoord: '200 ok' },
          },
        ],
      },
    });

    const { aanroepen } = zetBeideUitvoerdersOp(({ commando, argumenten }) => {
      if (commando === 'claude') return { stdout: kaleEnvelop };
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
      if (commando === 'git' && argumenten[0] === 'log') return { stdout: 'abc123def456' };
      if (commando === 'git' && argumenten[0] === 'tag') return { stdout: 'v1.15.54' };
      return {};
    });

    await orkestreerAccepteer({ eenmalig: true, werkplaatsWortel: wortel, paden });

    // De run is gedraaid en heeft een bewijs-comment geplaatst.
    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);
  });
});

// --- Restant-takken: precondities en foutranden ---

describe('orkestreerAccepteer — precondities', () => {
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

  it('weigert --dry en --eenmalig samen', async () => {
    stelUitvoerderIn(metBord().uitvoerder);
    await expect(orkestreerAccepteer({ dry: true, eenmalig: true })).rejects.toThrow(
      /sluiten elkaar uit/,
    );
  });

  it('faalt als het board niet gelezen kan worden', async () => {
    // Een lege stdout op de graphql-lezing maakt bordItems undefined.
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: '' })).uitvoerder);
    await expect(orkestreerAccepteer({ dry: true })).rejects.toThrow(/board niet lezen/);
  });

  it('meldt "niets te accepteren" bij een lege wachtrij zonder issue', async () => {
    // Elk item draagt al een bewijs-comment → de wachtrij is leeg.
    const comments = new Map<number, string>();
    for (const nr of [201, 202, 203]) {
      comments.set(nr, commentFixture([`Acceptatie-bewijs\n\n${ACCEPTEER_MARKERING}`]));
    }
    stelUitvoerderIn(metBord(comments).uitvoerder);

    await orkestreerAccepteer({ dry: true });

    expect(uitvoer.join('')).toMatch(/niets te accepteren/);
  });
});

// --- verwerkAcceptatie: de resterende string-takken bij een mislukte run ---

describe('verwerkAcceptatie — mislukt-varianten en gefaald zonder bewijs', () => {
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

  it('noemt kosten en beurten in de mislukt-comment als ze er zijn', () => {
    const { aanroepen } = zetBeideUitvoerdersOp();
    const item = testItem();
    const uitkomst: AccepteerUitkomst = {
      afloop: 'mislukt',
      sessie: 'test-sessie',
      weigeringen: 0,
      fout: 'timeout',
      kosten: 2.5,
      beurten: 12,
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);
    const body = comments[0]?.argumenten.join(' ');
    expect(body).toContain('$2.50');
    expect(body).toContain('12 beurten');
  });

  it('valt terug op "onbekende fout" als een mislukte run geen fout meldt', () => {
    const { aanroepen } = zetBeideUitvoerdersOp();
    const item = testItem();
    const uitkomst: AccepteerUitkomst = {
      afloop: 'mislukt',
      sessie: 'test-sessie',
      weigeringen: 0,
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);
    const body = comments[0]?.argumenten.join(' ');
    expect(body).toContain('onbekende fout');
  });

  it('escaleert een gefaald criterium zonder bewijs zonder aanroep-regel', () => {
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
            criterium: 'Boodschap toevoegen werkt',
            status: 'gefaald',
          },
        ],
      },
    };

    verwerkAcceptatie(item, uitkomst, '/tmp/test');

    const comments = aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comments).toHaveLength(1);
    const body = comments[0]?.argumenten.join(' ');
    expect(body).toContain('gefaald');
    // Zonder bewijs staat er geen "Aanroep:"-regel in de details.
    expect(body).not.toContain('Aanroep:');
  });
});

// --- accVersie zonder versie in de body, en versieDekt met korte strings ---

describe('accVersie — health zonder versie', () => {
  it('geeft de body terug maar geen draaiende versie', async () => {
    const { accVersie } = await import('../src/commands/orkestreer-accepteer.js');
    const oorspronkelijkeFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ status: 'ok' })),
    }) as typeof fetch;

    try {
      const info = await accVersie(3002);
      expect(info.poort).toBe(3002);
      expect(info.draaiend).toBeUndefined();
      expect(info.healthBody).toBe(JSON.stringify({ status: 'ok' }));
    } finally {
      globalThis.fetch = oorspronkelijkeFetch;
    }
  });
});

describe('versieDekt — onvolledige versiestrings', () => {
  it('behandelt ontbrekende delen als 0', () => {
    // '1' → [1,0,0]; dekt '1.0.0'.
    expect(versieDekt('1', 'v1.0.0')).toBe(true);
    // '1.0' → [1,0,0]; dekt niet '1.0.1'.
    expect(versieDekt('1.0', 'v1.0.1')).toBe(false);
  });
});
