import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { heeftWachtOp } from '../src/commands/orkestreer.js';
import { prioriteit } from '../src/commands/prioriteit.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, zetBoardOmgeving, type ProcesAanroep } from './helpers.js';

describe('heeftWachtOp (#438)', () => {
  it('herkent "wacht op #123" in een body', () => {
    expect(heeftWachtOp('Deze slice wacht op #123 (de API-laag).')).toBe(true);
  });

  it('is case-insensitief', () => {
    expect(heeftWachtOp('Wacht op #42.')).toBe(true);
    expect(heeftWachtOp('WACHT OP #42.')).toBe(true);
  });

  it('geeft false voor een body zonder "wacht op #N"', () => {
    expect(heeftWachtOp('# Uitwerking\n\nDit is de body.')).toBe(false);
  });

  it('herkent geen losse vermelding van #N zonder "wacht op"', () => {
    expect(heeftWachtOp('Refs: #100')).toBe(false);
    expect(heeftWachtOp('Zie issue #100 voor context.')).toBe(false);
  });
});

describe('prioriteit commando (#438)', () => {
  let herstelOmgeving: () => void;
  let schrijfSpy: MockInstance;

  beforeEach(() => {
    schrijfSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  /** Het antwoord van de PRIORITEIT_QUERY. */
  function prioriteitDoelwit(): string {
    return JSON.stringify({
      data: {
        user: {
          projectV2: {
            id: 'PVT_x',
            field: { id: 'PVTF_prio' },
          },
        },
        repository: {
          issue: {
            projectItems: {
              nodes: [{ id: 'PVTI_x', project: { number: 2 } }],
            },
          },
        },
      },
    });
  }

  function boardAntwoord(): string {
    return JSON.stringify({
      data: {
        user: {
          projectV2: {
            appVeld: { options: [{ name: 'factory' }] },
            items: {
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  status: { name: 'Klaar voor technische refinement' },
                  app: { name: 'factory' },
                  prioriteit: { number: 10 },
                  content: {
                    number: 42,
                    title: 'item 42',
                    state: 'OPEN',
                    createdAt: '2026-08-01T00:00:00Z',
                  },
                },
                {
                  status: { name: 'Klaar voor Bouwen' },
                  app: { name: 'factory' },
                  prioriteit: null,
                  content: {
                    number: 99,
                    title: 'item 99',
                    state: 'OPEN',
                    createdAt: '2026-08-02T00:00:00Z',
                  },
                },
              ],
            },
          },
        },
      },
    });
  }

  function bepaler(): (aanroep: ProcesAanroep) => Partial<{ stdout: string; code: number }> {
    return ({ commando, argumenten }) => {
      if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql') {
        const query = argumenten.find((a) => a.startsWith('query=')) ?? '';
        // De PRIORITEIT_QUERY bevat "ProjectV2Field" (niet ProjectV2SingleSelectField),
        // terwijl de WACHTRIJ_QUERY "items(first:100" bevat.
        if (query.includes('ProjectV2Field')) return { stdout: prioriteitDoelwit() };
        return { stdout: boardAntwoord() };
      }
      if (commando === 'gh' && argumenten[0] === 'api') return { stdout: '' };
      return {};
    };
  }

  it('valideert dat het issuenummer verplicht is', () => {
    expect(() => {
      prioriteit(undefined, undefined);
    }).toThrow(/issuenummer/);
  });

  it('valideert dat de prioriteit een positief geheel getal is', () => {
    expect(() => {
      prioriteit('42', '0');
    }).toThrow(/positief geheel getal/);
    expect(() => {
      prioriteit('42', '-1');
    }).toThrow(/positief geheel getal/);
    expect(() => {
      prioriteit('42', 'abc');
    }).toThrow(/positief geheel getal/);
  });

  it('zet de prioriteit via gh project item-edit met --number', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler());
    stelUitvoerderIn(uitvoerder);

    prioriteit('42', '10');

    const edit = aanroepen.find((a) => a.commando === 'gh' && a.argumenten[0] === 'project');
    expect(edit?.argumenten).toContain('--number');
    expect(edit?.argumenten).toContain('10');
    expect(edit?.argumenten).toContain('PVTI_x');
  });

  it('wist de prioriteit met --clear als er geen getal is', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler());
    stelUitvoerderIn(uitvoerder);

    prioriteit('42', undefined);

    const edit = aanroepen.find((a) => a.commando === 'gh' && a.argumenten[0] === 'project');
    expect(edit?.argumenten).toContain('--clear');
    expect(edit?.argumenten).not.toContain('--number');
  });

  it('toont de gecombineerde refine- en bouw-wachtrij na het zetten', () => {
    const { uitvoerder } = maakUitvoerderOpnemer(bepaler());
    stelUitvoerderIn(uitvoerder);

    prioriteit('42', '10');

    const tekst = schrijfSpy.mock.calls.map(String).join('');
    expect(tekst).toContain('Refine-wachtrij');
    expect(tekst).toContain('Bouw-wachtrij');
    expect(tekst).toContain('#42');
  });
});
