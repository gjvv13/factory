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
  /** Het pad dat `git rev-parse --show-toplevel` teruggeeft (default: '/repo'). */
  readonly toplevel?: string;
  /** Map van issue-nummers naar hun staat ('OPEN' | 'CLOSED'). */
  readonly issueStaat?: ReadonlyMap<string, string>;
  /** Map van worktree-paden naar hun git status --porcelain uitvoer. */
  readonly worktreeStatus?: ReadonlyMap<string, string>;
  /** Map van worktree-paden naar hun rev-list --count uitvoer. */
  readonly worktreeAheadCount?: ReadonlyMap<string, string>;
  /** JSON-uitvoer van `gh pr list` voor release-PR's. */
  readonly releasePrJson?: string;
  /** De nieuwste tag van `git describe --tags`. */
  readonly laatsteTag?: string;
  /** Map van branches naar merge-tree exit code en stdout. */
  readonly mergeTree?: ReadonlyMap<string, { code: number; stdout: string }>;
  /** Branches waarvan de rebase slaagt (default: alle). */
  readonly rebaseSlaagt?: ReadonlySet<string>;
}

/** Bouwt een uitkomstbepaler die een complete git-omgeving nabootst. */
function maakGitOmgeving(config: GitOmgeving = {}): UitkomstBepaler {
  const gemerged = config.gemerged ?? new Set<string>();
  const issueStaat = config.issueStaat ?? new Map<string, string>();
  const worktreeStatus = config.worktreeStatus ?? new Map<string, string>();
  const worktreeAheadCount = config.worktreeAheadCount ?? new Map<string, string>();
  const mergeTree = config.mergeTree ?? new Map<string, { code: number; stdout: string }>();
  const rebaseSlaagt = config.rebaseSlaagt;
  const toplevel = config.toplevel ?? '/repo';

  return ({ commando, argumenten }) => {
    if (commando === 'gh') {
      // gh issue view <nr> --json state -q .state
      if (argumenten[0] === 'issue' && argumenten[1] === 'view') {
        const nr = argumenten[2] ?? '';
        const staat = issueStaat.get(nr);
        if (staat !== undefined) return { stdout: staat };
        return { code: 1, stdout: '' };
      }
      // gh pr list voor release-PR's
      if (argumenten[0] === 'pr' && argumenten[1] === 'list') {
        return { stdout: config.releasePrJson ?? '[]' };
      }
      // gh pr close
      if (argumenten[0] === 'pr' && argumenten[1] === 'close') {
        return {};
      }
      return {};
    }

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

    // git rev-parse --show-toplevel
    if (sub === 'rev-parse' && argumenten.includes('--show-toplevel')) {
      return { stdout: toplevel };
    }

    // git worktree list --porcelain
    if (sub === 'worktree' && argumenten[1] === 'list') {
      return { stdout: config.worktrees ?? '' };
    }

    // git worktree remove <pad>
    if (sub === 'worktree' && argumenten[1] === 'remove') {
      return {};
    }

    // git -C <pad> status --porcelain
    if (argumenten[0] === '-C' && argumenten[2] === 'status') {
      const pad = argumenten[1] ?? '';
      const status = worktreeStatus.get(pad);
      return { stdout: status ?? '' };
    }

    // git -C <pad> rev-list --count origin/main..HEAD
    if (argumenten[0] === '-C' && argumenten[2] === 'rev-list') {
      const pad = argumenten[1] ?? '';
      const count = worktreeAheadCount.get(pad);
      return { stdout: count ?? '0' };
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
    if (sub === 'push' && argumenten.includes('--delete')) {
      return {};
    }

    // git push --force-with-lease
    if (sub === 'push' && argumenten.includes('--force-with-lease')) {
      return {};
    }

    // git merge-tree --write-tree
    if (sub === 'merge-tree') {
      const branch = argumenten[argumenten.length - 1] ?? '';
      const result = mergeTree.get(branch);
      if (result !== undefined) return { code: result.code, stdout: result.stdout };
      return { code: 0, stdout: '' };
    }

    // git describe --tags --abbrev=0
    if (sub === 'describe') {
      return { stdout: config.laatsteTag ?? '' };
    }

    // git checkout / git rebase / git rebase --abort
    if (sub === 'checkout') {
      return {};
    }
    if (sub === 'rebase') {
      if (argumenten.includes('--abort')) return {};
      // Simplificatie: rebase slaagt altijd tenzij expliciet uitgezet.
      if (rebaseSlaagt !== undefined) {
        return { code: 0, stdout: '' };
      }
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

/** Filtert op git worktree remove aanroepen. */
function worktreeVerwijderingen(aanroepen: readonly ProcesAanroep[]): string[] {
  return aanroepen
    .filter(
      (a) => a.commando === 'git' && a.argumenten[0] === 'worktree' && a.argumenten[1] === 'remove',
    )
    .map((a) => a.argumenten[2] ?? '');
}

/** Filtert op gh pr close aanroepen. */
function prSluitingen(aanroepen: readonly ProcesAanroep[]): number[] {
  return aanroepen
    .filter((a) => a.commando === 'gh' && a.argumenten[0] === 'pr' && a.argumenten[1] === 'close')
    .map((a) => Number.parseInt(a.argumenten[2] ?? '0', 10));
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

  // --- Bestaande branch-opruim-tests ---

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

  // --- Worktree-opruim-tests (#421) ---

  describe('worktree-opruimen', () => {
    const worktreePorcelain = [
      'worktree /repo',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /wt/42',
      'HEAD bbb',
      'branch refs/heads/slice/42-1',
      '',
      'worktree /wt/99',
      'HEAD ccc',
      'branch refs/heads/slice/99-2',
      '',
    ].join('\n');

    it('verwijdert een worktree waarvan het issue dicht is, status schoon, 0 commits boven main', () => {
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
        maakGitOmgeving({
          lokaal: ['main'],
          worktrees: worktreePorcelain,
          toplevel: '/repo',
          issueStaat: new Map([
            ['42', 'CLOSED'],
            ['99', 'CLOSED'],
          ]),
          worktreeStatus: new Map([
            ['/wt/42', ''],
            ['/wt/99', ''],
          ]),
          worktreeAheadCount: new Map([
            ['/wt/42', '0'],
            ['/wt/99', '0'],
          ]),
        }),
      );
      stelUitvoerderIn(uitvoerder);

      opruimen();

      expect(worktreeVerwijderingen(aanroepen)).toEqual(['/wt/42', '/wt/99']);
    });

    it('slaat een worktree over met ongecommitte wijzigingen', () => {
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
        maakGitOmgeving({
          lokaal: ['main'],
          worktrees: worktreePorcelain,
          toplevel: '/repo',
          issueStaat: new Map([
            ['42', 'CLOSED'],
            ['99', 'CLOSED'],
          ]),
          worktreeStatus: new Map([
            ['/wt/42', ' M src/file.ts'],
            ['/wt/99', ''],
          ]),
          worktreeAheadCount: new Map([
            ['/wt/42', '0'],
            ['/wt/99', '0'],
          ]),
        }),
      );
      stelUitvoerderIn(uitvoerder);

      opruimen();

      expect(worktreeVerwijderingen(aanroepen)).toEqual(['/wt/99']);
      expect(uitvoer.some((s) => s.includes('/wt/42') && s.includes('overgeslagen'))).toBe(true);
    });

    it('slaat een worktree over met niet-gepushte commits', () => {
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
        maakGitOmgeving({
          lokaal: ['main'],
          worktrees: worktreePorcelain,
          toplevel: '/repo',
          issueStaat: new Map([
            ['42', 'CLOSED'],
            ['99', 'CLOSED'],
          ]),
          worktreeStatus: new Map([
            ['/wt/42', ''],
            ['/wt/99', ''],
          ]),
          worktreeAheadCount: new Map([
            ['/wt/42', '3'],
            ['/wt/99', '0'],
          ]),
        }),
      );
      stelUitvoerderIn(uitvoerder);

      opruimen();

      expect(worktreeVerwijderingen(aanroepen)).toEqual(['/wt/99']);
      expect(uitvoer.some((s) => s.includes('/wt/42') && s.includes('overgeslagen'))).toBe(true);
    });

    it('laat een worktree met een open issue met rust', () => {
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
        maakGitOmgeving({
          lokaal: ['main'],
          worktrees: worktreePorcelain,
          toplevel: '/repo',
          issueStaat: new Map([
            ['42', 'OPEN'],
            ['99', 'CLOSED'],
          ]),
          worktreeStatus: new Map([
            ['/wt/42', ''],
            ['/wt/99', ''],
          ]),
          worktreeAheadCount: new Map([
            ['/wt/42', '0'],
            ['/wt/99', '0'],
          ]),
        }),
      );
      stelUitvoerderIn(uitvoerder);

      opruimen();

      // Alleen 99 verwijderd, niet 42 (issue open).
      expect(worktreeVerwijderingen(aanroepen)).toEqual(['/wt/99']);
      expect(uitvoer.some((s) => s.includes('/wt/42') && s.includes('issue is nog open'))).toBe(
        true,
      );
    });

    it('--dry verwijdert geen worktrees', () => {
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
        maakGitOmgeving({
          lokaal: ['main'],
          worktrees: worktreePorcelain,
          toplevel: '/repo',
          issueStaat: new Map([['42', 'CLOSED']]),
          worktreeStatus: new Map([['/wt/42', '']]),
          worktreeAheadCount: new Map([['/wt/42', '0']]),
        }),
      );
      stelUitvoerderIn(uitvoerder);

      opruimen({ dry: true });

      expect(worktreeVerwijderingen(aanroepen)).toEqual([]);
      expect(uitvoer.some((s) => s.includes('/wt/42') && s.includes('wordt verwijderd'))).toBe(
        true,
      );
    });
  });

  // --- Release-PR-tests (#421) ---

  describe('release-PR-opruimen', () => {
    it('sluit een release-PR met een versie lager dan de nieuwste tag', () => {
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
        maakGitOmgeving({
          lokaal: ['main'],
          releasePrJson: JSON.stringify([
            {
              number: 475,
              headRefName: 'release/v1.15.89',
              mergeable: 'MERGEABLE',
              title: 'release: v1.15.89',
            },
          ]),
          laatsteTag: 'v1.15.92',
        }),
      );
      stelUitvoerderIn(uitvoerder);

      opruimen();

      expect(prSluitingen(aanroepen)).toEqual([475]);
      expect(uitvoer.some((s) => s.includes('#475') && s.includes('gesloten'))).toBe(true);
    });

    it('rebased een release-PR op de huidige tag die conflicteert op alleen package.json', () => {
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
        maakGitOmgeving({
          lokaal: ['main'],
          releasePrJson: JSON.stringify([
            {
              number: 480,
              headRefName: 'release/v1.15.92',
              mergeable: 'CONFLICTING',
              title: 'release: v1.15.92',
            },
          ]),
          laatsteTag: 'v1.15.92',
          mergeTree: new Map([
            [
              'release/v1.15.92',
              {
                code: 1,
                stdout: 'abc123abc123abc123abc123abc123abc123abc12345\npackage.json',
              },
            ],
          ]),
        }),
      );
      stelUitvoerderIn(uitvoerder);

      opruimen();

      // Controleer dat er een checkout, rebase en force-push was.
      expect(
        aanroepen.some(
          (a) =>
            a.commando === 'git' &&
            a.argumenten[0] === 'checkout' &&
            a.argumenten[1] === 'release/v1.15.92',
        ),
      ).toBe(true);
      expect(aanroepen.some((a) => a.commando === 'git' && a.argumenten[0] === 'rebase')).toBe(
        true,
      );
      expect(
        aanroepen.some(
          (a) =>
            a.commando === 'git' &&
            a.argumenten[0] === 'push' &&
            a.argumenten.includes('--force-with-lease'),
        ),
      ).toBe(true);
      expect(uitvoer.some((s) => s.includes('#480') && s.includes('gerebased'))).toBe(true);
    });

    it('slaat een release-PR over met conflicten buiten package.json', () => {
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
        maakGitOmgeving({
          lokaal: ['main'],
          releasePrJson: JSON.stringify([
            {
              number: 480,
              headRefName: 'release/v1.15.92',
              mergeable: 'CONFLICTING',
              title: 'release: v1.15.92',
            },
          ]),
          laatsteTag: 'v1.15.92',
          mergeTree: new Map([
            [
              'release/v1.15.92',
              {
                code: 1,
                stdout: 'abc123abc123abc123abc123abc123abc123abc12345\npackage.json\nsrc/cli.ts',
              },
            ],
          ]),
        }),
      );
      stelUitvoerderIn(uitvoerder);

      opruimen();

      // Geen rebase, geen close.
      expect(aanroepen.some((a) => a.commando === 'git' && a.argumenten[0] === 'rebase')).toBe(
        false,
      );
      expect(prSluitingen(aanroepen)).toEqual([]);
      expect(
        uitvoer.some((s) => s.includes('#480') && s.includes('conflicten buiten package.json')),
      ).toBe(true);
    });

    it('--dry sluit geen PR en doet geen rebase', () => {
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
        maakGitOmgeving({
          lokaal: ['main'],
          releasePrJson: JSON.stringify([
            {
              number: 475,
              headRefName: 'release/v1.15.89',
              mergeable: 'MERGEABLE',
              title: 'release: v1.15.89',
            },
            {
              number: 480,
              headRefName: 'release/v1.15.92',
              mergeable: 'CONFLICTING',
              title: 'release: v1.15.92',
            },
          ]),
          laatsteTag: 'v1.15.92',
          mergeTree: new Map([
            [
              'release/v1.15.92',
              {
                code: 1,
                stdout: 'abc123abc123abc123abc123abc123abc123abc12345\npackage.json',
              },
            ],
          ]),
        }),
      );
      stelUitvoerderIn(uitvoerder);

      opruimen({ dry: true });

      expect(prSluitingen(aanroepen)).toEqual([]);
      expect(aanroepen.some((a) => a.commando === 'git' && a.argumenten[0] === 'rebase')).toBe(
        false,
      );
      expect(uitvoer.some((s) => s.includes('#475') && s.includes('wordt gesloten'))).toBe(true);
      expect(uitvoer.some((s) => s.includes('#480') && s.includes('wordt gerebased'))).toBe(true);
    });

    it('laat een release-PR op de huidige versie die mergeable is met rust', () => {
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
        maakGitOmgeving({
          lokaal: ['main'],
          releasePrJson: JSON.stringify([
            {
              number: 480,
              headRefName: 'release/v1.15.92',
              mergeable: 'MERGEABLE',
              title: 'release: v1.15.92',
            },
          ]),
          laatsteTag: 'v1.15.92',
        }),
      );
      stelUitvoerderIn(uitvoerder);

      opruimen();

      expect(prSluitingen(aanroepen)).toEqual([]);
      expect(aanroepen.some((a) => a.commando === 'git' && a.argumenten[0] === 'rebase')).toBe(
        false,
      );
    });
  });

  // --- "Alles schoon"-gedrag ---

  it('meldt "Alles is al schoon." als er niets te doen is', () => {
    const { uitvoerder } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main'],
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen();

    expect(uitvoer.some((s) => s.includes('Alles is al schoon.'))).toBe(true);
  });

  it('meldt niet "Alles is al schoon." als er worktrees verwijderd zijn', () => {
    const { uitvoerder } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main'],
        worktrees: [
          'worktree /repo',
          'HEAD aaa',
          'branch refs/heads/main',
          '',
          'worktree /wt/42',
          'HEAD bbb',
          'branch refs/heads/slice/42-1',
          '',
        ].join('\n'),
        toplevel: '/repo',
        issueStaat: new Map([['42', 'CLOSED']]),
        worktreeStatus: new Map([['/wt/42', '']]),
        worktreeAheadCount: new Map([['/wt/42', '0']]),
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen();

    expect(uitvoer.some((s) => s.includes('Alles is al schoon.'))).toBe(false);
  });

  it('meldt niet "Alles is al schoon." als er release-PR\'s gesloten zijn', () => {
    const { uitvoerder } = maakUitvoerderOpnemer(
      maakGitOmgeving({
        lokaal: ['main'],
        releasePrJson: JSON.stringify([
          {
            number: 475,
            headRefName: 'release/v1.15.89',
            mergeable: 'MERGEABLE',
            title: 'release: v1.15.89',
          },
        ]),
        laatsteTag: 'v1.15.92',
      }),
    );
    stelUitvoerderIn(uitvoerder);

    opruimen();

    expect(uitvoer.some((s) => s.includes('Alles is al schoon.'))).toBe(false);
  });
});
