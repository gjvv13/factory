import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alleKinderenDicht,
  appOpties,
  bordItems,
  isBacklogRepo,
  issuesUitBereik,
  issueUitBranch,
  ouderVan,
  plaatsComment,
  sluitIssue,
  zetItemsUitBereikOpDone,
  zetKolomUitkomst,
  zetKolom,
} from '../src/board.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import {
  maakUitvoerderOpnemer,
  zetBoardOmgeving,
  type ProcesAanroep,
  type UitkomstBepaler,
} from './helpers.js';

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
  let herstelOmgeving: () => void;

  beforeEach(() => {
    // De tests draaien in CI zélf in een workflow; zonder dit slaat de poort in
    // board.ts het bord over en meten we het verkeerde.
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
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
  let herstelOmgeving: () => void;

  beforeEach(() => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
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

    expect(aanroepen[0]?.argumenten).toEqual(['log', '--format=%B', 'v1.0.0..v1.1.0']);
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

describe('token in een workflow', () => {
  let herstelOmgeving = (): void => undefined;

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('gebruikt PROJECT_TOKEN als GH_TOKEN voor de gh-aanroepen', () => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: true, pat: 'pat-geheim' });
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepalerMet('Bouwen'));
    stelUitvoerderIn(uitvoerder);

    zetKolom(128, 'Uitrollen');

    // Zowel de opzoeking als de verplaatsing draaien met de PAT: het ingebouwde
    // workflow-token komt niet bij een board onder een persoonlijk account.
    for (const aanroep of aanroepen) {
      expect(aanroep.env?.['GH_TOKEN']).toBe('pat-geheim');
    }
  });

  it('slaat het board over in een workflow zonder PROJECT_TOKEN, met een waarschuwing', () => {
    const schrijf = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: true });
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepalerMet('Bouwen'));
    stelUitvoerderIn(uitvoerder);

    // Geen throw en geen enkele aanroep: de deploy blijft groen, het bord loopt achter.
    expect(zetKolom(128, 'Uitrollen')).toBe(false);
    expect(aanroepen).toHaveLength(0);
    expect(schrijf.mock.calls.map(String).join('')).toMatch(/geen PROJECT_TOKEN/);
  });

  it('plaatst ook geen comment in een workflow zonder PROJECT_TOKEN', () => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: true });
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    plaatsComment(128, 'hallo');

    // De backlog staat in een ander repo dan de app die uitrolt; ook een comment
    // vraagt daarom een token dat verder reikt dan deze repo.
    expect(aanroepen).toHaveLength(0);
  });

  it('zet in de waarschuwing wat gh zelf zei toen de verplaatsing mislukte', () => {
    // Zonder dit stond er alleen "kon niet verplaatsen" en kostte elke oorzaak een hele
    // release om te achterhalen (#195: v1.15.15 en v1.15.16 gingen daaraan op).
    const schrijf = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
    stelUitvoerderIn(
      maakUitvoerderOpnemer((aanroep) => {
        if (isOpzoeking(aanroep)) return { stdout: opzoekAntwoord('Bouwen') };
        return {
          code: 1,
          stderr: 'your token has not been granted the required scopes\nnog een regel',
        };
      }).uitvoerder,
    );

    expect(zetKolomUitkomst(128, 'Uitrollen')).toBe('mislukt');
    const uitvoer = schrijf.mock.calls.map(String).join('');
    expect(uitvoer).toContain('your token has not been granted the required scopes');
    // Alleen de eerste regel: een waarschuwing blijft één regel.
    expect(uitvoer).not.toContain('nog een regel');
  });

  it('meldt ook wat gh zei toen de opzoeking zelf faalde', () => {
    const schrijf = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
    stelUitvoerderIn(
      maakUitvoerderOpnemer(() => ({ code: 1, stderr: 'API rate limit exceeded' })).uitvoerder,
    );

    expect(zetKolomUitkomst(128, 'Uitrollen')).toBe('mislukt');
    expect(schrijf.mock.calls.map(String).join('')).toContain('API rate limit exceeded');
  });

  it('scheidt verzet, al-goed en mislukt', () => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
    stelUitvoerderIn(maakUitvoerderOpnemer(bepalerMet('Bouwen')).uitvoerder);
    expect(zetKolomUitkomst(128, 'Uitrollen')).toBe('verzet');

    stelUitvoerderIn(maakUitvoerderOpnemer(bepalerMet('Uitrollen')).uitvoerder);
    expect(zetKolomUitkomst(128, 'Uitrollen')).toBe('al-goed');

    // Opzoeking levert niets: item niet op het board, of een token dat het niet mag lezen.
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: '' })).uitvoerder);
    expect(zetKolomUitkomst(128, 'Uitrollen')).toBe('mislukt');
  });

  it('werkt lokaal gewoon zonder PROJECT_TOKEN', () => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepalerMet('Bouwen'));
    stelUitvoerderIn(uitvoerder);

    expect(zetKolom(128, 'Uitrollen')).toBe(true);
    // Geen eigen omgeving: gh gebruikt de auth van de gebruiker zelf.
    expect(aanroepen[0]?.env).toBeUndefined();
  });
});

describe('ouder en kind', () => {
  let herstelOmgeving: () => void;

  beforeEach(() => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('leest het oudernummer uit parent_issue_url', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(() => ({
      stdout: 'https://api.github.com/repos/gjvv13/factory/issues/26',
    }));
    stelUitvoerderIn(uitvoerder);

    expect(ouderVan(147)).toBe(26);
    // REST, niet GraphQL: die pot is nodig voor het board zelf (#104).
    expect(aanroepen[0]?.argumenten.slice(0, 2)).toEqual([
      'api',
      'repos/gjvv13/factory/issues/147',
    ]);
  });

  it('geeft niets terug voor een issue zonder ouder', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: 'null' })).uitvoerder);

    expect(ouderVan(97)).toBeUndefined();
  });

  it('herkent een epic waarvan alle slices dicht zijn', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(() => ({ stdout: '3/3' }));
    stelUitvoerderIn(uitvoerder);

    expect(alleKinderenDicht(97)).toBe(true);
    // De jq-interpolatie moet écht bij jq aankomen: in een JS-string wordt `\(` stil
    // tot `(`, en dan geeft gh de letterlijke tekst "(.completed)/(.total)" terug.
    expect(aanroepen[0]?.argumenten.at(-1)).toContain('\\(.completed)');
  });

  it('herkent een epic dat nog een open slice heeft', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: '1/3' })).uitvoerder);

    expect(alleKinderenDicht(26)).toBe(false);
  });

  it('rondt een issue zonder kinderen nooit af', () => {
    // 0/0 is geen "alles af": er valt niets af te ronden.
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: '0/0' })).uitvoerder);

    expect(alleKinderenDicht(91)).toBe(false);
  });

  it('sluit een issue in het backlog-repo', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    sluitIssue(147);

    expect(aanroepen[0]?.argumenten).toEqual(['issue', 'close', '147', '--repo', 'gjvv13/factory']);
  });
});

describe('isBacklogRepo', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  it('herkent de backlog-repo aan een https-remote', () => {
    stelUitvoerderIn(
      maakUitvoerderOpnemer(() => ({ stdout: 'https://github.com/gjvv13/factory.git' })).uitvoerder,
    );

    expect(isBacklogRepo()).toBe(true);
  });

  it('herkent de backlog-repo aan een ssh-remote', () => {
    stelUitvoerderIn(
      maakUitvoerderOpnemer(() => ({ stdout: 'git@github.com:gjvv13/factory.git' })).uitvoerder,
    );

    expect(isBacklogRepo()).toBe(true);
  });

  it('wijst een andere repo af', () => {
    stelUitvoerderIn(
      maakUitvoerderOpnemer(() => ({ stdout: 'https://github.com/gjvv13/assistant.git' }))
        .uitvoerder,
    );

    expect(isBacklogRepo()).toBe(false);
  });

  it('is false zonder origin-remote', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ code: 1 })).uitvoerder);

    expect(isBacklogRepo()).toBe(false);
  });
});

describe('zetItemsUitBereikOpDone', () => {
  let herstelOmgeving: () => void;

  beforeEach(() => {
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelUitvoerder();
    herstelOmgeving();
  });

  const boardMetDone = JSON.stringify({
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
              { id: 'PVTI_test', project: { number: 2 }, fieldValueByName: { name: 'Uitrollen' } },
            ],
          },
        },
      },
    },
  });

  it('geeft terug wat er verzet is en wat bleef liggen', () => {
    // De aanroeper moet kunnen mélden dat er niets gebeurde (#195); daarvoor is "false"
    // per item te weinig — hij heeft de nummers nodig.
    const bepaler = (a: { commando: string; argumenten: string[] }) => {
      if (a.commando === 'git' && a.argumenten[0] === 'log') {
        return { stdout: 'Merge pull request #7 from gjvv13/slice/185-1' };
      }
      if (a.commando === 'gh' && a.argumenten[0] === 'api') {
        if (a.argumenten.includes('.parent_issue_url')) return { stdout: '' };
        return { stdout: boardMetDone };
      }
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler).uitvoerder);

    expect(zetItemsUitBereikOpDone('v1.0.0', 'v1.1.0', 'Klaar.', 'Epic klaar.')).toEqual({
      verzet: [185],
      overgeslagen: [],
    });

    // Dezelfde reeks in een workflow zonder token: niets verzet, alles gemeld.
    herstelOmgeving();
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: true });
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler).uitvoerder);

    expect(zetItemsUitBereikOpDone('v1.0.0', 'v1.1.0', 'Klaar.', 'Epic klaar.')).toEqual({
      verzet: [],
      overgeslagen: [185],
    });
  });

  it('meldt een item dat het board niet kon vinden als overgeslagen', () => {
    // Dit ging mis op release v1.15.15: het token was er wél, maar zonder de scope
    // `project`, dus de opzoeking gaf niets terug. Dat mag niet als "stond al goed"
    // wegvallen — dan blijft de release stil groen en loopt de kolom achter (#195).
    stelUitvoerderIn(
      maakUitvoerderOpnemer((a) => {
        if (a.commando === 'git' && a.argumenten[0] === 'log') {
          return { stdout: 'Merge pull request #7 from gjvv13/slice/185-1' };
        }
        if (a.commando === 'gh' && a.argumenten[0] === 'api') {
          if (a.argumenten.includes('.parent_issue_url')) return { stdout: '' };
          // Het board bestaat, maar het issue hangt er niet in (of mag niet gelezen worden).
          return {
            stdout: JSON.stringify({
              data: {
                user: {
                  projectV2: {
                    id: 'PVT_test',
                    field: { id: 'PVTSSF_test', options: [{ id: 'optie-done', name: 'Done' }] },
                  },
                },
                repository: { issue: { projectItems: { nodes: [] } } },
              },
            }),
          };
        }
        return {};
      }).uitvoerder,
    );

    expect(zetItemsUitBereikOpDone('v1.0.0', 'v1.1.0', 'Klaar.', 'Epic klaar.')).toEqual({
      verzet: [],
      overgeslagen: [185],
    });
  });

  it('houdt een item dat al op Done staat buiten de melding', () => {
    // Idempotent is geen storing: een tweede run over hetzelfde bereik mag geen bericht
    // opleveren.
    stelUitvoerderIn(
      maakUitvoerderOpnemer((a) => {
        if (a.commando === 'git' && a.argumenten[0] === 'log') {
          return { stdout: 'Merge pull request #7 from gjvv13/slice/185-1' };
        }
        if (a.commando === 'gh' && a.argumenten[0] === 'api') {
          if (a.argumenten.includes('.parent_issue_url')) return { stdout: '' };
          return { stdout: boardMetDone.replace('Uitrollen', 'Done') };
        }
        return {};
      }).uitvoerder,
    );

    expect(zetItemsUitBereikOpDone('v1.0.0', 'v1.1.0', 'Klaar.', 'Epic klaar.')).toEqual({
      verzet: [],
      overgeslagen: [],
    });
  });

  it('zet elk item uit het bereik op Done met de meegegeven melding', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer((a) => {
      if (a.commando === 'git' && a.argumenten[0] === 'log') {
        return { stdout: 'Merge pull request #7 from gjvv13/slice/185-1' };
      }
      if (a.commando === 'gh' && a.argumenten[0] === 'api') {
        if (a.argumenten.includes('.parent_issue_url')) return { stdout: '' };
        return { stdout: boardMetDone };
      }
      return {};
    });
    stelUitvoerderIn(uitvoerder);

    zetItemsUitBereikOpDone('v1.0.0', 'v1.1.0', 'Klaar met v1.1.0.', 'Epic klaar.');

    expect(aanroepen.find((a) => a.argumenten[0] === 'project')?.argumenten).toContain(
      'optie-done',
    );
    const comment = aanroepen.find(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comment?.argumenten[2]).toBe('185');
    expect(comment?.argumenten[6]).toBe('Klaar met v1.1.0.');
    const gesloten = aanroepen.filter(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'close',
    );
    expect(gesloten.map((a) => a.argumenten[2])).toEqual(['185']);
  });
});

describe('appOpties', () => {
  let herstelOmgeving: () => void;

  beforeEach(() => {
    herstelOmgeving = zetBoardOmgeving({});
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
  });

  it('parseert de App-opties gesorteerd uit de board-respons', () => {
    const respons = JSON.stringify({
      data: {
        user: {
          projectV2: {
            appVeld: {
              options: [{ name: 'factory' }, { name: 'assistant' }, { name: 'beheer' }],
            },
            items: { pageInfo: { hasNextPage: false }, nodes: [] },
          },
        },
      },
    });
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: respons })).uitvoerder);

    bordItems();

    expect(appOpties()).toEqual(['assistant', 'beheer', 'factory']);
  });

  it('levert een lege array als het App-veld geen opties heeft', () => {
    const respons = JSON.stringify({
      data: {
        user: {
          projectV2: {
            appVeld: { options: [] },
            items: { pageInfo: { hasNextPage: false }, nodes: [] },
          },
        },
      },
    });
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: respons })).uitvoerder);

    bordItems();

    expect(appOpties()).toEqual([]);
  });

  it('levert undefined als het board niet gelezen kon worden', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(() => ({ stdout: '' })).uitvoerder);

    bordItems();

    expect(appOpties()).toBeUndefined();
  });
});
