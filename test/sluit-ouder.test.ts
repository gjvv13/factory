import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sluitOuderAlsAf } from '../src/board.js';
import { sluitOuder } from '../src/commands/sluit-ouder.js';
import { GebruikersFout, herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, zetBoardOmgeving, type ProcesAanroep } from './helpers.js';

// --- Helpers -----------------------------------------------------------------

/** Bouwt een opnemer die de ouder- en kinderen-REST-aanroepen beantwoordt. */
function opnemer(
  opties: {
    /**
     * Ouder-URL per issue. Geef een map van kindnummer → ouder-URL.
     * Ontbreekt een nummer, dan heeft het kind geen ouder.
     */
    ouders?: Map<number, string>;
    /**
     * Kinderen-voortgang per issue. Geef een map van oudernummer → "completed/total".
     * Ontbreekt een nummer, dan geeft de API niets terug.
     */
    kinderen?: Map<number, string>;
  } = {},
) {
  return maakUitvoerderOpnemer((a) => {
    if (a.commando === 'gh' && a.argumenten[0] === 'api') {
      // Ouder-opzoeking: .parent_issue_url
      if (a.argumenten.includes('.parent_issue_url')) {
        const issueMatch = /issues\/(\d+)/.exec(a.argumenten[1] ?? '');
        const issue = issueMatch?.[1] !== undefined ? Number(issueMatch[1]) : undefined;
        if (issue !== undefined) {
          const url = opties.ouders?.get(issue);
          return { stdout: url ?? '' };
        }
        return { stdout: '' };
      }
      // Kinderen-opzoeking: sub_issues_summary
      if (a.argumenten.some((x) => x.includes('sub_issues_summary'))) {
        const issueMatch = /issues\/(\d+)/.exec(a.argumenten[1] ?? '');
        const issue = issueMatch?.[1] !== undefined ? Number(issueMatch[1]) : undefined;
        if (issue !== undefined) {
          const voortgang = opties.kinderen?.get(issue);
          return { stdout: voortgang ?? '' };
        }
        return { stdout: '' };
      }
    }
    return {};
  });
}

/** Haalt de gesloten issuenummers uit de aanroepen. */
const gesloten = (aanroepen: ProcesAanroep[]): string[] =>
  aanroepen
    .filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'close',
    )
    .map((a) => a.argumenten[2] ?? '');

/** Haalt de comments uit de aanroepen, als [issuenummer, body]-paren. */
const comments = (aanroepen: ProcesAanroep[]): Array<[string, string]> =>
  aanroepen
    .filter(
      (a) => a.commando === 'gh' && a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    )
    .map((a) => [a.argumenten[2] ?? '', a.argumenten[6] ?? '']);

// --- Tests -------------------------------------------------------------------

describe('sluitOuderAlsAf', () => {
  let herstelOmgeving: () => void;

  beforeEach(() => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelUitvoerder();
    herstelOmgeving();
  });

  it('doet niets als het kind geen ouder heeft', () => {
    const { uitvoerder, aanroepen } = opnemer();
    stelUitvoerderIn(uitvoerder);

    sluitOuderAlsAf(42);

    expect(gesloten(aanroepen)).toEqual([]);
    expect(comments(aanroepen)).toEqual([]);
  });

  it('doet niets als de ouder nog open kinderen heeft', () => {
    const { uitvoerder, aanroepen } = opnemer({
      ouders: new Map([[42, 'https://api.github.com/repos/gjvv13/factory/issues/10']]),
      kinderen: new Map([[10, '1/3']]), // 1 van 3 dicht
    });
    stelUitvoerderIn(uitvoerder);

    sluitOuderAlsAf(42);

    expect(gesloten(aanroepen)).toEqual([]);
    expect(comments(aanroepen)).toEqual([]);
  });

  it('sluit de ouder en plaatst een comment als alle kinderen dicht zijn', () => {
    const { uitvoerder, aanroepen } = opnemer({
      ouders: new Map([[42, 'https://api.github.com/repos/gjvv13/factory/issues/10']]),
      kinderen: new Map([[10, '3/3']]), // alle 3 dicht
    });
    stelUitvoerderIn(uitvoerder);

    sluitOuderAlsAf(42);

    expect(gesloten(aanroepen)).toEqual(['10']);
    const [comment] = comments(aanroepen);
    expect(comment).toBeDefined();
    expect(comment![0]).toBe('10');
    expect(comment![1]).toContain('#42');
    expect(comment![1]).toContain('Alle sub-issues zijn gesloten');
  });

  it('recurseert door de ouder-keten (ouder → grootouder)', () => {
    const { uitvoerder, aanroepen } = opnemer({
      ouders: new Map([
        [42, 'https://api.github.com/repos/gjvv13/factory/issues/10'],
        [10, 'https://api.github.com/repos/gjvv13/factory/issues/5'],
      ]),
      kinderen: new Map([
        [10, '3/3'], // ouder: alle kinderen dicht
        [5, '2/2'], // grootouder: alle kinderen dicht
      ]),
    });
    stelUitvoerderIn(uitvoerder);

    sluitOuderAlsAf(42);

    // Eerst de ouder, dan de grootouder.
    expect(gesloten(aanroepen)).toEqual(['10', '5']);
    const geplaatst = comments(aanroepen);
    expect(geplaatst).toHaveLength(2);
    expect(geplaatst[0]![1]).toContain('#42');
    expect(geplaatst[1]![1]).toContain('#10');
  });

  it('stopt de recursie als de grootouder nog open kinderen heeft', () => {
    const { uitvoerder, aanroepen } = opnemer({
      ouders: new Map([
        [42, 'https://api.github.com/repos/gjvv13/factory/issues/10'],
        [10, 'https://api.github.com/repos/gjvv13/factory/issues/5'],
      ]),
      kinderen: new Map([
        [10, '3/3'], // ouder: alle kinderen dicht
        [5, '1/2'], // grootouder: nog 1 open
      ]),
    });
    stelUitvoerderIn(uitvoerder);

    sluitOuderAlsAf(42);

    expect(gesloten(aanroepen)).toEqual(['10']); // alleen de ouder, niet de grootouder
  });

  it('geeft een waarschuwing in CI zonder bruikbaar token', () => {
    herstelOmgeving();
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: true });
    // Geen PROJECT_TOKEN, geen GH_TOKEN → ghIssueOmgeving kan niet.
    const oud = process.env['GH_TOKEN'];
    const oudGithub = process.env['GITHUB_TOKEN'];
    delete process.env['GH_TOKEN'];
    delete process.env['GITHUB_TOKEN'];
    try {
      const { uitvoerder, aanroepen } = opnemer();
      stelUitvoerderIn(uitvoerder);

      sluitOuderAlsAf(42);

      // Geen gh-aanroepen: er is geen token.
      expect(aanroepen).toHaveLength(0);
    } finally {
      if (oud !== undefined) process.env['GH_TOKEN'] = oud;
      if (oudGithub !== undefined) process.env['GITHUB_TOKEN'] = oudGithub;
    }
  });
});

describe('sluit-ouder commando', () => {
  let herstelOmgeving: () => void;

  beforeEach(() => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelUitvoerder();
    herstelOmgeving();
  });

  it('vraagt om een issuenummer', () => {
    expect(() => {
      sluitOuder(undefined);
    }).toThrow(GebruikersFout);
  });

  it('weigert een ongeldig issuenummer', () => {
    expect(() => {
      sluitOuder('abc');
    }).toThrow(GebruikersFout);
    expect(() => {
      sluitOuder('-1');
    }).toThrow(GebruikersFout);
    expect(() => {
      sluitOuder('0');
    }).toThrow(GebruikersFout);
  });

  it('roept sluitOuderAlsAf aan met het juiste nummer', () => {
    const { uitvoerder, aanroepen } = opnemer({
      ouders: new Map([[99, 'https://api.github.com/repos/gjvv13/factory/issues/50']]),
      kinderen: new Map([[50, '5/5']]),
    });
    stelUitvoerderIn(uitvoerder);

    sluitOuder('99');

    expect(gesloten(aanroepen)).toEqual(['50']);
  });
});

describe('ghIssueOmgeving', () => {
  let herstelOmgeving: (() => void) | undefined;

  afterEach(() => {
    herstelOmgeving?.();
  });

  it('werkt in CI met alleen GH_TOKEN (geen PROJECT_TOKEN nodig)', () => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: true });
    // Zet GH_TOKEN maar geen PROJECT_TOKEN.
    const oudGh = process.env['GH_TOKEN'];
    process.env['GH_TOKEN'] = 'test-gh-token';
    try {
      const { uitvoerder, aanroepen } = opnemer({
        ouders: new Map([[42, 'https://api.github.com/repos/gjvv13/factory/issues/10']]),
        kinderen: new Map([[10, '2/2']]),
      });
      stelUitvoerderIn(uitvoerder);

      sluitOuderAlsAf(42);

      // De functie komt bij de ouder-lezing: ghIssueOmgeving zei kan: true.
      expect(gesloten(aanroepen)).toEqual(['10']);
    } finally {
      if (oudGh === undefined) {
        delete process.env['GH_TOKEN'];
      } else {
        process.env['GH_TOKEN'] = oudGh;
      }
    }
  });
});
