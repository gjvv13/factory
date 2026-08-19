import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/commands/promote.js', () => ({ promote: vi.fn() }));

import { promote } from '../src/commands/promote.js';
import { terugrol } from '../src/commands/terugrol.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type UitkomstBepaler } from './helpers.js';

function maakApp(): string {
  const werkruimte = mkdtempSync(path.join(os.tmpdir(), 'factory-terugrol-'));
  const appDir = path.join(werkruimte, 'proefapp');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    path.join(appDir, 'factory.json'),
    JSON.stringify({
      naam: 'proefapp',
      poorten: { dev: 3001, acc: 3002, prod: 3000 },
      envRoot: path.join(werkruimte, 'envs'),
    }),
  );
  return appDir;
}

/** Uitvoerder die `git tag` de meegegeven regels teruggeeft. */
function metTags(tags: string): UitkomstBepaler {
  return ({ commando, argumenten }) =>
    commando === 'git' && argumenten[0] === 'tag' ? { stdout: tags } : {};
}

describe('terugrol', () => {
  let oorspronkelijkeCwd: string;

  beforeEach(() => {
    oorspronkelijkeCwd = process.cwd();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.mocked(promote).mockReset();
  });

  afterEach(() => {
    process.chdir(oorspronkelijkeCwd);
    herstelUitvoerder();
  });

  it('promoveert de op één na nieuwste tag terug naar de omgeving', async () => {
    process.chdir(maakApp());
    stelUitvoerderIn(maakUitvoerderOpnemer(metTags('v1.0.0\nv0.3.0\nv0.2.0')).uitvoerder);

    await terugrol('prod');

    expect(promote).toHaveBeenCalledWith('prod', 'v0.3.0', {});
  });

  it('geeft --ja door zodat prod niet-interactief terug kan', async () => {
    process.chdir(maakApp());
    stelUitvoerderIn(maakUitvoerderOpnemer(metTags('v1.0.0\nv0.3.0')).uitvoerder);

    await terugrol('prod', { ja: true });

    expect(promote).toHaveBeenCalledWith('prod', 'v0.3.0', { ja: true });
  });

  it('stopt als er geen vorige tag is', async () => {
    process.chdir(maakApp());
    stelUitvoerderIn(maakUitvoerderOpnemer(metTags('v1.0.0')).uitvoerder);

    await expect(terugrol('prod')).rejects.toThrow(/geen vorige tag|één/i);
    expect(promote).not.toHaveBeenCalled();
  });
});
