import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/commands/verify.js', () => ({ verify: vi.fn() }));

import { inleveren } from '../src/commands/inleveren.js';
import { verify } from '../src/commands/verify.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type ProcesAanroep, type UitkomstBepaler } from './helpers.js';

const BRANCH = 'slice/58-1';
const PR_URL = 'https://github.com/gjvv13/factory/pull/1';

/** Temp-repo met een lockfile (bestaat), zonder dekking-basislijn (skip). */
function maakRepo(): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'factory-inleveren-'));
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  return repo;
}

/** Temp-repo met een factory.json die de lokale wachtrij kiest. */
function maakLokaleRepo(): string {
  const repo = maakRepo();
  writeFileSync(
    path.join(repo, 'factory.json'),
    JSON.stringify({
      naam: 'proefapp',
      poorten: { dev: 3001, acc: 3002, prod: 3000 },
      envRoot: path.join(repo, 'envs'),
      integratie: 'lokaal',
    }),
  );
  return repo;
}

/** Standaard-bepaler voor de gelukkige weg: slice-branch, schone tree, geen bestaande PR. */
const gelukkig: UitkomstBepaler = ({ commando, argumenten }) => {
  if (commando === 'git' && argumenten[0] === 'rev-parse') return { stdout: BRANCH };
  if (commando === 'git' && argumenten[0] === 'status') return { stdout: '' };
  if (commando === 'gh' && argumenten[1] === 'view') return { code: 1 }; // nog geen PR
  if (commando === 'gh' && argumenten[1] === 'create') return { stdout: PR_URL };
  return {};
};

function argsVan(aanroepen: ProcesAanroep[], commando: string): string[][] {
  return aanroepen.filter((a) => a.commando === commando).map((a) => a.argumenten);
}

describe('inleveren', () => {
  let oorspronkelijkeCwd: string;

  beforeEach(() => {
    oorspronkelijkeCwd = process.cwd();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.mocked(verify).mockReset();
  });

  afterEach(() => {
    process.chdir(oorspronkelijkeCwd);
    herstelUitvoerder();
  });

  it('draait de poort, pusht de branch, opent een PR en zet auto-merge aan', () => {
    process.chdir(maakRepo());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkig);
    stelUitvoerderIn(uitvoerder);

    inleveren();

    expect(verify).toHaveBeenCalledTimes(1);
    // Branch gepusht met upstream.
    expect(argsVan(aanroepen, 'git')).toContainEqual(['push', '-q', '-u', 'origin', BRANCH]);
    // PR aangemaakt naar main met --fill (geen titel meegegeven).
    expect(argsVan(aanroepen, 'gh')).toContainEqual([
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      BRANCH,
      '--fill',
    ]);
    // Auto-merge op de teruggegeven PR-url → belandt in de merge-queue.
    expect(argsVan(aanroepen, 'gh')).toContainEqual(['pr', 'merge', PR_URL, '--auto', '--merge']);
    // Lockfile ongewijzigd → geen commit.
    expect(argsVan(aanroepen, 'git').some((a) => a[0] === 'commit')).toBe(false);
  });

  it('weigert inleveren vanaf main', () => {
    process.chdir(maakRepo());
    const bepaal: UitkomstBepaler = ({ commando, argumenten }) =>
      commando === 'git' && argumenten[0] === 'rev-parse' ? { stdout: 'main' } : {};
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    expect(() => {
      inleveren();
    }).toThrow(/slice-branch|main/);
    expect(verify).not.toHaveBeenCalled();
  });

  it('weigert een vieze werkmap en draait de poort niet', () => {
    process.chdir(maakRepo());
    const bepaal: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'git' && argumenten[0] === 'rev-parse') return { stdout: BRANCH };
      // De vieze-tree-guard is `git status --porcelain` zonder pad (2 args).
      if (commando === 'git' && argumenten[0] === 'status' && argumenten.length === 2) {
        return { stdout: ' M app/src/foo.ts' };
      }
      return { stdout: '' };
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    expect(() => {
      inleveren();
    }).toThrow(/niet schoon/);
    expect(verify).not.toHaveBeenCalled();
  });

  it('committeert de lockfile als die door de sync wijzigde', () => {
    process.chdir(maakRepo());
    const bepaal: UitkomstBepaler = (aanroep) => {
      const r = gelukkig(aanroep, 0);
      // Lockfile-check (`git status --porcelain pnpm-lock.yaml`, 3 args) meldt wijziging.
      if (
        aanroep.commando === 'git' &&
        aanroep.argumenten[0] === 'status' &&
        aanroep.argumenten.length === 3
      ) {
        return { stdout: ' M pnpm-lock.yaml' };
      }
      return r;
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    inleveren();

    expect(argsVan(aanroepen, 'git')).toContainEqual(['add', 'pnpm-lock.yaml']);
    expect(argsVan(aanroepen, 'git')).toContainEqual([
      'commit',
      '-q',
      '-m',
      'sync lockfile voor inleveren',
    ]);
  });

  it('hergebruikt een bestaande PR in plaats van een nieuwe te maken', () => {
    process.chdir(maakRepo());
    const bepaal: UitkomstBepaler = (aanroep) => {
      if (aanroep.commando === 'gh' && aanroep.argumenten[1] === 'view') {
        return { stdout: PR_URL }; // bestaande PR
      }
      return gelukkig(aanroep, 0);
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    inleveren();

    expect(argsVan(aanroepen, 'gh').some((a) => a[1] === 'create')).toBe(false);
    expect(argsVan(aanroepen, 'gh')).toContainEqual(['pr', 'merge', PR_URL, '--auto', '--merge']);
  });

  it('geeft een expliciete titel door aan de PR', () => {
    process.chdir(maakRepo());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkig);
    stelUitvoerderIn(uitvoerder);

    inleveren({ titel: 'Mijn slice' });

    const create = argsVan(aanroepen, 'gh').find((a) => a[1] === 'create');
    expect(create).toContain('--title');
    expect(create).toContain('Mijn slice');
    expect(create).not.toContain('--fill');
  });

  it('lokale wachtrij-route: labelt de PR i.p.v. auto-merge', () => {
    process.chdir(maakLokaleRepo());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkig);
    stelUitvoerderIn(uitvoerder);

    inleveren();

    // Label (idempotent) aangemaakt en op de PR gezet; géén auto-merge.
    expect(argsVan(aanroepen, 'gh').some((a) => a[0] === 'label' && a[1] === 'create')).toBe(true);
    expect(argsVan(aanroepen, 'gh')).toContainEqual([
      'pr',
      'edit',
      PR_URL,
      '--add-label',
      'wachtrij',
    ]);
    expect(argsVan(aanroepen, 'gh').some((a) => a[1] === 'merge')).toBe(false);
  });
});
