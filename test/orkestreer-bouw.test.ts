import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bouwBranch,
  bouwPrompt,
  bouwWachtrij,
  bouwWerkplek,
  bronAppsVan,
  leesIssue,
  leesSoort,
  orkestreerBouw,
  redenBuitenDeRij,
  type Bouwitem,
} from '../src/commands/orkestreer-bouw.js';
import { bordItems } from '../src/board.js';
import {
  leesStaat,
  standaardPaden,
  type OrkestratorPaden,
} from '../src/orkestrator-instellingen.js';
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

    // Oudste eerst: #177 (4 aug), #91 (5 aug), #106 (6 aug), #250 (7 aug), #126 (10 aug),
    // #182 (19 aug). En verder niets: #164 is een epic, #149 draagt escalatie, #200 heeft
    // geen App, #87 staat al op Bouwen, #119 staat in een andere kolom, #78 is gesloten.
    expect(rij.map((item) => item.issue)).toEqual([177, 91, 106, 250, 126, 182]);
  });

  it('laat het epic zelf staan, maar neemt zijn slice wel mee', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = bouwWachtrij(bordItems() ?? []);

    // Een epic is geen bouwopdracht: #164 draagt type:epic en staat niet in
    // BOUWBARE_SOORTEN. Zijn slice #182 wél — die staat op Klaar voor Bouwen, en dat is
    // volgens #131 de beslissing die telt.
    expect(rij.map((item) => item.issue)).not.toContain(164);
    expect(rij.map((item) => item.issue)).toContain(182);
  });

  it('neemt een slice mee waarvan het epic niet eens in de lezing zit', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = bouwWachtrij(bordItems() ?? []);

    // #177 hangt onder epic #169, dat niet in de lezing voorkomt: `bordItems` slaat items
    // zonder Status-waarde over. Precies daarom mag de wachtrij niet van de ouder
    // afhangen — dan bepaalt een onvolledige lezing wat er gebouwd wordt (#232). De kolom
    // van het item zelf staat er wél in, en die is genoeg.
    expect(rij.map((item) => item.issue)).toContain(177);
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

    // De kop van de rij is #177: een slice onder epic #169, dat zonder Status-waarde
    // buiten de lezing valt. Sinds #232 is dat geen reden om hem over te slaan, dus
    // draait de hele doorloop hier op precies het geval dat eerst uitgesloten werd.
    const tekst = uitvoer.join('');
    expect(tekst).toContain('#177');
    expect(tekst).toContain('/Users/iemand/OrkestratorWerk/factory-wt/177');
    expect(tekst).toContain('slice/177-1');
    // Het epic staat erbij, zodat je vóór het geld kost ziet dat het een slice is.
    expect(tekst).toContain('(onder #169)');
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

describe('--issue', () => {
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

  it('leest een issuenummer en weigert wat dat niet is', () => {
    expect(leesIssue(undefined)).toBeUndefined();
    expect(leesIssue('238')).toBe(238);
    // Vóór de board-lezing, zodat een typefout geen lezing kost en de melding over de
    // typefout gaat in plaats van over de wachtrij.
    expect(() => leesIssue('abc')).toThrow(/issuenummer/);
    expect(() => leesIssue('0')).toThrow(/issuenummer/);
    expect(() => leesIssue('1.5')).toThrow(/issuenummer/);
  });

  it('richt de run op het gevraagde item in plaats van op de kop', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    orkestreerBouw({ dry: true, issue: 126, werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });

    const tekst = uitvoer.join('');
    // De kop van de rij is #177; gevraagd is #126.
    expect(tekst).toContain('Zou nu bouwen: #126');
    expect(tekst).toContain('slice/126-1');
    expect(tekst).not.toContain('Zou nu bouwen: #177');
  });

  it('noemt de reden als het item niet in de rij staat, en raakt niets aan', () => {
    const { uitvoerder, aanroepen } = metBord();
    stelUitvoerderIn(uitvoerder);

    // #149 draagt escalatie, #200 heeft geen App, #164 is een epic, #87 staat al op
    // Bouwen. Vier gronden, vier meldingen — geen stilte, want stilte kostte gisteren
    // een halfuur zoeken naar waarom een item niet aan de beurt kwam (#210).
    expect(() => {
      orkestreerBouw({ dry: true, issue: 149 });
    }).toThrow(/escalatie/);
    expect(() => {
      orkestreerBouw({ dry: true, issue: 200 });
    }).toThrow(/geen App-veld/);
    // #164 is een epic zónder Status-waarde, dus `bordItems` laat hem weg en de reden
    // komt uit de gerichte opzoeking. Dat is ook het eerlijke antwoord: hij heeft echt
    // geen kolom. De grond `soort` wordt los getoetst op `redenBuitenDeRij`.
    expect(() => {
      orkestreerBouw({ dry: true, issue: 164 });
    }).toThrow(/geen kolom op het board/);
    expect(() => {
      orkestreerBouw({ dry: true, issue: 87 });
    }).toThrow(/staat op Bouwen/);

    // Geen claude, en geen schrijvende gh-aanroep: een geweigerde vraag kost niets.
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    expect(aanroepen.some((a) => a.argumenten.includes('item-edit'))).toBe(false);
  });

  it('vraagt de kolom op als het issue niet in de lezing zit', () => {
    // `bordItems` laat gesloten items en items zonder Status-waarde weg, dus "hij zit
    // niet in de lezing" is daar geen verklaring. Eén gerichte opzoeking maakt het
    // verschil zichtbaar; hij draait alleen op dit foutpad.
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(({ commando, argumenten }) => {
      if (commando !== 'gh' || argumenten[0] !== 'api') return {};
      const query = argumenten.find((arg) => arg.startsWith('query=')) ?? '';
      if (query.includes('items(first:100')) return { stdout: bord() };
      return {
        stdout: JSON.stringify({ data: { user: { projectV2: { items: { nodes: [] } } } } }),
      };
    });
    stelUitvoerderIn(uitvoerder);

    expect(() => {
      orkestreerBouw({ dry: true, issue: 78 });
    }).toThrow(/geen kolom op het board/);
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
  });

  it('filtert de rij en bouwt er geen tweede', () => {
    stelUitvoerderIn(metBord().uitvoerder);
    const rij = bouwWachtrij(bordItems() ?? []);

    // Elk item dat --issue accepteert, staat ook gewoon in de rij. Wie dat later
    // omzeilt — een aparte lezing voor het gevraagde issue — breekt deze test.
    for (const issue of [177, 91, 106, 250, 126, 182]) {
      expect(rij.map((item) => item.issue)).toContain(issue);
    }
  });
});

describe('redenBuitenDeRij', () => {
  function item(velden: Partial<Parameters<typeof redenBuitenDeRij>[0]>) {
    return {
      issue: 1,
      titel: 't',
      kolom: 'Klaar voor Bouwen',
      aangemaakt: '2026-08-01T00:00:00Z',
      labels: ['type:task'],
      app: 'factory',
      ...velden,
    };
  }

  it('geeft geen reden voor een item dat in de rij hoort', () => {
    expect(redenBuitenDeRij(item({}))).toBeUndefined();
  });

  it('geeft per grond een zin die achter "staat niet in de rij:" past', () => {
    // Eén functie voor het filter én voor de melding. Twee plekken die hetzelfde moeten
    // weten drijven uit elkaar — dat is precies wat met het ouder-filter gebeurde (#232).
    expect(redenBuitenDeRij(item({ kolom: 'Technisch refinen' }))).toEqual({
      grond: 'kolom',
      zin: 'het staat op Technisch refinen, niet op Klaar voor Bouwen',
    });
    expect(redenBuitenDeRij(item({ labels: ['type:epic'] }))?.grond).toBe('soort');
    expect(redenBuitenDeRij(item({ labels: ['type:task', 'escalatie'] }))?.grond).toBe('escalatie');
    // Zonder de sleutel, niet met `app: undefined`: exactOptionalPropertyTypes maakt
    // dat onderscheid, en een item zonder App-veld heeft de sleutel simpelweg niet.
    const zonderApp: Parameters<typeof redenBuitenDeRij>[0] = {
      issue: 1,
      titel: 't',
      kolom: 'Klaar voor Bouwen',
      aangemaakt: '2026-08-01T00:00:00Z',
      labels: ['type:task'],
    };
    expect(redenBuitenDeRij(zonderApp)?.grond).toBe('geen-app');
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
  let home: string;
  let paden: OrkestratorPaden;

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    wortel = mkdtempSync(path.join(os.tmpdir(), 'factory-bouw-'));
    // Een eigen home: sinds #264 boekt en logt ook een bouw-run, en die hoort niet in
    // de echte `~/Library/Application Support/factory` van wie de tests draait.
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-bouw-home-'));
    paden = standaardPaden(home);
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    rmSync(wortel, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
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
      paden,
      leverIn: (opties) => geleverd.push(opties),
    });
    return { aanroepen, geleverd };
  }

  it('boekt en logt de bouw-run, met de soort erbij (#264)', () => {
    draai(envelop('claude-bouw-klaar'));

    // Tot #264 werd `logRun` alleen uit de nacht-lus aangeroepen, en die is refine-only:
    // de duurste soort ($10 budget tegen $5) stond nergens. Op 2026-08-21 had het log
    // twaalf refine-runs en nul bouw-runs.
    expect(leesStaat(paden, new Date(Date.now())).gestart).toBe(1);
    const regels = readFileSync(paden.logPad, 'utf8').trim().split('\n');
    expect(regels).toHaveLength(1);
    expect(regels[0]).toMatch(/#\d+ \w+ bouw klaar/);
  });

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
    expect(geleverd).toEqual([
      {
        cwd: path.join(wortel, 'factory-wt', '177'),
        geenAutomerge: true,
        // Zonder titel raadt `gh --fill` er een uit de branchnaam: "slice/177 1".
        titel: '#177 — Slice onder een epic dat geen Status heeft',
      },
    ]);
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

  it('noemt in de comment wélke gereedschappen geweigerd zijn', () => {
    const { aanroepen } = draai(envelop('claude-bouw-fout'));

    // Alleen een aantal is niet bruikbaar: negen keer `git push` betekent dat de grens
    // werkt, negen keer iets wat hij nodig had dat de lijst te krap is.
    const comment = aanroepen.find(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comment?.argumenten.join(' ')).toContain('1× geweigerd (Bash)');
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

  it('geeft bron-mappen mee als extraMappen aan de werker', () => {
    // #106 draagt bron:assistant. De momentopname moet als extraMap meegaan, zodat de
    // werker die map kan lezen. De factory-map staat er sowieso bij.
    const { aanroepen } = draai(envelop('claude-bouw-klaar'));

    // De kop van de rij is #177 (geen bron-labels), dus dit test dat een item zonder
    // bron-labels gewoon draait — de extraMappen bevatten dan alleen de factory-map.
    const claude = aanroepen.find((a) => a.commando === 'claude');
    const args = claude?.argumenten ?? [];
    const addDirs = args.reduce<string[]>((acc, arg, i) => {
      if (arg === '--add-dir') {
        const volgende = args[i + 1];
        if (volgende !== undefined) acc.push(volgende);
      }
      return acc;
    }, []);
    // Tenminste de factory-map als extra leesbare map.
    expect(addDirs.length).toBeGreaterThanOrEqual(1);
  });

  it('ruimt de bron-map op na de run, ook bij escalatie', () => {
    const { uitvoerder } = maakUitvoerderOpnemer(machine(envelop('claude-bouw-escalatie')));
    stelUitvoerderIn(uitvoerder);
    const geleverd: unknown[] = [];

    orkestreerBouw({
      eenmalig: true,
      issue: 106,
      werkplaatsWortel: wortel,
      paden,
      leverIn: (opties) => geleverd.push(opties),
    });

    // Bij een escalatie wordt er niet ingeleverd, maar de bron-map moet wel opgeruimd
    // zijn. Er is een `rmSync` op het bron-pad, dat attesteert de cleanup. Belangrijker:
    // de run gooit niet — de opruiming verhindert geen voortgang.
    expect(geleverd).toEqual([]);
  });
});

describe('bronAppsVan', () => {
  function item(labels: string[], app = 'factory'): Bouwitem {
    return {
      issue: 1,
      titel: 't',
      kolom: 'Klaar voor Bouwen',
      aangemaakt: '2026-08-01T00:00:00Z',
      labels,
      app,
    };
  }

  it('leest bron-apps uit bron:-labels, ontdubbeld', () => {
    expect(bronAppsVan(item(['type:task', 'bron:assistant', 'bron:beheer']))).toEqual([
      'assistant',
      'beheer',
    ]);
    // Dubbelen worden eruit gehaald.
    expect(bronAppsVan(item(['bron:assistant', 'bron:assistant']))).toEqual(['assistant']);
  });

  it('levert een lege lijst als er geen bron-labels zijn', () => {
    expect(bronAppsVan(item(['type:task']))).toEqual([]);
  });

  it('negeert de eigen app met een waarschuwing', () => {
    const uitvoer: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });

    const apps = bronAppsVan(item(['bron:factory'], 'factory'));

    expect(apps).toEqual([]);
    expect(uitvoer.join('')).toMatch(/eigen app/);
    vi.restoreAllMocks();
  });

  it('negeert lege labels na het prefix', () => {
    expect(bronAppsVan(item(['bron:']))).toEqual([]);
  });
});

describe('--dry met bron-labels', () => {
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

  it('toont per bron-app het pad en schrijft niets', () => {
    const { uitvoerder, aanroepen } = metBord();
    stelUitvoerderIn(uitvoerder);

    // #106 draagt bron:assistant en staat in de rij.
    orkestreerBouw({ dry: true, issue: 106, werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });

    const tekst = uitvoer.join('');
    expect(tekst).toContain('bron:');
    expect(tekst).toContain('assistant');
    expect(tekst).toContain('/Users/iemand/OrkestratorWerk/factory-wt/106-bron/assistant');
    // Geen clone, geen archive, geen git-aanroep.
    expect(aanroepen.some((a) => a.commando === 'git')).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
  });

  it('toont geen bron-regel als er geen bron-labels zijn', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    // #91 heeft geen bron-labels.
    orkestreerBouw({ dry: true, issue: 91, werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });

    const tekst = uitvoer.join('');
    expect(tekst).not.toContain('bron:');
  });
});

describe('bouwPrompt met bron-mappen', () => {
  it('noemt de bron-mappen als alleen lezen, wegwerpkopie', () => {
    const prompt = bouwPrompt(
      {
        issue: 106,
        titel: 'Test',
        app: 'factory',
        kolom: 'Klaar voor Bouwen',
        aangemaakt: '',
        labels: [],
      },
      '/w/factory-wt/106',
      '/w/factory',
      ['/w/factory-wt/106-bron/assistant'],
    );

    expect(prompt).toContain('/w/factory-wt/106-bron/assistant');
    expect(prompt).toContain('alleen lezen');
    expect(prompt).toContain('wegwerpkopie');
  });

  it('laat het bron-blok weg als er geen bron-mappen zijn', () => {
    const prompt = bouwPrompt(
      {
        issue: 91,
        titel: 'Test',
        app: 'factory',
        kolom: 'Klaar voor Bouwen',
        aangemaakt: '',
        labels: [],
      },
      '/w/factory-wt/91',
      '/w/factory',
    );

    expect(prompt).not.toContain('wegwerpkopie');
    // Het lege placeholder-restant mag er ook niet staan.
    expect(prompt).not.toContain('{{BRON_MAPPEN}}');
  });
});
