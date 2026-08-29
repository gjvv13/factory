import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/commands/release.js', () => ({ release: vi.fn(() => 'v1.2.3') }));
vi.mock('../src/commands/promote.js', () => ({ promote: vi.fn(() => Promise.resolve()) }));

import { deploy } from '../src/commands/deploy.js';
import { promote } from '../src/commands/promote.js';
import { release } from '../src/commands/release.js';
import { syncVerschillen } from '../src/commands/sync.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, zetBoardOmgeving, type UitkomstBepaler } from './helpers.js';

describe('deploy', () => {
  let herstelOmgeving: () => void;

  beforeEach(() => {
    vi.mocked(release).mockReset().mockReturnValue('v1.2.3');
    vi.mocked(promote).mockReset().mockResolvedValue(undefined);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('acc: maakt eerst een release en promoveert daarna naar acc', async () => {
    // Stub git tag (vorige tag) en git log (bereik) zodat issuesUitBereik leeg blijft.
    const bepaal: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'git' && argumenten[0] === 'tag') return { stdout: 'v1.2.2' };
      if (commando === 'git' && argumenten[0] === 'log') return { stdout: '' };
      return {};
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    await deploy('acc');

    expect(release).toHaveBeenCalledTimes(1);
    expect(promote).toHaveBeenCalledWith('acc', undefined);
    // Release moet vóór de promote lopen: eerst de tag, dan uitrollen.
    const releaseVolgorde = vi.mocked(release).mock.invocationCallOrder[0];
    const promoteVolgorde = vi.mocked(promote).mock.invocationCallOrder[0];
    expect(Number(releaseVolgorde)).toBeLessThan(Number(promoteVolgorde));
  });

  it('acc: verplaatst items uit het tagbereik van Wacht op merge naar Uitrollen', async () => {
    const BOARD_ANTWOORD = JSON.stringify({
      data: {
        user: {
          projectV2: {
            id: 'PVT_test',
            field: {
              id: 'PVTSSF_test',
              options: [{ id: 'optie-uitrollen', name: 'Uitrollen' }],
            },
          },
        },
        repository: {
          issue: {
            projectItems: {
              nodes: [
                {
                  id: 'PVTI_test',
                  project: { number: 2 },
                  fieldValueByName: { name: 'Wacht op merge' },
                },
              ],
            },
          },
        },
      },
    });

    const bepaal: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'git' && argumenten[0] === 'tag') return { stdout: 'v1.2.2' };
      // git log voor het bereik: één slice-merge.
      if (commando === 'git' && argumenten[0] === 'log') {
        return { stdout: 'Merge pull request #99 from gjvv13/slice/58-1\n' };
      }
      // Board-opzoeking.
      if (commando === 'gh' && argumenten[0] === 'api') return { stdout: BOARD_ANTWOORD };
      return {};
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    await deploy('acc');

    // Issue 58 moet naar Uitrollen zijn verplaatst.
    const ghArgs = aanroepen.filter((a) => a.commando === 'gh').map((a) => a.argumenten);
    expect(ghArgs).toContainEqual([
      'project',
      'item-edit',
      '--id',
      'PVTI_test',
      '--project-id',
      'PVT_test',
      '--field-id',
      'PVTSSF_test',
      '--single-select-option-id',
      'optie-uitrollen',
    ]);
  });

  it('prod: promoveert de bestaande tag zonder een nieuwe release', async () => {
    await deploy('prod');

    expect(release).not.toHaveBeenCalled();
    // Niet-interactief op de runner: --ja, want de goedkeuring zit in het environment.
    expect(promote).toHaveBeenCalledWith('prod', undefined, { ja: true });
  });

  it('weigert een onbekende omgeving', async () => {
    await expect(deploy('staging')).rejects.toThrow(/acc\|prod/);
    await expect(deploy(undefined)).rejects.toThrow(/acc\|prod/);
    expect(release).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
  });
});

describe('sync neemt de deploy-workflow mee', () => {
  it('ziet .github/workflows/deploy.yml als te synchroniseren bestand', () => {
    const app = mkdtempSync(path.join(os.tmpdir(), 'factory-deploy-sync-'));
    const verschillen = syncVerschillen(app);
    const paden = verschillen.map((v) => v.pad);
    expect(paden).toContain(path.join('.github', 'workflows', 'deploy.yml'));
  });
});
