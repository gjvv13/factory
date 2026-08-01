import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { release } from '../src/commands/release.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type ProcesAanroep, type UitkomstBepaler } from './helpers.js';

function maakRepo(versie = '0.2.0'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'factory-release-'));
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'proefapp', version: versie, scripts: { lint: 'eslint .' } }),
  );
  return dir;
}

/** Standaard-git voor een gezonde release: op main, met een schone werkmap. */
const opSchoneMain: UitkomstBepaler = (aanroep) => {
  const a = aanroep.argumenten;
  if (a[0] === 'rev-parse' && a[1] === '--abbrev-ref') {
    return { stdout: 'main' };
  }
  return {};
};

function eersteIndex(aanroepen: ProcesAanroep[], test: (a: ProcesAanroep) => boolean): number {
  return aanroepen.findIndex(test);
}

describe('release', () => {
  let oorspronkelijkeCwd: string;

  beforeEach(() => {
    oorspronkelijkeCwd = process.cwd();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    process.chdir(oorspronkelijkeCwd);
    herstelUitvoerder();
  });

  it('verhoogt de versie, commit, tagt en pusht in die volgorde', () => {
    const repo = maakRepo('0.2.0');
    process.chdir(repo);
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(opSchoneMain);
    stelUitvoerderIn(uitvoerder);

    release('patch');

    const bump = eersteIndex(aanroepen, (a) => a.argumenten.includes('version'));
    const commit = eersteIndex(aanroepen, (a) => a.argumenten[0] === 'commit');
    const tag = eersteIndex(
      aanroepen,
      (a) => a.argumenten[0] === 'tag' && a.argumenten.includes('-a'),
    );
    const pushMain = eersteIndex(
      aanroepen,
      (a) => a.argumenten[0] === 'push' && a.argumenten.includes('main'),
    );
    const pushTag = eersteIndex(
      aanroepen,
      (a) => a.argumenten[0] === 'push' && a.argumenten.includes('v0.2.0'),
    );

    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThan(commit);
    expect(commit).toBeLessThan(tag);
    expect(tag).toBeLessThan(pushMain);
    expect(pushMain).toBeLessThan(pushTag);
    // De tag draagt de versie uit package.json.
    expect(aanroepen).toContainEqual(
      expect.objectContaining({
        commando: 'git',
        argumenten: expect.arrayContaining(['tag', '-a', 'v0.2.0']),
      }),
    );
  });

  it('weigert te releasen buiten main', () => {
    const repo = maakRepo();
    process.chdir(repo);
    const { uitvoerder } = maakUitvoerderOpnemer((a) =>
      a.argumenten[0] === 'rev-parse' ? { stdout: 'feature' } : {},
    );
    stelUitvoerderIn(uitvoerder);

    expect(() => {
      release('patch');
    }).toThrow(/alleen vanaf main/);
  });

  it('weigert te releasen met een vuile werkmap', () => {
    const repo = maakRepo();
    process.chdir(repo);
    const { uitvoerder } = maakUitvoerderOpnemer((a) => {
      if (a.argumenten[0] === 'rev-parse' && a.argumenten[1] === '--abbrev-ref') {
        return { stdout: 'main' };
      }
      if (a.argumenten[0] === 'status' && a.argumenten.includes('--porcelain')) {
        return { stdout: 'M package.json' };
      }
      return {};
    });
    stelUitvoerderIn(uitvoerder);

    expect(() => {
      release('patch');
    }).toThrow(/niet schoon/);
  });

  it('weigert als de tag al bestaat', () => {
    const repo = maakRepo('0.2.0');
    process.chdir(repo);
    const { uitvoerder } = maakUitvoerderOpnemer((a) => {
      if (a.argumenten[0] === 'rev-parse' && a.argumenten[1] === '--abbrev-ref') {
        return { stdout: 'main' };
      }
      if (a.argumenten[0] === 'tag' && a.argumenten.includes('--list')) {
        return { stdout: 'v0.2.0' };
      }
      return {};
    });
    stelUitvoerderIn(uitvoerder);

    expect(() => {
      release('patch');
    }).toThrow(/bestaat al/);
  });
});
