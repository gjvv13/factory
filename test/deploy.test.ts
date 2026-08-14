import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/commands/release.js', () => ({ release: vi.fn() }));
vi.mock('../src/commands/promote.js', () => ({ promote: vi.fn(() => Promise.resolve()) }));

import { deploy } from '../src/commands/deploy.js';
import { promote } from '../src/commands/promote.js';
import { release } from '../src/commands/release.js';
import { syncVerschillen } from '../src/commands/sync.js';

describe('deploy', () => {
  beforeEach(() => {
    vi.mocked(release).mockReset();
    vi.mocked(promote).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('acc: maakt eerst een release en promoveert daarna naar acc', async () => {
    await deploy('acc');

    expect(release).toHaveBeenCalledTimes(1);
    expect(promote).toHaveBeenCalledWith('acc', undefined);
    // Release moet vóór de promote lopen: eerst de tag, dan uitrollen.
    const releaseVolgorde = vi.mocked(release).mock.invocationCallOrder[0];
    const promoteVolgorde = vi.mocked(promote).mock.invocationCallOrder[0];
    expect(Number(releaseVolgorde)).toBeLessThan(Number(promoteVolgorde));
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
