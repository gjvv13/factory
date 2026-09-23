import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GebruikersFout, herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { TRIAGE_DOELKOLOM, TRIAGE_LABELS, triage, triagePlan } from '../src/commands/triage.js';
import { maakUitvoerderOpnemer, zetBoardOmgeving, type UitkomstBepaler } from './helpers.js';

// ---------------------------------------------------------------------------
// triagePlan (puur): welke labels ontbreken er nog (#783)
// ---------------------------------------------------------------------------
describe('triagePlan', () => {
  it('zet alle drie de labels op een leeg issue', () => {
    expect(triagePlan([]).teZetten).toEqual(['type:bug', 'fastlane', 'auto-merge-ok']);
  });

  it('zet niets als alle drie de labels er al zijn (idempotent)', () => {
    expect(triagePlan(['type:bug', 'fastlane', 'auto-merge-ok']).teZetten).toEqual([]);
  });

  it('vult alleen de ontbrekende labels aan', () => {
    expect(triagePlan(['type:bug']).teZetten).toEqual(['fastlane', 'auto-merge-ok']);
  });

  it('laat vreemde labels ongemoeid en telt ze niet mee', () => {
    expect(triagePlan(['prioriteit:hoog', 'fastlane']).teZetten).toEqual([
      'type:bug',
      'auto-merge-ok',
    ]);
  });

  it('de doelkolom is de refine-wachtrij (bug wordt eerst bug-exempt gerefined, #782/#784)', () => {
    expect(TRIAGE_DOELKOLOM).toBe('Klaar voor technische refinement');
    expect(TRIAGE_LABELS).toEqual(['type:bug', 'fastlane', 'auto-merge-ok']);
  });
});

// ---------------------------------------------------------------------------
// triage — argument-validatie (vóór enige gh-I/O)
// ---------------------------------------------------------------------------
describe('triage argument-validatie', () => {
  it('faalt zonder issuenummer', () => {
    expect(() => {
      triage(undefined);
    }).toThrow(GebruikersFout);
    expect(() => {
      triage(undefined);
    }).toThrow(/Gebruik: factory triage/);
  });

  it('faalt op een niet-numeriek argument', () => {
    expect(() => {
      triage('abc');
    }).toThrow(GebruikersFout);
  });

  it('faalt op een niet-positief nummer', () => {
    expect(() => {
      triage('0');
    }).toThrow(/Gebruik: factory triage/);
    expect(() => {
      triage('-5');
    }).toThrow(GebruikersFout);
  });
});

// ---------------------------------------------------------------------------
// triage — shell-gedrag met een gestubde gh (#783)
// ---------------------------------------------------------------------------
describe('triage shell-gedrag', () => {
  let herstelBoard: () => void;

  beforeEach(() => {
    herstelBoard = zetBoardOmgeving({ inWorkflow: false, pat: 'test-pat' });
  });
  afterEach(() => {
    herstelUitvoerder();
    herstelBoard();
  });

  /** Het graphql-antwoord van `zoekDoelwit`: item staat nu op `huidigeKolom`. */
  function graphqlAntwoord(huidigeKolom: string): string {
    return JSON.stringify({
      data: {
        user: {
          projectV2: {
            id: 'PVT_x',
            field: {
              id: 'PVTSSF_x',
              options: [{ id: 'optie-krt', name: 'Klaar voor technische refinement' }],
            },
          },
        },
        repository: {
          issue: {
            projectItems: {
              nodes: [
                { id: 'PVTI_x', project: { number: 2 }, fieldValueByName: { name: huidigeKolom } },
              ],
            },
          },
        },
      },
    });
  }

  /**
   * Een gh-stub voor de triage-keten. `labelReeks` levert de opeenvolgende antwoorden
   * op de label-lezingen (eerst de begintoestand, daarna de naverificatie).
   */
  function ghStub(opties: {
    bestaat?: boolean;
    ouder?: string;
    labelReeks: string[][];
    huidigeKolom?: string;
  }): UitkomstBepaler {
    let labelLees = 0;
    return ({ commando, argumenten }) => {
      if (commando !== 'gh') return {};
      if (argumenten[0] === 'api' && argumenten[1] === 'graphql') {
        return { stdout: graphqlAntwoord(opties.huidigeKolom ?? 'Idee') };
      }
      if (argumenten[0] === 'api' && typeof argumenten[1] === 'string') {
        const jq = argumenten[argumenten.indexOf('--jq') + 1];
        if (jq === '.number') {
          return { stdout: (opties.bestaat ?? true) ? '1' : '' };
        }
        if (jq === '.parent_issue_url') {
          return { stdout: opties.ouder ?? '' };
        }
        if (jq === '[.labels[].name]') {
          const antwoord = opties.labelReeks[Math.min(labelLees, opties.labelReeks.length - 1)];
          labelLees += 1;
          return { stdout: JSON.stringify(antwoord) };
        }
      }
      return {};
    };
  }

  it('zet de drie labels en de kolom op een kaal issue', () => {
    const opnemer = maakUitvoerderOpnemer(ghStub({ labelReeks: [[], [...TRIAGE_LABELS]] }));
    stelUitvoerderIn(opnemer.uitvoerder);

    expect(() => {
      triage('1');
    }).not.toThrow();

    const addLabels = opnemer.aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten.includes('--add-label'),
    );
    const gezet = addLabels.map((a) => a.argumenten[a.argumenten.indexOf('--add-label') + 1]);
    expect(gezet).toEqual([...TRIAGE_LABELS]);

    const itemEdits = opnemer.aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten.includes('item-edit'),
    );
    expect(itemEdits).toHaveLength(1);
  });

  it('faalt hard als een label na het zetten ontbreekt (zetLabel faalt zacht)', () => {
    stelUitvoerderIn(
      maakUitvoerderOpnemer(ghStub({ labelReeks: [[], ['type:bug', 'fastlane']] })).uitvoerder,
    );
    expect(() => {
      triage('1');
    }).toThrow(/mist na triage het label auto-merge-ok/);
  });

  it('is idempotent: een tweede run zet niets en verzet niets', () => {
    const opnemer = maakUitvoerderOpnemer(
      ghStub({
        labelReeks: [[...TRIAGE_LABELS]],
        huidigeKolom: 'Klaar voor technische refinement',
      }),
    );
    stelUitvoerderIn(opnemer.uitvoerder);

    expect(() => {
      triage('1');
    }).not.toThrow();

    const addLabels = opnemer.aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten.includes('--add-label'),
    );
    const itemEdits = opnemer.aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten.includes('item-edit'),
    );
    expect(addLabels).toHaveLength(0);
    expect(itemEdits).toHaveLength(0);
  });

  it('faalt met GebruikersFout op een niet-bestaand issue', () => {
    stelUitvoerderIn(
      maakUitvoerderOpnemer(ghStub({ bestaat: false, labelReeks: [[]] })).uitvoerder,
    );
    expect(() => {
      triage('999');
    }).toThrow(/bestaat niet of is niet leesbaar/);
  });

  it('zet labels en verzet de kolom, en waarschuwt bij een child-slice', () => {
    const opnemer = maakUitvoerderOpnemer(
      ghStub({
        ouder: 'https://github.com/gjvv13/factory/issues/99',
        labelReeks: [[], [...TRIAGE_LABELS]],
      }),
    );
    stelUitvoerderIn(opnemer.uitvoerder);

    expect(() => {
      triage('1');
    }).not.toThrow();

    const addLabels = opnemer.aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten.includes('--add-label'),
    );
    const itemEdits = opnemer.aanroepen.filter(
      (a) => a.commando === 'gh' && a.argumenten.includes('item-edit'),
    );
    // Drie labels ontbraken → drie add-label-aanroepen; de kolom stond op 'Idee' → verzet.
    expect(addLabels).toHaveLength(3);
    expect(itemEdits).toHaveLength(1);
  });
});
