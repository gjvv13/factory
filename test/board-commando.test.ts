import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { board, vereisKolom } from '../src/commands/board.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, zetBoardOmgeving, type ProcesAanroep } from './helpers.js';

/** Het antwoord waarmee `zetKolom` zijn ids vindt; `huidig` bepaalt of hij verplaatst. */
function doelwit(huidig: string): string {
  return JSON.stringify({
    data: {
      user: {
        projectV2: {
          id: 'PVT_x',
          field: {
            id: 'PVTSSF_x',
            options: [
              { id: 'optie-bouwen', name: 'Klaar voor Bouwen' },
              { id: 'optie-idee', name: 'Idee' },
            ],
          },
        },
      },
      repository: {
        issue: {
          projectItems: {
            nodes: [{ id: 'PVTI_x', project: { number: 2 }, fieldValueByName: { name: huidig } }],
          },
        },
      },
    },
  });
}

function ghArgs(aanroepen: ProcesAanroep[]): string[][] {
  return aanroepen.filter((a) => a.commando === 'gh').map((a) => a.argumenten);
}

describe('factory board', () => {
  let uitvoer: string[];
  let herstelOmgeving: () => void;

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
    vi.restoreAllMocks();
  });

  function metBord(huidig: string) {
    const opnemer = maakUitvoerderOpnemer(({ commando, argumenten }) =>
      commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql'
        ? { stdout: doelwit(huidig) }
        : {},
    );
    stelUitvoerderIn(opnemer.uitvoerder);
    return opnemer;
  }

  it('verplaatst een item met de gerichte query, zonder het board te lezen', () => {
    const { aanroepen } = metBord('Idee');

    board('131', 'Klaar voor Bouwen');

    // Dit is de hele reden dat dit commando bestaat: `gh project item-list` kost 102
    // GraphQL-punten, de gerichte query 1 à 2 (#104).
    expect(ghArgs(aanroepen).some((a) => a[0] === 'project' && a[1] === 'item-list')).toBe(false);
    const verplaatsing = ghArgs(aanroepen).find((a) => a[1] === 'item-edit');
    expect(verplaatsing).toContain('optie-bouwen');
    expect(uitvoer.join('')).toMatch(/#131 staat op Klaar voor Bouwen/);
  });

  it('verplaatst niets als het item er al staat', () => {
    const { aanroepen } = metBord('Klaar voor Bouwen');

    board('131', 'Klaar voor Bouwen');

    expect(ghArgs(aanroepen).some((a) => a[1] === 'item-edit')).toBe(false);
    expect(uitvoer.join('')).toMatch(/stond al op Klaar voor Bouwen/);
  });

  it('faalt hoorbaar als de aanroep mislukt', () => {
    // De val van 2026-08-20: met de GraphQL-limiet op nul faalde de opzoeking, en een
    // boolean maakte daar "niets verplaatst" van — mét een groen vinkje. Een mislukking
    // moet een mislukking blijven, anders denk je dat het board bij is terwijl het
    // achterloopt.
    const opnemer = maakUitvoerderOpnemer(({ commando, argumenten }) =>
      commando === 'gh' && argumenten[0] === 'api' ? { code: 1 } : {},
    );
    stelUitvoerderIn(opnemer.uitvoerder);

    expect(() => {
      board('131', 'Idee');
    }).toThrow(/niet verplaatst/);
  });

  it('somt de kolommen op bij een typefout', () => {
    // De namen hebben hoofdletters en spaties, dus een typefout is eerder regel dan
    // uitzondering; afkeuren zonder de lijst laat je zoeken.
    expect(() => vereisKolom('klaar voor bouwen')).toThrow(/Klaar voor Bouwen/);
    expect(() => vereisKolom(undefined)).toThrow(/Onbekende kolom/);
  });

  it('vraagt om een issuenummer', () => {
    metBord('Idee');

    expect(() => {
      board('geen-nummer', 'Idee');
    }).toThrow(/issuenummer/);
  });
});
