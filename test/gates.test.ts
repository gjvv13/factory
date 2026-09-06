import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/commands/verify.js', () => ({ verify: vi.fn() }));

vi.mock('../src/commands/integreer.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, heeftIntegreerAgent: vi.fn(() => true) };
});

import { parseLabelsAntwoord } from '../src/board.js';
import { inleveren } from '../src/commands/inleveren.js';
import { heeftFunctioneleSecties } from '../src/commands/orkestreer.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, zetBoardOmgeving, type UitkomstBepaler } from './helpers.js';

// ---------------------------------------------------------------------------
// heeftFunctioneleSecties (orkestreer.ts)
// ---------------------------------------------------------------------------
describe('heeftFunctioneleSecties', () => {
  it('geeft true als er geen technische secties zijn', () => {
    expect(heeftFunctioneleSecties('# Titel\n\nAlleen tekst.')).toBe(true);
  });

  it('geeft true als zowel functionele als technische secties aanwezig zijn', () => {
    const body = '## Functionele architectuur\n\nWat.\n\n## Technische architectuur\n\nHoe.';
    expect(heeftFunctioneleSecties(body)).toBe(true);
  });

  it('geeft true bij functionele besluiten + technische architectuur', () => {
    const body = '## Functionele besluiten\n\nBesluit.\n\n## Technische architectuur\n\nHoe.';
    expect(heeftFunctioneleSecties(body)).toBe(true);
  });

  it('geeft false als technische secties aanwezig zijn zonder functionele', () => {
    const body = '# Titel\n\n## Technische architectuur\n\nHoe.';
    expect(heeftFunctioneleSecties(body)).toBe(false);
  });

  it('is case-insensitive voor de kopteksten', () => {
    const body = '## functionele architectuur\n\nWat.\n\n## technische architectuur\n\nHoe.';
    expect(heeftFunctioneleSecties(body)).toBe(true);
  });

  it('matcht alleen kopteksten aan het begin van een regel', () => {
    // "## Technische architectuur" midden in een zin telt niet.
    const body = 'Dit is geen ## Technische architectuur koptekst.';
    expect(heeftFunctioneleSecties(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseLabelsAntwoord (board.ts)
// ---------------------------------------------------------------------------
describe('parseLabelsAntwoord', () => {
  it('parset een JSON-array van strings', () => {
    expect(parseLabelsAntwoord('["type:task","fastlane"]')).toEqual(['type:task', 'fastlane']);
  });

  it('geeft een lege array bij ongeldige JSON', () => {
    expect(parseLabelsAntwoord('niet-json')).toEqual([]);
  });

  it('geeft een lege array bij een leeg array', () => {
    expect(parseLabelsAntwoord('[]')).toEqual([]);
  });

  it('filtert niet-string waarden', () => {
    expect(parseLabelsAntwoord('[123, "ok", null]')).toEqual(['ok']);
  });
});

// ---------------------------------------------------------------------------
// inleveren --fastlane label-check
// ---------------------------------------------------------------------------

const BRANCH = 'slice/58-1';
const PR_URL = 'https://github.com/gjvv13/factory/pull/1';

/** Standaard board-antwoord voor zetKolom. */
const BOARD_ANTWOORD = JSON.stringify({
  data: {
    user: {
      projectV2: {
        id: 'PVT_test',
        field: {
          id: 'PVTSSF_test',
          options: [{ id: 'optie-wacht-merge', name: 'Wacht op merge' }],
        },
      },
    },
    repository: {
      issue: {
        projectItems: {
          nodes: [
            { id: 'PVTI_test', project: { number: 2 }, fieldValueByName: { name: 'Bouwen' } },
          ],
        },
      },
    },
  },
});

function maakRepo(): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'factory-inleveren-gate-'));
  writeFileSync(path.join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  return repo;
}

describe('inleveren --fastlane label-check', () => {
  let herstel: () => void;
  let repo: string;

  beforeEach(() => {
    herstel = zetBoardOmgeving({ pat: 'test-pat' });
    repo = maakRepo();
  });

  afterEach(() => {
    herstel();
    herstelUitvoerder();
  });

  it('weigert --fastlane als het issue geen fastlane-label heeft', () => {
    const bepaal: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'git' && argumenten[0] === 'rev-parse') return { stdout: BRANCH };
      if (commando === 'git' && argumenten[0] === 'status') return { stdout: '' };
      if (commando === 'git' && argumenten[0] === 'fetch') return {};
      if (commando === 'git' && argumenten[0] === 'merge-tree') return { stdout: '' };
      if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1]?.includes('graphql'))
        return { stdout: BOARD_ANTWOORD };
      if (commando === 'gh' && argumenten[1] === 'view') return { code: 1 }; // nog geen PR
      if (commando === 'gh' && argumenten[1] === 'create') return { stdout: PR_URL };
      // heeftLabel-aanroep: geeft labels zonder fastlane terug
      if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1]?.includes('/issues/58'))
        return { stdout: '["type:task"]' };
      return {};
    };
    const { uitvoerder } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    expect(() => {
      inleveren({ fastlane: true, cwd: repo });
    }).toThrow(/--fastlane vereist het label 'fastlane'/);
  });

  it('laat --fastlane door als het issue het fastlane-label heeft', () => {
    const bepaal: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'git' && argumenten[0] === 'rev-parse') return { stdout: BRANCH };
      if (commando === 'git' && argumenten[0] === 'status') return { stdout: '' };
      if (commando === 'git' && argumenten[0] === 'fetch') return {};
      if (commando === 'git' && argumenten[0] === 'merge-tree') return { stdout: '' };
      if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1]?.includes('graphql'))
        return { stdout: BOARD_ANTWOORD };
      if (commando === 'gh' && argumenten[1] === 'view') return { code: 1 }; // nog geen PR
      if (commando === 'gh' && argumenten[1] === 'create') return { stdout: PR_URL };
      // heeftLabel-aanroep: geeft labels MET fastlane terug
      if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1]?.includes('/issues/58'))
        return { stdout: '["type:task","fastlane"]' };
      if (commando === 'gh' && argumenten[0] === 'pr') return {};
      return {};
    };
    const { uitvoerder } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    // Moet niet gooien; de fastlane-PR gaat door.
    expect(() => {
      inleveren({ fastlane: true, cwd: repo });
    }).not.toThrow();
  });
});
