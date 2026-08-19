import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { afronden } from '../src/commands/afronden.js';
import { GebruikersFout, herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, zetBoardOmgeving, type ProcesAanroep } from './helpers.js';

const BACKLOG_URL = 'https://github.com/gjvv13/factory.git';

/** Board-opzoeking: het item staat op Uitrollen, met een Done-optie om naartoe te gaan. */
function boardAntwoord(huidig = 'Uitrollen'): string {
  return JSON.stringify({
    data: {
      user: {
        projectV2: {
          id: 'PVT_test',
          field: { id: 'PVTSSF_test', options: [{ id: 'optie-done', name: 'Done' }] },
        },
      },
      repository: {
        issue: {
          projectItems: {
            nodes: [
              { id: 'PVTI_test', project: { number: 2 }, fieldValueByName: { name: huidig } },
            ],
          },
        },
      },
    },
  });
}

/**
 * Een opnemer die de repo-guard (`git remote`), het tagbereik (`git log`) en de
 * board-aanroepen (`gh api`) beantwoordt. Standaard: backlog-repo, één slice-merge van
 * #185 in het bereik, geen ouder.
 */
function opnemer(opties: { origin?: string; log?: string; huidig?: string; ouder?: string } = {}) {
  return maakUitvoerderOpnemer((a) => {
    if (a.commando === 'git' && a.argumenten[0] === 'remote') {
      return { stdout: opties.origin ?? BACKLOG_URL };
    }
    if (a.commando === 'git' && a.argumenten[0] === 'log') {
      return { stdout: opties.log ?? 'Merge pull request #7 from gjvv13/slice/185-1' };
    }
    if (a.commando === 'gh' && a.argumenten[0] === 'api') {
      if (a.argumenten.includes('.parent_issue_url')) {
        return {
          stdout: opties.ouder ? 'https://api.github.com/repos/gjvv13/factory/issues/50' : '',
        };
      }
      if (a.argumenten.some((x) => x.includes('sub_issues_summary'))) {
        return { stdout: opties.ouder ?? '' };
      }
      return { stdout: boardAntwoord(opties.huidig) };
    }
    return {};
  });
}

const gesloten = (aanroepen: ProcesAanroep[]): string[] =>
  aanroepen
    .filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'close',
    )
    .map((a) => a.argumenten[2] ?? '');

describe('afronden', () => {
  let herstelOmgeving: () => void;

  beforeEach(() => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelUitvoerder();
    herstelOmgeving();
  });

  it('zet elk item uit het tagbereik op Done, becommentarieert en sluit het', () => {
    const { uitvoerder, aanroepen } = opnemer();
    stelUitvoerderIn(uitvoerder);

    afronden('v1.0.0', 'v1.1.0');

    expect(aanroepen.map((a) => a.argumenten)).toContainEqual([
      'log',
      '--format=%s',
      'v1.0.0..v1.1.0',
    ]);
    expect(aanroepen.find((a) => a.argumenten[0] === 'project')?.argumenten).toContain(
      'optie-done',
    );
    const comment = aanroepen.find(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comment?.argumenten.slice(0, 5)).toEqual([
      'issue',
      'comment',
      '185',
      '--repo',
      'gjvv13/factory',
    ]);
    expect(comment?.argumenten[6]).toContain('v1.1.0');
    expect(gesloten(aanroepen)).toEqual(['185']);
  });

  it('sluit de ouder-epic zodra zijn laatste slice dicht is', () => {
    const { uitvoerder, aanroepen } = opnemer({ ouder: '2/2' });
    stelUitvoerderIn(uitvoerder);

    afronden('v1.0.0', 'v1.1.0');

    // Eerst de slice zelf, daarna de epic.
    expect(gesloten(aanroepen)).toEqual(['185', '50']);
  });

  it('laat een item dat al op Done staat met rust (idempotent)', () => {
    const { uitvoerder, aanroepen } = opnemer({ huidig: 'Done' });
    stelUitvoerderIn(uitvoerder);

    afronden('v1.0.0', 'v1.1.0');

    expect(aanroepen.some((a) => a.argumenten[0] === 'issue')).toBe(false);
  });

  it('weigert buiten de backlog-repo en raakt het board niet aan', () => {
    const { uitvoerder, aanroepen } = opnemer({
      origin: 'https://github.com/gjvv13/assistant.git',
    });
    stelUitvoerderIn(uitvoerder);

    expect(() => {
      afronden('v1.0.0', 'v1.1.0');
    }).toThrow(GebruikersFout);
    expect(aanroepen.some((a) => a.commando === 'gh')).toBe(false);
  });

  it('vraagt om beide tags', () => {
    stelUitvoerderIn(opnemer().uitvoerder);
    expect(() => {
      afronden(undefined, 'v1.1.0');
    }).toThrow(/Gebruik/);
    expect(() => {
      afronden('v1.0.0', undefined);
    }).toThrow(/Gebruik/);
  });
});
