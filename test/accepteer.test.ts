import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accepteerWachtrij,
  accPoortVan,
  ACCEPTEER_MARKERING,
  orkestreerAccepteer,
} from '../src/commands/orkestreer-accepteer.js';
import { bordItems } from '../src/board.js';
import { herstelUitvoerder, herstelAsyncUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, zetBoardOmgeving, type ProcesAanroep } from './helpers.js';

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
