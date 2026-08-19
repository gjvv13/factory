import { existsSync } from 'node:fs';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { branchVan, repoWortelVan, werkplek, werkplekPad } from '../src/commands/werkplek.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type ProcesAanroep, type UitkomstBepaler } from './helpers.js';

/**
 * Een repo-map met een voorspelbare naam, zodat het worktree-pad toetsbaar is.
 * Draait er meteen naartoe en geeft het pad terug zoals `process.cwd()` het ziet: op
 * macOS is `/var/folders/…` een symlink naar `/private/var/folders/…`, en het commando
 * rekent met dat laatste.
 */
function maakRepo(): string {
  const werkruimte = mkdtempSync(path.join(os.tmpdir(), 'factory-werkplek-'));
  const repo = path.join(werkruimte, 'proefrepo');
  mkdirSync(repo, { recursive: true });
  process.chdir(repo);
  return process.cwd();
}

function argsVan(aanroepen: ProcesAanroep[], eerste: string): string[][] {
  return aanroepen.filter((a) => a.argumenten[0] === eerste).map((a) => a.argumenten);
}

/**
 * Beantwoordt `rev-parse --git-common-dir` met de .git van `repo`, zoals git zelf doet.
 * Alleen díe aanroep: de branch-controle gebruikt óók rev-parse, en die moet leeg
 * blijven zodat een test niet per ongeluk het bestaande-branch-pad neemt.
 */
function metWortel(repo: string, extra?: UitkomstBepaler): UitkomstBepaler {
  return (aanroep, index) => {
    if (aanroep.argumenten.includes('--git-common-dir')) {
      return { stdout: `${repo}/.git` };
    }
    return extra?.(aanroep, index) ?? {};
  };
}

describe('werkplekPad', () => {
  it('legt de werkplek naast de repo, niet erin', () => {
    const pad = werkplekPad('/Users/x/Software/factory', 173);

    // Erín zou betekenen dat `git status` van de hoofdmap hem ziet — precies het
    // gedeelde-werkmap-probleem dat dit commando wegneemt.
    expect(pad).toBe('/Users/x/Software/factory-wt/173');
    expect(pad.startsWith('/Users/x/Software/factory/')).toBe(false);
  });

  it('zet de repo-naam in het pad, zodat meerdere repos naast elkaar passen', () => {
    expect(werkplekPad('/Users/x/Software/beheer', 149)).toBe('/Users/x/Software/beheer-wt/149');
  });
});

describe('branchVan', () => {
  it('houdt de vorm die het bord-bijwerken herkent', () => {
    // #128 leest het issuenummer uit `slice/<nummer>-<n>`; de -1 blijft dus staan.
    expect(branchVan(173)).toBe('slice/173-1');
  });
});

describe('werkplek', () => {
  let oorspronkelijkeCwd: string;

  let uitvoer: string[];

  beforeEach(() => {
    oorspronkelijkeCwd = process.cwd();
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
  });

  afterEach(() => {
    process.chdir(oorspronkelijkeCwd);
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('fetcht en maakt de worktree op een nieuwe branch vanaf origin/main', () => {
    const repo = maakRepo();
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(metWortel(repo));
    stelUitvoerderIn(uitvoerder);

    werkplek('173');

    // Eerst vers ophalen: een worktree van een verouderde main conflicteert pas bij
    // het inleveren, en dat is het duurste moment om dat te merken.
    expect(argsVan(aanroepen, 'fetch')[0]).toEqual(['fetch', '-q', 'origin']);
    expect(argsVan(aanroepen, 'worktree')).toContainEqual([
      'worktree',
      'add',
      '-q',
      '-b',
      'slice/173-1',
      werkplekPad(repo, 173),
      'origin/main',
    ]);
    // Het pad op stdout is het product: /bouw gebruikt het om erheen te gaan.
    expect(uitvoer.join('')).toContain(`${werkplekPad(repo, 173)}\n`);
  });

  it('hervat een bestaande branch in plaats van te falen op -b', () => {
    const repo = maakRepo();
    const bepaal: UitkomstBepaler = ({ argumenten }) =>
      argumenten[0] === 'rev-parse' && argumenten[1] === '-q'
        ? { stdout: 'abc123' } // de branch bestaat al
        : {};
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(metWortel(repo, bepaal));
    stelUitvoerderIn(uitvoerder);

    werkplek('173');

    // `worktree remove` laat de branch staan, dus na een --op bestaat hij nog. Met -b
    // zou git hier hard afbreken met "a branch named ... already exists".
    expect(argsVan(aanroepen, 'worktree')).toContainEqual([
      'worktree',
      'add',
      '-q',
      werkplekPad(repo, 173),
      'slice/173-1',
    ]);
    expect(argsVan(aanroepen, 'worktree').some((a) => a.includes('-b'))).toBe(false);
  });

  it('doet niets als de werkplek al bestaat', () => {
    const repo = maakRepo();
    mkdirSync(werkplekPad(repo, 173), { recursive: true });
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(metWortel(repo));
    stelUitvoerderIn(uitvoerder);

    werkplek('173');

    // Idempotent: een hervatte sessie krijgt dezelfde map, geen fout en geen tweede add.
    expect(aanroepen.some((a) => a.argumenten[0] === 'worktree')).toBe(false);
    expect(uitvoer.join('')).toContain(`${werkplekPad(repo, 173)}\n`);
  });

  it('meldt waar de branch al staat in plaats van een kale git-fout', () => {
    const repo = maakRepo();
    const bepaal: UitkomstBepaler = ({ argumenten }) =>
      argumenten[0] === 'rev-parse'
        ? { stdout: `${repo}/.git` }
        : argumenten[0] === 'worktree' && argumenten[1] === 'list'
          ? {
              stdout: [
                `worktree ${repo}`,
                'branch refs/heads/main',
                '',
                `worktree ${werkplekPad(repo, 173)}`,
                'branch refs/heads/slice/173-1',
              ].join('\n'),
            }
          : {};
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    expect(() => {
      werkplek('173');
    }).toThrow(new RegExp(`slice/173-1 is al uitgecheckt in ${werkplekPad(repo, 173)}`));
  });

  it('weigert een issuenummer dat er geen is', () => {
    maakRepo();
    stelUitvoerderIn(maakUitvoerderOpnemer().uitvoerder);

    expect(() => {
      werkplek('geen-nummer');
    }).toThrow(/factory werkplek <issuenummer>/);
  });

  it('ruimt met --op de werkplek op', () => {
    const repo = maakRepo();
    mkdirSync(werkplekPad(repo, 173), { recursive: true });
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(metWortel(repo));
    stelUitvoerderIn(uitvoerder);

    werkplek('173', { op: true });

    expect(argsVan(aanroepen, 'worktree')).toContainEqual([
      'worktree',
      'remove',
      werkplekPad(repo, 173),
    ]);
  });

  it('laat de werkplek staan als er nog ongecommit werk in zit', () => {
    const repo = maakRepo();
    mkdirSync(werkplekPad(repo, 173), { recursive: true });
    const regels: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      regels.push(String(tekst));
      return true;
    });
    // git weigert zonder --force bij vuil werk; die weigering is de bescherming.
    stelUitvoerderIn(maakUitvoerderOpnemer(metWortel(repo, () => ({ code: 1 }))).uitvoerder);

    werkplek('173', { op: true });

    expect(regels.join('')).toMatch(/blijft staan/);
    expect(existsSync(werkplekPad(repo, 173))).toBe(true);
  });
});

describe('repoWortelVan', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  it('wijst naar de hoofdkloon, ook vanuit een worktree', () => {
    // Zonder dit stapelt het: vanuit factory-wt/128 zou de nieuwe werkplek in
    // factory-wt/128-wt/999 belanden. Dat gebeurde bij de eerste echte proef.
    stelUitvoerderIn(
      maakUitvoerderOpnemer(() => ({ stdout: '/Users/x/Software/factory/.git' })).uitvoerder,
    );

    const wortel = repoWortelVan('/Users/x/Software/factory-wt/128');

    expect(wortel).toBe('/Users/x/Software/factory');
    expect(werkplekPad(wortel, 999)).toBe('/Users/x/Software/factory-wt/999');
  });
});
