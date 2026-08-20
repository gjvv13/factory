import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bouwBranch,
  bouwWachtrij,
  bouwWerkplek,
  leesSoort,
  orkestreerBouw,
} from '../src/commands/orkestreer-bouw.js';
import { bordItems } from '../src/board.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import {
  maakUitvoerderOpnemer,
  zetBoardOmgeving,
  type ProcesAanroep,
  type UitkomstBepaler,
} from './helpers.js';

/** De opgenomen board-uitvoer met alle randgevallen van de bouw-wachtrij. */
function bord(): string {
  const hier = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(hier, 'fixtures', 'project-items-klaar-voor-bouwen.json'), 'utf8');
}

/** Een uitvoerder die elke board-lezing met de fixture antwoordt. */
function metBord() {
  return maakUitvoerderOpnemer(({ commando, argumenten }) =>
    commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql'
      ? { stdout: bord() }
      : {},
  );
}

function boardLezingen(aanroepen: ProcesAanroep[]): number {
  return aanroepen.filter((a) =>
    a.argumenten.some((arg) => arg.startsWith('query=') && arg.includes('items(first:100')),
  ).length;
}

describe('de bouw-wachtrij', () => {
  let herstelOmgeving: () => void;
  let uitvoer: string[];

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('neemt alleen kleine, onbeklede klussen uit Klaar voor Bouwen, oudste eerst', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = bouwWachtrij(bordItems() ?? []);

    // #91 (bug, 5 aug) vóór #126 (task, 10 aug). En verder niets:
    // #164 is een epic, #182 een slice daaronder, #149 draagt escalatie, #200 heeft geen
    // App, #87 staat al op Bouwen, #119 staat in een andere kolom, #78 is gesloten.
    expect(rij.map((item) => item.issue)).toEqual([91, 126]);
  });

  it('laat een epic en zijn slices staan', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = bouwWachtrij(bordItems() ?? []);

    // Een epic is geen bouwopdracht, en een slice hoort in de volgorde van zijn epic —
    // niet losgepikt omdat hij toevallig vooraan staat.
    expect(rij.map((item) => item.issue)).not.toContain(164);
    expect(rij.map((item) => item.issue)).not.toContain(182);
  });

  it('laat een slice staan waarvan het epic niet eens in de lezing zit', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = bouwWachtrij(bordItems() ?? []);

    // De echte val van 2026-08-20: `bordItems` slaat items zonder Status-waarde over, en
    // #164/#169/#171 hebben die niet. Een filter dat de ouder moet kunnen opzoeken laat
    // hun slices dan gewoon in de bouw-wachtrij staan. #177 hangt hier onder een epic dat
    // niet in de lezing voorkomt en hoort er alsnog uit.
    expect(rij.map((item) => item.issue)).not.toContain(177);
    expect(rij.map((item) => item.issue)).toEqual([91, 126]);
  });

  it('slaat een geëscaleerd item over', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    expect(bouwWachtrij(bordItems() ?? []).map((item) => item.issue)).not.toContain(149);
  });

  it('slaat een item zonder App-veld over, met een melding', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = bouwWachtrij(bordItems() ?? []);

    // Zonder App weet de werker niet welke code hij moet lezen. Stil overslaan zou
    // betekenen dat zo'n item nooit aan de beurt komt zonder dat iemand het merkt.
    expect(rij.map((item) => item.issue)).not.toContain(200);
    expect(uitvoer.join('')).toMatch(/#200 heeft geen App-veld/);
  });

  it('laat een geclaimd item met rust', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    // #87 staat op Bouwen: daar werkt iemand aan, of een werker heeft hem geclaimd.
    expect(bouwWachtrij(bordItems() ?? []).map((item) => item.issue)).not.toContain(87);
  });
});

describe('orkestreer --soort bouw --dry', () => {
  let herstelOmgeving: () => void;
  let uitvoer: string[];

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('toont de rij, de werkplek, de branch en het budget', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    orkestreerBouw({ dry: true, werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });

    const tekst = uitvoer.join('');
    expect(tekst).toContain('#91');
    expect(tekst).toContain('/Users/iemand/OrkestratorWerk/factory-wt/91');
    expect(tekst).toContain('slice/91-1');
    // Zonder instellingenbestand is het bouwbudget de default van $10.
    expect(tekst).toContain('$10');
  });

  it('schrijft niets', () => {
    const { uitvoerder, aanroepen } = metBord();
    stelUitvoerderIn(uitvoerder);

    orkestreerBouw({ dry: true, werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });

    // Geen claude, geen git (dus geen worktree), en geen enkele schrijvende gh-aanroep.
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'git')).toBe(false);
    expect(
      aanroepen.some(
        (a) =>
          a.commando === 'gh' &&
          (a.argumenten[0] === 'project' ||
            a.argumenten[0] === 'issue' ||
            a.argumenten[0] === 'pr'),
      ),
    ).toBe(false);
  });

  it('leest het board precies één keer', () => {
    const { uitvoerder, aanroepen } = metBord();
    stelUitvoerderIn(uitvoerder);

    orkestreerBouw({ dry: true, werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });

    // De harness-regel van #153: het GraphQL-budget is gedeeld met elke sessie op dit
    // account, dus één lezing per run — ook met negen items op het board.
    expect(boardLezingen(aanroepen)).toBe(1);
  });

  it('meldt hoeveel items geclaimd zijn', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    orkestreerBouw({ dry: true, werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });

    // Een geclaimd item is niet vergeten maar in behandeling; dat wil je zien zonder
    // het board te openen.
    expect(uitvoer.join('')).toMatch(/1 item\(s\) staan op Bouwen/);
  });

  it('weigert te bouwen zonder --dry, want dat komt in #183', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    // Een commando dat zonder vlag een werker met schrijfrechten start is precies de
    // verrassing die deze epic wil vermijden.
    expect(() => {
      orkestreerBouw({ werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });
    }).toThrow(/--dry/);
  });

  it('weigert een werkplek binnen ~/Documents', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    // De hele opzet rust erop dat een onbemande werker daar niet komt: TCC houdt hem
    // buiten, en er lopen parallelle sessies in de werkkopieën.
    expect(() => {
      orkestreerBouw({ dry: true, werkplaatsWortel: `${process.env.HOME ?? ''}/Documents/Werk` });
    }).toThrow(/binnen ~\/Documents/);
  });
});

describe('de vorm van een bouwplan', () => {
  it('zet de worktree naast de spiegels, niet erin', () => {
    // `<app>-wt` en niet `<app>`: een worktree mag nooit met een spiegel te verwarren
    // zijn, want de spiegel wordt vóór elke run hard teruggezet op origin/main.
    expect(bouwWerkplek('beheer', 149, '/w')).toBe('/w/beheer-wt/149');
    expect(bouwBranch(149)).toBe('slice/149-1');
  });

  it('houdt refinen de default en weigert een onbekende soort', () => {
    expect(leesSoort(undefined)).toBe('refine');
    expect(leesSoort('refine')).toBe('refine');
    expect(leesSoort('bouw')).toBe('bouw');
    // Stil terugvallen op refinen zou een bouwopdracht in een refinement veranderen.
    expect(() => leesSoort('bouwen')).toThrow(/Onbekende --soort/);
  });
});

describe('orkestreer --soort bouw --eenmalig', () => {
  let herstelOmgeving: () => void;
  let uitvoer: string[];
  let wortel: string;

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    wortel = mkdtempSync(path.join(os.tmpdir(), 'factory-bouw-'));
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    rmSync(wortel, { recursive: true, force: true });
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  /** De opgenomen envelop-vorm; het bouw-verdict erin is met de hand geschreven. */
  function envelop(naam: string): string {
    const hier = path.dirname(fileURLToPath(import.meta.url));
    return readFileSync(path.join(hier, 'fixtures', `${naam}.json`), 'utf8');
  }

  /** Een machine waarop het board de fixture teruggeeft en claude een gegeven envelop. */
  function machine(werker: string): UitkomstBepaler {
    let huidig = 'Klaar voor Bouwen';
    return ({ commando, argumenten }) => {
      if (commando === 'claude') return { stdout: werker };
      if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql') {
        const query = argumenten.find((a) => a.startsWith('query=')) ?? '';
        if (query.includes('items(first:100')) return { stdout: bord() };
        return {
          stdout: JSON.stringify({
            data: {
              user: {
                projectV2: {
                  id: 'PVT_x',
                  field: {
                    id: 'PVTSSF_x',
                    options: [
                      { id: 'optie-bouwen', name: 'Bouwen' },
                      { id: 'optie-klaar', name: 'Klaar voor Bouwen' },
                    ],
                  },
                },
              },
              repository: {
                issue: {
                  projectItems: {
                    nodes: [
                      { id: 'PVTI_x', project: { number: 2 }, fieldValueByName: { name: huidig } },
                    ],
                  },
                },
              },
            },
          }),
        };
      }
      if (commando === 'gh' && argumenten[0] === 'project') {
        const optie = argumenten[argumenten.indexOf('--single-select-option-id') + 1];
        huidig = optie === 'optie-bouwen' ? 'Bouwen' : 'Klaar voor Bouwen';
        return {};
      }
      if (commando === 'git' && argumenten[0] === 'rev-parse') return { stdout: '/spiegel' };
      return {};
    };
  }

  function draai(werker: string): { aanroepen: ProcesAanroep[]; geleverd: unknown[] } {
    const geleverd: unknown[] = [];
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(machine(werker));
    stelUitvoerderIn(uitvoerder);
    orkestreerBouw({
      eenmalig: true,
      werkplaatsWortel: wortel,
      leverIn: (opties) => geleverd.push(opties),
    });
    return { aanroepen, geleverd };
  }

  it('claimt het item vóór de run, en levert in zonder auto-merge', () => {
    const { aanroepen, geleverd } = draai(envelop('claude-bouw-klaar'));

    // De claim gaat vóór alles wat geld kost: twee werkers op één item leveren twee
    // branches op waarvan er één weg moet.
    const claim = aanroepen.findIndex(
      (a) => a.argumenten[0] === 'project' && a.argumenten.includes('optie-bouwen'),
    );
    const werker = aanroepen.findIndex((a) => a.commando === 'claude');
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(claim).toBeLessThan(werker);

    // Inleveren gebeurt met geenAutomerge, en nooit via `gh pr merge --auto`.
    expect(geleverd).toEqual([{ cwd: path.join(wortel, 'factory-wt', '91'), geenAutomerge: true }]);
    expect(
      aanroepen.some((a) => a.argumenten.includes('--auto') || a.argumenten[1] === 'merge'),
    ).toBe(false);
  });

  it('geeft het bouwbudget mee, niet het refinement-budget', () => {
    const { aanroepen } = draai(envelop('claude-bouw-klaar'));

    const werker = aanroepen.find((a) => a.commando === 'claude');
    // Default $10 voor bouwen tegen $5 voor een refinement: bouwen is meer beurten.
    expect(werker?.argumenten[werker.argumenten.indexOf('--max-budget-usd') + 1]).toBe('10');
  });

  it('mag schrijven maar niet pushen', () => {
    const { aanroepen } = draai(envelop('claude-bouw-klaar'));

    const args = (aanroepen.find((a) => a.commando === 'claude')?.argumenten ?? []).join(' ');
    // Schrijven is de opdracht; de PR is de grens tussen voorstellen en landen.
    expect(args).toContain('Write');
    expect(args).toContain('Bash(git commit:*)');
    expect(args).toContain('Bash(git push:*)');
    expect(args).toContain('Bash(gh pr:*)');
  });

  it('escaleert een criterium zonder bewijs in plaats van het af te vinken', () => {
    const { aanroepen, geleverd } = draai(envelop('claude-bouw-geen-bewijs'));

    // Het schema weigert een leeg `bewijs` als `klaar`. Dus: niets ingeleverd, label
    // erop, en het item terug in de bouw-wachtrij.
    expect(geleverd).toEqual([]);
    expect(aanroepen.some((a) => a.argumenten.includes('--add-label'))).toBe(true);
    const terug = aanroepen.filter(
      (a) => a.argumenten[0] === 'project' && a.argumenten.includes('optie-klaar'),
    );
    expect(terug.length).toBeGreaterThan(0);
  });

  it('herkent is_error bij exitcode 0 als mislukt', () => {
    const { aanroepen, geleverd } = draai(envelop('claude-bouw-fout'));

    // De val uit #153: exit 0 met is_error true. Geen PR, geen afvink-comment.
    expect(geleverd).toEqual([]);
    const comment = aanroepen.find(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comment?.argumenten.join(' ')).toMatch(/Bouw-run mislukt/);
  });

  it('zet de comment met bewijs per criterium op het issue', () => {
    const { aanroepen } = draai(envelop('claude-bouw-klaar'));

    const comment = aanroepen.find(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    const tekst = comment?.argumenten.join(' ') ?? '';
    expect(tekst).toContain('Acceptatiecriterium');
    expect(tekst).toContain("test/promote.test.ts:'draait pnpm zonder interactieve prompt'");
    expect(tekst).toContain('zonder auto-merge');
  });

  it('weigert --dry en --eenmalig samen', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(machine(envelop('claude-bouw-klaar'))).uitvoerder);

    expect(() => {
      orkestreerBouw({ dry: true, eenmalig: true, werkplaatsWortel: wortel });
    }).toThrow(/sluiten elkaar uit/);
  });
});
