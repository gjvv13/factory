import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issuesUitBereik, issueUitBranch, plaatsComment, zetKolom } from '../src/board.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type ProcesAanroep, type UitkomstBepaler } from './helpers.js';

const ITEM = 'PVTI_test';
const PROJECT = 'PVT_test';
const VELD = 'PVTSSF_test';
const OPTIE_UITROLLEN = 'optie-uitrollen';

/** Antwoord van de opzoek-query, met het item op `huidig`. */
function opzoekAntwoord(huidig?: string): string {
  return JSON.stringify({
    data: {
      user: {
        projectV2: {
          id: PROJECT,
          field: {
            id: VELD,
            options: [
              { id: 'optie-bouwen', name: 'Bouwen' },
              { id: OPTIE_UITROLLEN, name: 'Uitrollen' },
            ],
          },
        },
      },
      repository: {
        issue: {
          projectItems: {
            nodes: [
              { id: 'PVTI_ander', project: { number: 9 }, fieldValueByName: { name: 'Idee' } },
              {
                id: ITEM,
                project: { number: 2 },
                ...(huidig === undefined
                  ? { fieldValueByName: null }
                  : { fieldValueByName: { name: huidig } }),
              },
            ],
          },
        },
      },
    },
  });
}

function isOpzoeking(aanroep: ProcesAanroep): boolean {
  return aanroep.commando === 'gh' && aanroep.argumenten[0] === 'api';
}

function isVerplaatsing(aanroep: ProcesAanroep): boolean {
  return aanroep.commando === 'gh' && aanroep.argumenten[0] === 'project';
}

/** Opzoeking slaagt en levert een item dat op `huidig` staat. */
function bepalerMet(huidig?: string): UitkomstBepaler {
  return (aanroep) => (isOpzoeking(aanroep) ? { stdout: opzoekAntwoord(huidig) } : {});
}

describe('issueUitBranch', () => {
  it('herkent de slice-vorm', () => {
    expect(issueUitBranch('slice/128-1')).toBe(128);
    expect(issueUitBranch('slice/97-3')).toBe(97);
  });

  it('geeft niets terug voor een branch die niet bij een backlog-item hoort', () => {
    // Dit is het gewenste gedrag, geen fout: van de tien merges in v1.15.1 waren er
    // vijf een fix- of docs-branch, en die horen niets te verplaatsen.
    for (const branch of ['main', 'fix/release-node-cli', 'docs/akkoord-kolom', 'slice/abc-1']) {
      expect(issueUitBranch(branch)).toBeUndefined();
    }
  });
});

describe('zetKolom', () => {
  afterEach(() => {
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('zoekt in één aanroep op en verplaatst met ids', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepalerMet('Bouwen'));
    stelUitvoerderIn(uitvoerder);

    expect(zetKolom(128, 'Uitrollen')).toBe(true);

    // Eén opzoeking: item-id, veld-id, optie-ids én de huidige kolom komen samen binnen.
    expect(aanroepen.filter(isOpzoeking)).toHaveLength(1);
    // De id-vorm, niet de vorm op naam: die kost 104 punten in plaats van 1.
    expect(aanroepen.filter(isVerplaatsing)[0]?.argumenten).toEqual([
      'project',
      'item-edit',
      '--id',
      ITEM,
      '--project-id',
      PROJECT,
      '--field-id',
      VELD,
      '--single-select-option-id',
      OPTIE_UITROLLEN,
    ]);
  });

  it('doet niets als het item al in de doelkolom staat', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepalerMet('Uitrollen'));
    stelUitvoerderIn(uitvoerder);

    expect(zetKolom(128, 'Uitrollen')).toBe(false);
    expect(aanroepen.filter(isVerplaatsing)).toHaveLength(0);
  });

  it('waarschuwt en gaat door als het item niet op het board staat', () => {
    const schrijf = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer((aanroep) =>
      isOpzoeking(aanroep) ? { stdout: '' } : {},
    );
    stelUitvoerderIn(uitvoerder);

    expect(zetKolom(128, 'Uitrollen')).toBe(false);
    expect(aanroepen.filter(isVerplaatsing)).toHaveLength(0);
    expect(schrijf.mock.calls.map(String).join('')).toMatch(/kon #128 niet op het board/);
  });

  it('waarschuwt en gaat door als de verplaatsing zelf faalt', () => {
    const schrijf = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { uitvoerder } = maakUitvoerderOpnemer((aanroep) => {
      if (isOpzoeking(aanroep)) return { stdout: opzoekAntwoord('Bouwen') };
      if (isVerplaatsing(aanroep)) return { code: 1 };
      return {};
    });
    stelUitvoerderIn(uitvoerder);

    // Geen throw: een uitrol mag niet omvallen op boekhouding.
    expect(zetKolom(128, 'Uitrollen')).toBe(false);
    expect(schrijf.mock.calls.map(String).join('')).toMatch(/niet naar 'Uitrollen'/);
  });

  it('slikt onleesbare uitvoer in plaats van te crashen', () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { uitvoerder } = maakUitvoerderOpnemer((aanroep) =>
      isOpzoeking(aanroep) ? { stdout: 'geen json' } : {},
    );
    stelUitvoerderIn(uitvoerder);

    expect(zetKolom(128, 'Uitrollen')).toBe(false);
  });
});

describe('plaatsComment', () => {
  afterEach(() => {
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('plaatst de comment op het backlog-issue, niet op de app-repo', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    plaatsComment(128, 'hallo');

    expect(aanroepen[0]?.argumenten).toEqual([
      'issue',
      'comment',
      '128',
      '--repo',
      'gjvv13/factory',
      '--body',
      'hallo',
    ]);
  });

  it('waarschuwt als de comment niet geplaatst kan worden', () => {
    const schrijf = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ code: 1 })).uitvoerder);

    plaatsComment(128, 'hallo');

    expect(schrijf.mock.calls.map(String).join('')).toMatch(/geen comment op #128/);
  });
});

describe('issuesUitBereik', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  /** De echte merge-onderwerpen van v1.15.0..v1.15.1, als fixture. */
  function echteHistorie(): string {
    const hier = path.dirname(fileURLToPath(import.meta.url));
    return readFileSync(path.join(hier, 'fixtures', 'merge-commits.txt'), 'utf8').trim();
  }

  it('haalt de issuenummers uit de merge-commits en laat de rest liggen', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: echteHistorie() })).uitvoerder);

    // Vijf slice-branches; de fix-, docs- en losse branches horen bij geen item.
    expect(issuesUitBereik('v1.15.0', 'v1.15.1')).toEqual([108, 112, 121, 122, 132]);
  });

  it('vraagt het bereik op met git log tussen de twee tags', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(() => ({ stdout: '' }));
    stelUitvoerderIn(uitvoerder);

    issuesUitBereik('v1.0.0', 'v1.1.0');

    expect(aanroepen[0]?.argumenten).toEqual(['log', '--format=%s', 'v1.0.0..v1.1.0']);
  });

  it('levert niets op bij een leeg bereik', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: '' })).uitvoerder);

    expect(issuesUitBereik('v1.15.1', 'v1.15.1')).toEqual([]);
  });

  it('telt hetzelfde issue niet dubbel als er twee slices in één release zitten', () => {
    const historie = [
      'Merge pull request #1 from gjvv13/slice/128-1',
      'Merge pull request #2 from gjvv13/slice/128-2',
    ].join('\n');
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: historie })).uitvoerder);

    expect(issuesUitBereik('v1.0.0', 'v1.1.0')).toEqual([128]);
  });
});
