import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/commands/verify.js', () => ({ verify: vi.fn() }));

// Alleen heeftIntegreerAgent stubben; de rest (zorgVoorWachtrijLabel, WACHTRIJ_LABEL)
// blijft echt, zodat de wachtrij-label-aanroep in de tests gewoon plaatsvindt.
vi.mock('../src/commands/integreer.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, heeftIntegreerAgent: vi.fn(() => true) };
});

import { inleveren } from '../src/commands/inleveren.js';
import { heeftIntegreerAgent } from '../src/commands/integreer.js';
import { verify } from '../src/commands/verify.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import {
  maakUitvoerderOpnemer,
  zetBoardOmgeving,
  type ProcesAanroep,
  type UitkomstBepaler,
} from './helpers.js';

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

/** Antwoord van de board-opzoeking: het item staat op Bouwen, doel is Wacht op merge. */
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

/** De gelukkige weg, met een board dat antwoordt. */
const gelukkigMetBoard: UitkomstBepaler = (aanroep, index) => {
  if (aanroep.commando === 'gh' && aanroep.argumenten[0] === 'api') {
    return { stdout: BOARD_ANTWOORD };
  }
  return gelukkig(aanroep, index);
};

function argsVan(aanroepen: ProcesAanroep[], commando: string): string[][] {
  return aanroepen.filter((a) => a.commando === commando).map((a) => a.argumenten);
}

describe('inleveren', () => {
  let oorspronkelijkeCwd: string;
  let herstelOmgeving: () => void;

  beforeEach(() => {
    oorspronkelijkeCwd = process.cwd();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.mocked(verify).mockReset();
    // Default: agent aanwezig, dus geen waarschuwing — dat de bestaande tests niet raakt.
    vi.mocked(heeftIntegreerAgent).mockReturnValue(true);
    // In CI draaien deze tests zélf in een workflow; dan zou de bord-poort alles
    // overslaan. Meet het lokale gedrag, ongeacht waar de test draait.
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  /** Vangt alles op wat inleveren naar stdout schrijft, voor de waarschuwings-tests. */
  function vangStdout(): string[] {
    const regels: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      regels.push(String(tekst));
      return true;
    });
    return regels;
  }

  afterEach(() => {
    herstelOmgeving();
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

  it('neemt de reeks-vermelding op in de PR-body wanneer reeksInfo meegegeven is (#327)', () => {
    process.chdir(maakRepo());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkig);
    stelUitvoerderIn(uitvoerder);

    inleveren({
      titel: '#260 — een wijziging',
      reeksInfo: {
        positie: 3,
        totaal: 5,
        basisBranch: 'slice/250-1',
        basisIssue: 250,
      },
    });

    const prCreate = aanroepen.find((a) => a.commando === 'gh' && a.argumenten[1] === 'create');
    expect(prCreate).toBeDefined();
    const bodyIndex = prCreate!.argumenten.indexOf('--body');
    expect(bodyIndex).toBeGreaterThan(-1);
    const body = prCreate!.argumenten[bodyIndex + 1];
    expect(body).toContain('🔗 Reeks 3/5');
    expect(body).toContain('vertakt van #250');
    expect(body).toContain('slice/250-1');
  });

  it('laat de PR-body ongewijzigd als er geen reeksInfo is', () => {
    process.chdir(maakRepo());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkig);
    stelUitvoerderIn(uitvoerder);

    inleveren({ titel: '#99 — gewone wijziging' });

    const prCreate = aanroepen.find((a) => a.commando === 'gh' && a.argumenten[1] === 'create');
    expect(prCreate).toBeDefined();
    const bodyIndex = prCreate!.argumenten.indexOf('--body');
    expect(bodyIndex).toBeGreaterThan(-1);
    const body = prCreate!.argumenten[bodyIndex + 1];
    expect(body).not.toContain('Reeks');
    expect(body).toContain('Ingeleverd via');
  });

  it('geeft de purge-vlag mee aan de lockfile-install (#87)', () => {
    process.chdir(maakRepo());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkig);
    stelUitvoerderIn(uitvoerder);

    inleveren();

    const installs = aanroepen.filter((a) => a.argumenten.includes('install'));
    expect(installs).toHaveLength(1);
    const install = installs[0];
    expect(install).toBeDefined();
    expect(install!.argumenten).toContain('--config.confirmModulesPurge=false');
    expect(install!.argumenten).toContain('--lockfile-only');
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

  it('hergebruikt een bestaande open PR in plaats van een nieuwe te maken', () => {
    process.chdir(maakRepo());
    const bepaal: UitkomstBepaler = (aanroep) => {
      if (aanroep.commando === 'gh' && aanroep.argumenten[1] === 'view') {
        return { stdout: JSON.stringify({ url: PR_URL, state: 'OPEN' }) };
      }
      return gelukkig(aanroep, 0);
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    inleveren();

    expect(argsVan(aanroepen, 'gh').some((a) => a[1] === 'create')).toBe(false);
    expect(argsVan(aanroepen, 'gh')).toContainEqual(['pr', 'merge', PR_URL, '--auto', '--merge']);
  });

  it('opent een nieuwe PR als de bestaande al gemerged is', () => {
    process.chdir(maakRepo());
    const MERGED_URL = 'https://github.com/gjvv13/factory/pull/268';
    const NIEUWE_URL = 'https://github.com/gjvv13/factory/pull/270';
    const regels = vangStdout();
    const bepaal: UitkomstBepaler = (aanroep) => {
      if (aanroep.commando === 'gh' && aanroep.argumenten[1] === 'view') {
        return { stdout: JSON.stringify({ url: MERGED_URL, state: 'MERGED' }) };
      }
      if (aanroep.commando === 'gh' && aanroep.argumenten[1] === 'create') {
        return { stdout: NIEUWE_URL };
      }
      return gelukkig(aanroep, 0);
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    inleveren();

    // Waarschuwt over de gemergede PR.
    expect(regels.join('')).toContain('al gemerged');
    expect(regels.join('')).toContain(MERGED_URL);
    // Opent een nieuwe PR en zet daar auto-merge op.
    expect(argsVan(aanroepen, 'gh').some((a) => a[1] === 'create')).toBe(true);
    expect(argsVan(aanroepen, 'gh')).toContainEqual([
      'pr',
      'merge',
      NIEUWE_URL,
      '--auto',
      '--merge',
    ]);
  });

  it('faalt met een duidelijke reden als de branch niets nieuws heeft na een gemergede PR', () => {
    process.chdir(maakRepo());
    const MERGED_URL = 'https://github.com/gjvv13/factory/pull/268';
    const bepaal: UitkomstBepaler = (aanroep) => {
      if (aanroep.commando === 'gh' && aanroep.argumenten[1] === 'view') {
        return { stdout: JSON.stringify({ url: MERGED_URL, state: 'MERGED' }) };
      }
      // gh pr create faalt: er is niets nieuws om in te leveren.
      if (aanroep.commando === 'gh' && aanroep.argumenten[1] === 'create') {
        return { code: 1 };
      }
      return gelukkig(aanroep, 0);
    };
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

    expect(() => {
      inleveren();
    }).toThrow(/gemergede PR/);
    expect(() => {
      inleveren();
    }).toThrow(/niets nieuws/);
  });

  it('zet het board niet naar Wacht op merge als er geen open PR is', () => {
    process.chdir(maakRepo());
    const bepaal: UitkomstBepaler = (aanroep) => {
      if (aanroep.commando === 'gh' && aanroep.argumenten[1] === 'view') {
        return { stdout: JSON.stringify({ url: PR_URL, state: 'MERGED' }) };
      }
      if (aanroep.commando === 'gh' && aanroep.argumenten[1] === 'create') {
        return { code: 1 };
      }
      return gelukkigMetBoard(aanroep, 0);
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    expect(() => {
      inleveren();
    }).toThrow();

    // Het board mag niet zijn bijgewerkt: er staat geen open PR.
    expect(argsVan(aanroepen, 'gh').some((a) => a[0] === 'project')).toBe(false);
  });

  it('opent een nieuwe PR als de bestaande gesloten is', () => {
    process.chdir(maakRepo());
    const CLOSED_URL = 'https://github.com/gjvv13/factory/pull/268';
    const NIEUWE_URL = 'https://github.com/gjvv13/factory/pull/270';
    const regels = vangStdout();
    const bepaal: UitkomstBepaler = (aanroep) => {
      if (aanroep.commando === 'gh' && aanroep.argumenten[1] === 'view') {
        return { stdout: JSON.stringify({ url: CLOSED_URL, state: 'CLOSED' }) };
      }
      if (aanroep.commando === 'gh' && aanroep.argumenten[1] === 'create') {
        return { stdout: NIEUWE_URL };
      }
      return gelukkig(aanroep, 0);
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    inleveren();

    expect(regels.join('')).toContain('al gesloten');
    expect(argsVan(aanroepen, 'gh').some((a) => a[1] === 'create')).toBe(true);
    expect(argsVan(aanroepen, 'gh')).toContainEqual([
      'pr',
      'merge',
      NIEUWE_URL,
      '--auto',
      '--merge',
    ]);
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

  it('zet auto-merge aan met --fastlane', () => {
    process.chdir(maakRepo());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkig);
    stelUitvoerderIn(uitvoerder);

    inleveren({ fastlane: true });

    // Auto-merge via de merge-queue, net als de gewone route maar dan als fastlane.
    expect(argsVan(aanroepen, 'gh')).toContainEqual(['pr', 'merge', PR_URL, '--auto', '--merge']);
  });

  it('zet auto-merge aan met --fastlane op een lokale-wachtrij-app', () => {
    process.chdir(maakLokaleRepo());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkig);
    stelUitvoerderIn(uitvoerder);

    inleveren({ fastlane: true });

    // Bij lokale wachtrij: het wachtrij-label, net als de gewone route — het label ís
    // de opdracht om te mergen.
    expect(argsVan(aanroepen, 'gh')).toContainEqual([
      'pr',
      'edit',
      PR_URL,
      '--add-label',
      'wachtrij',
    ]);
    // Geen gh pr merge (dat is voor de merge-queue): de drain doet het.
    expect(argsVan(aanroepen, 'gh').some((a) => a[1] === 'merge')).toBe(false);
  });

  it('geenAutomerge wint van fastlane als beide gezet zijn', () => {
    process.chdir(maakRepo());
    const regels = vangStdout();
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkig);
    stelUitvoerderIn(uitvoerder);

    inleveren({ geenAutomerge: true, fastlane: true });

    // geenAutomerge is de veiligste default en wint.
    expect(argsVan(aanroepen, 'gh').some((a) => a[1] === 'merge')).toBe(false);
    expect(regels.join('')).toContain('zonder auto-merge');
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

  it('waarschuwt als er voor een lokale-wachtrij-app geen integreer-agent is', () => {
    process.chdir(maakLokaleRepo());
    vi.mocked(heeftIntegreerAgent).mockReturnValue(false);
    const regels = vangStdout();
    stelUitvoerderIn(maakUitvoerderOpnemer(gelukkig).uitvoerder);

    inleveren();

    const uitvoer = regels.join('');
    expect(uitvoer).toContain('geen integreer-agent voor proefapp');
    expect(uitvoer).toContain('factory integreer --installeer');
    // De hint noemt het juiste repo, afgeleid uit de PR-url.
    expect(uitvoer).toContain('factory integreer --repo=gjvv13/factory');
    // Bij een ontbrekende agent belooft het niet ten onrechte dat de rij doorloopt.
    expect(uitvoer).not.toContain('integreert slice/58-1 serieel naar main');
  });

  it('waarschuwt niet als de integreer-agent er wél is', () => {
    process.chdir(maakLokaleRepo());
    vi.mocked(heeftIntegreerAgent).mockReturnValue(true);
    const regels = vangStdout();
    stelUitvoerderIn(maakUitvoerderOpnemer(gelukkig).uitvoerder);

    inleveren();

    const uitvoer = regels.join('');
    expect(uitvoer).not.toContain('geen integreer-agent');
    expect(uitvoer).toContain('integreert slice/58-1 serieel naar main');
  });

  it('zet het backlog-item op Wacht op merge en meldt de PR erbij', () => {
    process.chdir(maakRepo());
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkigMetBoard);
    stelUitvoerderIn(uitvoerder);

    inleveren();

    // BRANCH is slice/58-1, dus issue 58 verschuift mee.
    expect(argsVan(aanroepen, 'gh')).toContainEqual([
      'project',
      'item-edit',
      '--id',
      'PVTI_test',
      '--project-id',
      'PVT_test',
      '--field-id',
      'PVTSSF_test',
      '--single-select-option-id',
      'optie-wacht-merge',
    ]);
    const comment = argsVan(aanroepen, 'gh').find((a) => a[0] === 'issue' && a[1] === 'comment');
    expect(comment?.slice(0, 5)).toEqual(['issue', 'comment', '58', '--repo', 'gjvv13/factory']);
    expect(comment?.[6]).toContain(PR_URL);
  });

  it('raakt het board niet aan vanaf een branch zonder slice-vorm', () => {
    process.chdir(maakRepo());
    const bepaal: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'git' && aanroep.argumenten[0] === 'rev-parse'
        ? { stdout: 'fix/losse-hotfix' }
        : gelukkigMetBoard(aanroep, index);
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    inleveren();

    // Geen opzoeking, geen verplaatsing, geen comment — en ook geen fout.
    expect(argsVan(aanroepen, 'gh').some((a) => a[0] === 'api' || a[0] === 'project')).toBe(false);
    expect(argsVan(aanroepen, 'gh').some((a) => a[0] === 'issue')).toBe(false);
  });

  it('levert gewoon in als het board niet bijgewerkt kan worden', () => {
    process.chdir(maakRepo());
    const regels = vangStdout();
    const bepaal: UitkomstBepaler = (aanroep, index) => {
      if (aanroep.commando === 'gh' && aanroep.argumenten[0] === 'api') return { code: 1 };
      return gelukkig(aanroep, index);
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    // Geen throw: de PR is het product, de administratie is bijvangst.
    inleveren();

    expect(argsVan(aanroepen, 'gh')).toContainEqual(['pr', 'merge', PR_URL, '--auto', '--merge']);
    expect(regels.join('')).toContain('kon #58 niet op het board');
  });

  describe('basislijn committen vóór de schoon-check', () => {
    it('committeert een vuile dekking-basislijn en gaat door met verify', () => {
      const repo = maakRepo();
      writeFileSync(path.join(repo, 'dekking-basislijn.json'), '{}');
      process.chdir(repo);

      // Stateful: de globale schoon-check ziet de basislijn als vuil zolang hij
      // niet gecommit is. Zonder de pre-check-commit zou inleveren hier falen.
      let basislijnGecommit = false;
      const bepaal: UitkomstBepaler = (aanroep, index) => {
        if (
          aanroep.commando === 'git' &&
          aanroep.argumenten[0] === 'commit' &&
          aanroep.argumenten[3] === 'verhoog dekking-basislijn'
        ) {
          basislijnGecommit = true;
          return {};
        }
        if (
          aanroep.commando === 'git' &&
          aanroep.argumenten[0] === 'status' &&
          aanroep.argumenten[2] === 'dekking-basislijn.json'
        ) {
          return { stdout: ' M dekking-basislijn.json' };
        }
        if (
          aanroep.commando === 'git' &&
          aanroep.argumenten[0] === 'status' &&
          aanroep.argumenten.length === 2
        ) {
          return basislijnGecommit ? { stdout: '' } : { stdout: ' M dekking-basislijn.json' };
        }
        return gelukkig(aanroep, index);
      };
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
      stelUitvoerderIn(uitvoerder);

      inleveren();

      expect(argsVan(aanroepen, 'git')).toContainEqual(['add', 'dekking-basislijn.json']);
      expect(argsVan(aanroepen, 'git')).toContainEqual([
        'commit',
        '-q',
        '-m',
        'verhoog dekking-basislijn',
      ]);
      expect(verify).toHaveBeenCalledTimes(1);
    });

    it('slaat over als de basislijn niet vuil is', () => {
      const repo = maakRepo();
      writeFileSync(path.join(repo, 'dekking-basislijn.json'), '{}');
      process.chdir(repo);
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkig);
      stelUitvoerderIn(uitvoerder);

      inleveren();

      // Geen commit voor de basislijn: de gelukkig-bepaler geeft lege stdout
      // voor elke git-status, dus commitAlsGewijzigd slaat terecht over.
      const basislijnCommits = argsVan(aanroepen, 'git').filter(
        (a) => a[0] === 'commit' && a[3] === 'verhoog dekking-basislijn',
      );
      expect(basislijnCommits).toHaveLength(0);
      expect(verify).toHaveBeenCalledTimes(1);
    });

    it('slaat over als dekking-basislijn.json niet bestaat', () => {
      process.chdir(maakRepo());
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(gelukkig);
      stelUitvoerderIn(uitvoerder);

      inleveren();

      // Geen git-status voor de basislijn: existsSync sloeg al over.
      const basislijnChecks = aanroepen.filter(
        (a) => a.commando === 'git' && a.argumenten[2] === 'dekking-basislijn.json',
      );
      expect(basislijnChecks).toHaveLength(0);
      expect(verify).toHaveBeenCalledTimes(1);
    });

    it('laat de schoon-check falen bij een ander vuil bestand', () => {
      const repo = maakRepo();
      writeFileSync(path.join(repo, 'dekking-basislijn.json'), '{}');
      process.chdir(repo);
      const bepaal: UitkomstBepaler = (aanroep, index) => {
        // Basislijn is schoon.
        if (
          aanroep.commando === 'git' &&
          aanroep.argumenten[0] === 'status' &&
          aanroep.argumenten[2] === 'dekking-basislijn.json'
        ) {
          return { stdout: '' };
        }
        // Globale schoon-check: een ander bestand is vuil.
        if (
          aanroep.commando === 'git' &&
          aanroep.argumenten[0] === 'status' &&
          aanroep.argumenten.length === 2
        ) {
          return { stdout: ' M app/src/foo.ts' };
        }
        return gelukkig(aanroep, index);
      };
      stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

      expect(() => {
        inleveren();
      }).toThrow(/niet schoon/);
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe('conflict met main', () => {
    /** Zoals git het meldt: tree-oid, botsende bestanden, lege regel, dan de meldingen. */
    const CONFLICT_UITVOER = ['92d6da3', 'src/cli.ts', 'README.md', '', 'CONFLICT (content)'].join(
      '\n',
    );

    /** Laat `merge-tree` een conflict melden; de rest blijft de gelukkige weg. */
    const botst: UitkomstBepaler = (aanroep, index) =>
      aanroep.argumenten[0] === 'merge-tree'
        ? { code: 1, stdout: CONFLICT_UITVOER }
        : gelukkig(aanroep, index);

    it('toont de rebase-stap en draait de poort niet', () => {
      process.chdir(maakRepo());
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(botst);
      stelUitvoerderIn(uitvoerder);

      // Eén regel die zegt wat je moet doen, in plaats van een halfuur poort draaien
      // en dan pas in de merge-queue horen dat het niet past.
      expect(() => {
        inleveren();
      }).toThrow(/git rebase origin\/main/);

      expect(verify).not.toHaveBeenCalled();
      expect(argsVan(aanroepen, 'git').some((a) => a[0] === 'push')).toBe(false);
    });

    it('noemt de bestanden die botsen', () => {
      process.chdir(maakRepo());
      stelUitvoerderIn(maakUitvoerderOpnemer(botst).uitvoerder);

      // De regels ná de tree-oid tot de lege regel zijn de bestanden; zonder die knip
      // zou de melding de oid en de CONFLICT-tekst als "bestand" opsommen.
      expect(() => {
        inleveren();
      }).toThrow(/src\/cli\.ts, README\.md/);
    });

    it('noemt ook het laatste bestand als het meldingenblok ontbreekt', () => {
      process.chdir(maakRepo());
      // Zonder lege scheidingsregel geeft indexOf('') -1, en slice(0, -1) zou dan
      // stilletjes het laatste botsende bestand weglaten.
      const bepaal: UitkomstBepaler = (aanroep, index) =>
        aanroep.argumenten[0] === 'merge-tree'
          ? { code: 1, stdout: ['92d6da3', 'src/cli.ts', 'README.md'].join('\n') }
          : gelukkig(aanroep, index);
      stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

      expect(() => {
        inleveren();
      }).toThrow(/src\/cli\.ts, README\.md/);
    });

    it('stuurt bij een lockfile-conflict naar regenereren, niet naar handmatig mergen', () => {
      process.chdir(maakRepo());
      // pnpm-lock.yaml botst het vaakst en is het gevaarlijkst om met de hand te
      // mergen: het resultaat klopt niet meer met package.json en CI valt om op
      // --frozen-lockfile.
      const bepaal: UitkomstBepaler = (aanroep, index) =>
        aanroep.argumenten[0] === 'merge-tree'
          ? { code: 1, stdout: ['92d6da3', 'pnpm-lock.yaml', '', 'CONFLICT'].join('\n') }
          : gelukkig(aanroep, index);
      stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

      expect(() => {
        inleveren();
      }).toThrow(/pnpm install --lockfile-only/);
    });

    it('lost een conflict dat alleen in dist/ zit zelf op: rebase, opnieuw bouwen, door', () => {
      process.chdir(maakRepo());
      // dist/ is gegenereerde uitvoer en staat in versiebeheer; twee branches die src/
      // raken botsen daar altijd in de sourcemaps. Er valt niets met de hand te mergen.
      const distConflict = ['92d6da3', 'dist/cli.js', 'dist/cli.js.map', '', 'CONFLICT'].join('\n');
      const bepaal: UitkomstBepaler = (aanroep, index) => {
        if (aanroep.argumenten[0] === 'merge-tree') return { code: 1, stdout: distConflict };
        if (aanroep.argumenten[0] === 'rebase' && aanroep.argumenten[1] === 'origin/main')
          return { code: 1, stdout: '' };
        if (aanroep.argumenten[0] === 'diff' && aanroep.argumenten.includes('--diff-filter=U'))
          return { stdout: 'dist/cli.js\ndist/cli.js.map' };
        return gelukkig(aanroep, index);
      };
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
      stelUitvoerderIn(uitvoerder);

      inleveren();

      // Opnieuw gebouwd, gerebased, en daarna gewoon de gelukkige weg: poort, push, PR.
      expect(argsVan(aanroepen, 'pnpm').some((a) => a.includes('build'))).toBe(true);
      expect(argsVan(aanroepen, 'git')).toContainEqual(['add', 'dist']);
      expect(
        argsVan(aanroepen, 'git').some((a) => a[0] === 'rebase' && a[1] === '--continue'),
      ).toBe(true);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(argsVan(aanroepen, 'git').some((a) => a[0] === 'push')).toBe(true);
    });

    it('rebaset niet zelf als er ook een bestand buiten dist/ botst', () => {
      process.chdir(maakRepo());
      // Eén src-bestand ertussen betekent dat een mens moet kijken; een build zou dat
      // conflict verbergen in plaats van oplossen.
      const gemengd = ['92d6da3', 'dist/cli.js', 'src/cli.ts', '', 'CONFLICT'].join('\n');
      const bepaal: UitkomstBepaler = (aanroep, index) =>
        aanroep.argumenten[0] === 'merge-tree'
          ? { code: 1, stdout: gemengd }
          : gelukkig(aanroep, index);
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
      stelUitvoerderIn(uitvoerder);

      expect(() => {
        inleveren();
      }).toThrow(/git rebase origin\/main/);
      expect(argsVan(aanroepen, 'git').some((a) => a[0] === 'rebase')).toBe(false);
      expect(verify).not.toHaveBeenCalled();
    });

    it('valt terug op de melding als de rebase een echt conflict buiten dist/ blootlegt', () => {
      process.chdir(maakRepo());
      // De merge-tree-preview zag alleen dist/, maar de echte rebase legt een src-conflict
      // bloot. Dan draaien we de rebase terug en laten we het aan de mens.
      const bepaal: UitkomstBepaler = (aanroep, index) => {
        if (aanroep.argumenten[0] === 'merge-tree')
          return { code: 1, stdout: ['92d6da3', 'dist/cli.js', '', 'CONFLICT'].join('\n') };
        if (aanroep.argumenten[0] === 'rebase' && aanroep.argumenten[1] === 'origin/main')
          return { code: 1, stdout: '' };
        if (aanroep.argumenten[0] === 'diff' && aanroep.argumenten.includes('--diff-filter=U'))
          return { stdout: 'src/cli.ts' };
        return gelukkig(aanroep, index);
      };
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
      stelUitvoerderIn(uitvoerder);

      expect(() => {
        inleveren();
      }).toThrow(/git rebase origin\/main/);
      // De rebase is teruggedraaid; er is niet gepusht.
      expect(argsVan(aanroepen, 'git')).toContainEqual(['rebase', '--abort']);
      expect(argsVan(aanroepen, 'git').some((a) => a[0] === 'push')).toBe(false);
    });

    it('blokkeert niet als merge-tree zelf faalt', () => {
      process.chdir(maakRepo());
      // Exitcode 1 betekent óók "kon die refs niet mergen" (geen origin/main bijv.).
      // Dan is stdout leeg, en dat is het enige verschil met een echt conflict.
      const bepaal: UitkomstBepaler = (aanroep, index) =>
        aanroep.argumenten[0] === 'merge-tree' ? { code: 1, stdout: '' } : gelukkig(aanroep, index);
      stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

      inleveren();

      expect(verify).toHaveBeenCalledTimes(1);
    });
  });

  describe('de werkplek opruimen', () => {
    /** Een echte hoofdkloon met een echte werkplek ernaast; ruimOp doet existsSync. */
    function maakWerkplek(): { wortel: string; werkplek: string } {
      const werkruimte = mkdtempSync(path.join(os.tmpdir(), 'factory-wt-'));
      const wortel = path.join(werkruimte, 'proefrepo');
      const werkplek = path.join(werkruimte, 'proefrepo-wt', '58');
      mkdirSync(wortel, { recursive: true });
      mkdirSync(werkplek, { recursive: true });
      writeFileSync(path.join(werkplek, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
      return { wortel, werkplek };
    }

    /**
     * Antwoordt op de rev-parse-vragen zoals git dat in een aangehaakte worktree doet:
     * één gecombineerde vraag (git-dir, git-common-dir, toplevel) en de losse vraag naar
     * de hoofdkloon. In een worktree wijst git-dir naar `.git/worktrees/<naam>`.
     */
    function inWerkplek(wortel: string, werkplek: string): UitkomstBepaler {
      return (aanroep, index) => {
        if (aanroep.argumenten.includes('--show-toplevel')) {
          return {
            stdout: [`${wortel}/.git/worktrees/58`, `${wortel}/.git`, werkplek].join('\n'),
          };
        }
        if (aanroep.argumenten.includes('--git-common-dir')) return { stdout: `${wortel}/.git` };
        return gelukkig(aanroep, index);
      };
    }

    it('haalt de werkplek weg nadat de PR er staat', () => {
      const { wortel, werkplek } = maakWerkplek();
      process.chdir(werkplek);
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(inWerkplek(wortel, werkplek));
      stelUitvoerderIn(uitvoerder);

      inleveren();

      // Vanuit de hoofdkloon opruimen: git kan de map niet weghalen als het daarvoor
      // in diezelfde map moet staan.
      const opruimen = aanroepen.find((a) => a.argumenten[0] === 'worktree');
      expect(opruimen?.argumenten).toEqual(['worktree', 'remove', werkplek]);
      expect(opruimen?.cwd).toBe(wortel);
    });

    it('ruimt pas op nadat de PR is aangemaakt', () => {
      const { wortel, werkplek } = maakWerkplek();
      process.chdir(werkplek);
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(inWerkplek(wortel, werkplek));
      stelUitvoerderIn(uitvoerder);

      inleveren();

      // Andersom zou alles ná het opruimen op een verdwenen cwd stuklopen — de PR,
      // de merge-queue en het bijwerken van het board draaien immers in de werkmap.
      const pr = aanroepen.findIndex((a) => a.commando === 'gh' && a.argumenten[1] === 'create');
      const op = aanroepen.findIndex((a) => a.argumenten[0] === 'worktree');
      expect(pr).toBeGreaterThanOrEqual(0);
      expect(op).toBeGreaterThan(pr);
    });

    it('laat de werkplek staan als er nog ongecommit werk in zit', () => {
      const { wortel, werkplek } = maakWerkplek();
      process.chdir(werkplek);
      const regels = vangStdout();
      // git weigert `worktree remove` zonder --force bij vuil werk; die weigering is
      // de bescherming, en zijn reden hoort in de melding te staan.
      const bepaal: UitkomstBepaler = (aanroep, index) =>
        aanroep.argumenten[0] === 'worktree'
          ? { code: 1, stderr: 'fatal: contains modified or untracked files, use --force' }
          : inWerkplek(wortel, werkplek)(aanroep, index);
      stelUitvoerderIn(maakUitvoerderOpnemer(bepaal).uitvoerder);

      inleveren();

      expect(regels.join('')).toMatch(/blijft staan/);
      expect(regels.join('')).toContain('modified or untracked files');
      // Niet beweren dat de map weg is als git 'm heeft laten staan.
      expect(regels.join('')).not.toContain('ga verder in');
      expect(existsSync(werkplek)).toBe(true);
    });

    /** Een kloon met git-dir == git-common-dir: dát is wat "geen worktree" betekent. */
    function inKloon(repo: string, gitDir: string): UitkomstBepaler {
      return (aanroep, index) => {
        if (aanroep.argumenten.includes('--show-toplevel')) {
          return { stdout: [gitDir, gitDir, repo].join('\n') };
        }
        if (aanroep.argumenten.includes('--git-common-dir')) return { stdout: gitDir };
        return gelukkig(aanroep, index);
      };
    }

    it('raakt een gewone kloon niet aan', () => {
      const repo = maakRepo();
      process.chdir(repo);
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(inKloon(repo, `${repo}/.git`));
      stelUitvoerderIn(uitvoerder);

      inleveren();

      expect(aanroepen.some((a) => a.argumenten[0] === 'worktree')).toBe(false);
    });

    it('raakt een kloon met een losse git-map ook niet aan', () => {
      const repo = maakRepo();
      process.chdir(repo);
      // `git clone --separate-git-dir` (of een repo als submodule): de git-map ligt
      // buiten de werkmap. Dat lijkt op een worktree als je naar de paden kijkt, maar
      // git-dir en git-common-dir zijn hier gelijk — het is gewoon de hoofdkloon.
      const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(
        inKloon(repo, '/elders/gitmappen/proefrepo'),
      );
      stelUitvoerderIn(uitvoerder);

      inleveren();

      expect(aanroepen.some((a) => a.argumenten[0] === 'worktree')).toBe(false);
    });
  });
});
