import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { opruimen } from '../src/commands/opruimen.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, type ProcesAanroep, type UitkomstBepaler } from './helpers.js';

interface GitOmgeving {
  /** De huidige branch (default: 'main'). */
  readonly huidig?: string;
  /** Lokale branches inclusief main en huidig (default: ['main']). */
  readonly lokaal?: string[];
  /** Remote branches zonder origin/ prefix (default: []). */
  readonly remote?: string[];
  /** Branch-namen die gemerged zijn in origin/main. */
  readonly gemerged?: ReadonlySet<string>;
  /** Porcelain-uitvoer van `git worktree list` (default: ''). */
  readonly worktrees?: string;
  /** stderr van `git fetch --prune`, regels met [deleted] worden geteld (default: ''). */
  readonly fetchStderr?: string;
}

/** Bouwt een uitkomstbepaler die een complete git-omgeving nabootst. */
function maakGitOmgeving(config: GitOmgeving = {}): UitkomstBepaler {
  const gemerged = config.gemerged ?? new Set<string>();
  return ({ commando, argumenten }) => {
    if (commando !== 'git') return {};

    const sub = argumenten[0];

    // git fetch --prune
    if (sub === 'fetch') {
      return { stdout: '', stderr: config.fetchStderr ?? '' };
    }

    // git rev-parse --abbrev-ref HEAD
    if (sub === 'rev-parse' && argumenten.includes('HEAD')) {
      return { stdout: config.huidig ?? 'main' };
    }

    // git worktree list --porcelain
    if (sub === 'worktree') {
      return { stdout: config.worktrees ?? '' };
    }

    // git branch --format=... (listing) vs git branch -d (deletion)
    if (sub === 'branch') {
      if (argumenten.some((a) => a.startsWith('--format'))) {
        if (argumenten.includes('-r')) {
          return {
            stdout: (config.remote ?? []).map((b) => `origin/${b}`).join('\n'),
          };
        }
        return { stdout: (config.lokaal ?? ['main']).join('\n') };
      }
      // branch -d: deletion, slaagt altijd in de test
      return {};
    }

    // git merge-base --is-ancestor <ref> origin/main
    if (sub === 'merge-base') {
      const ref = argumenten[2] ?? '';
      const naam = ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref;
      return { code: gemerged.has(naam) ? 0 : 1 };
    }

    // git push origin --delete <branch>
    if (sub === 'push') {
      return {};
    }

    return {};
  };
}

/** Filtert de opgenomen aanroepen op lokale branch-verwijderingen. */
function lokaleVerwijderingen(aanroepen: readonly ProcesAanroep[]): string[] {
  return aanroepen
    .filter((a) => a.commando === 'git' && a.argumenten[0] === 'branch' && a.argumenten[1] === '-d')
    .map((a) => a.argumenten[2] ?? '');
}

/** Filtert de opgenomen aanroepen op remote branch-verwijderingen. */
function remoteVerwijderingen(aanroepen: readonly ProcesAanroep[]): string[] {
  return aanroepen
    .filter(
      (a) =>
        a.commando === 'git' && a.argumenten[0] === 'push' && a.argumenten.includes('--delete'),
    )
    .map((a) => a.argumenten[a.argumenten.length - 1] ?? '');
}

describe('opruimen', () => {
  const uitvoer: string[] = [];

  beforeEach(() => {
    uitvoer.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      if (typeof chunk === 'string') uitvoer.push(chunk);
      return true;
    });
  });

  afterEach(() => {
    herstelUitvoerder();
  });

  it('verwijdert lokale branches die in origin/main zitten', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main', 'feature-a', 'feature-b'],
        gemerged: new Set(['feature-a', 'feature-b']),
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen();

    expect(lokaleVerwijderingen(aanroepen)).toEqual(['feature-a', 'feature-b']);
  });

  it('laat niet-gemergede branches staan', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main', 'feature-a', 'wip-b'],
        gemerged: new Set(['feature-a']),
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen();

    expect(lokaleVerwijderingen(aanroepen)).toEqual(['feature-a']);
  });

  it('--dry roept geen branch -d of push --delete aan', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main', 'feature-a'],
        remote: ['feature-b'],
        gemerged: new Set(['feature-a', 'feature-b']),
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen({ dry: true });

    expect(lokaleVerwijderingen(aanroepen)).toEqual([]);
    expect(remoteVerwijderingen(aanroepen)).toEqual([]);
  });

  it('slaat main altijd over, ook als hij gemerged is', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main', 'feature-a'],
        gemerged: new Set(['main', 'feature-a']),
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen();

    expect(lokaleVerwijderingen(aanroepen)).toEqual(['feature-a']);
  });

  it('slaat de huidige branch altijd over', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        huidig: 'slice/99-1',
        lokaal: ['main', 'slice/99-1', 'feature-a'],
        gemerged: new Set(['slice/99-1', 'feature-a']),
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen();

    expect(lokaleVerwijderingen(aanroepen)).toEqual(['feature-a']);
  });

  it('prunt vóór het oordeel over branches', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main', 'feature-a'],
        gemerged: new Set(['feature-a']),
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen();

    const fetchIndex = aanroepen.findIndex(
      (a) => a.commando === 'git' && a.argumenten[0] === 'fetch',
    );
    const eerstebranchIndex = aanroepen.findIndex(
      (a) =>
        a.commando === 'git' &&
        a.argumenten[0] === 'branch' &&
        a.argumenten.some((arg) => arg.startsWith('--format')),
    );
    expect(fetchIndex).toBeGreaterThanOrEqual(0);
    expect(eerstebranchIndex).toBeGreaterThan(fetchIndex);
  });

  it('slaat een branch in een worktree over met een melding', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main', 'slice/42-1', 'feature-a'],
        gemerged: new Set(['slice/42-1', 'feature-a']),
        worktrees: [
          'worktree /pad/naar/repo',
          'HEAD abc123',
          'branch refs/heads/main',
          '',
          'worktree /pad/naar/wt/42',
          'HEAD def456',
          'branch refs/heads/slice/42-1',
          '',
        ].join('\n'),
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen();

    // slice/42-1 is overgeslagen; alleen feature-a verwijderd
    expect(lokaleVerwijderingen(aanroepen)).toEqual(['feature-a']);
    // De melding verschijnt in de uitvoer
    const schrijfaanroepen = uitvoer;
    expect(schrijfaanroepen.some((s) => typeof s === 'string' && s.includes('slice/42-1'))).toBe(
      true,
    );
    expect(schrijfaanroepen.some((s) => typeof s === 'string' && s.includes('worktree'))).toBe(
      true,
    );
  });

  it('verwijdert gemergede remote-branches', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main'],
        remote: ['old-feature', 'wip'],
        gemerged: new Set(['old-feature']),
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen();

    expect(remoteVerwijderingen(aanroepen)).toEqual(['old-feature']);
  });

  it('laat niet-gemergede remote-branches staan', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main'],
        remote: ['wip', 'release/v1.15.2'],
        gemerged: new Set<string>(),
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen();

    expect(remoteVerwijderingen(aanroepen)).toEqual([]);
  });

  it('telt geprunede remote-refs uit de fetch-uitvoer', () => {
    const { uitvoerder } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main'],
        fetchStderr: [
          'From https://github.com/user/repo',
          ' - [deleted]         (none)     -> origin/old-1',
          ' - [deleted]         (none)     -> origin/old-2',
          '   abc..def  main -> origin/main',
        ].join('\n'),
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen({ dry: true });

    const schrijfaanroepen = uitvoer;
    expect(schrijfaanroepen.some((s) => typeof s === 'string' && s.includes('2 remote-refs'))).toBe(
      true,
    );
  });
});
