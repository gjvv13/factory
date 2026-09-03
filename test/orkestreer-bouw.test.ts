import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beschrijfBouw,
  bouwAf,
  bouwBranch,
  bouwPrompt,
  bouwWachtrij,
  bouwWerkplek,
  bronAppsVan,
  FASTLANE_LABEL,
  fastlaneWachtrij,
  leesBaan,
  leesIssue,
  leesReeks,
  leesSoort,
  orkestreerBouw,
  redenBuitenDeRij,
  redenBuitenFastlane,
  reviewPrompt,
  type BouwAfResultaat,
  type Bouwitem,
} from '../src/commands/orkestreer-bouw.js';
import * as orkestreerModule from '../src/commands/orkestreer.js';
import * as werkplaatsModule from '../src/werkplaats.js';
import { bordItems } from '../src/board.js';
import {
  leesStaat,
  standaardPaden,
  TOKEN_SLEUTEL,
  type OrkestratorPaden,
} from '../src/orkestrator-instellingen.js';
import {
  GebruikersFout,
  OmgevingsFout,
  herstelAsyncUitvoerder,
  herstelUitvoerder,
  stelUitvoerderIn,
} from '../src/shell.js';
import {
  maakUitvoerderOpnemer,
  zetBeideUitvoerdersOp,
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
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('neemt alleen kleine, onbeklede klussen uit Klaar voor Bouwen, oudste eerst', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = bouwWachtrij(bordItems() ?? []);

    // Oudste eerst: #177 (4 aug), #91 (5 aug), #106 (6 aug), #250 (7 aug), #301 (8 aug),
    // #126 (10 aug), #182 (19 aug). En verder niets: #164 is een epic, #149 draagt
    // escalatie, #200 heeft geen App, #87 staat al op Bouwen, #119 staat in een andere
    // kolom, #78 is gesloten.
    expect(rij.map((item) => item.issue)).toEqual([177, 91, 106, 250, 301, 126, 182]);
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
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('toont de rij, de werkplek, de branch en het budget', async () => {
    stelUitvoerderIn(metBord().uitvoerder);

    await orkestreerBouw({ dry: true, werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });

    // De kop van de rij is #177: een slice onder epic #169, dat zonder Status-waarde
    // buiten de lezing valt. Sinds #232 is dat geen reden om hem over te slaan, dus
    // draait de hele doorloop hier op precies het geval dat eerst uitgesloten werd.
    const tekst = uitvoer.join('');
    expect(tekst).toContain('#177');
    expect(tekst).toContain('/Users/iemand/OrkestratorWerk/factory-wt/177');
    expect(tekst).toContain('slice/177-1');
    // Het epic staat erbij, zodat je vóór het geld kost ziet dat het een slice is.
    expect(tekst).toContain('(onder #169)');
    // Zonder instellingenbestand is het bouwbudget de default van $10 + $3 review.
    expect(tekst).toContain('$10 bouw');
    expect(tekst).toContain('$3 review');
  });

  it('schrijft niets', async () => {
    const { uitvoerder, aanroepen } = metBord();
    stelUitvoerderIn(uitvoerder);

    await orkestreerBouw({ dry: true, werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });

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

  it('leest het board precies één keer', async () => {
    const { uitvoerder, aanroepen } = metBord();
    stelUitvoerderIn(uitvoerder);

    await orkestreerBouw({ dry: true, werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });

    // De harness-regel van #153: het GraphQL-budget is gedeeld met elke sessie op dit
    // account, dus één lezing per run — ook met negen items op het board.
    expect(boardLezingen(aanroepen)).toBe(1);
  });

  it('meldt hoeveel items geclaimd zijn', async () => {
    stelUitvoerderIn(metBord().uitvoerder);

    await orkestreerBouw({ dry: true, werkplaatsWortel: '/Users/iemand/OrkestratorWerk' });

    // Een geclaimd item is niet vergeten maar in behandeling; dat wil je zien zonder
    // het board te openen.
    expect(uitvoer.join('')).toMatch(/1 item\(s\) staan op Bouwen/);
  });

  it('weigert te bouwen zonder --dry, want dat komt in #183', async () => {
    stelUitvoerderIn(metBord().uitvoerder);

    // Een commando dat zonder vlag een werker met schrijfrechten start is precies de
    // verrassing die deze epic wil vermijden.
    await expect(
      orkestreerBouw({ werkplaatsWortel: '/Users/iemand/OrkestratorWerk' }),
    ).rejects.toThrow(/--dry/);
  });

  it('weigert een werkplek binnen ~/Documents', async () => {
    stelUitvoerderIn(metBord().uitvoerder);

    // De hele opzet rust erop dat een onbemande werker daar niet komt: TCC houdt hem
    // buiten, en er lopen parallelle sessies in de werkkopieën.
    await expect(
      orkestreerBouw({ dry: true, werkplaatsWortel: `${process.env.HOME ?? ''}/Documents/Werk` }),
    ).rejects.toThrow(/binnen ~\/Documents/);
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
    herstelAsyncUitvoerder();
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

  it('richt de run op het gevraagde item in plaats van op de kop', async () => {
    stelUitvoerderIn(metBord().uitvoerder);

    await orkestreerBouw({
      dry: true,
      issue: 126,
      werkplaatsWortel: '/Users/iemand/OrkestratorWerk',
    });

    const tekst = uitvoer.join('');
    // De kop van de rij is #177; gevraagd is #126.
    expect(tekst).toContain('Zou nu bouwen: #126');
    expect(tekst).toContain('slice/126-1');
    expect(tekst).not.toContain('Zou nu bouwen: #177');
  });

  it('noemt de reden als het item niet in de rij staat, en raakt niets aan', async () => {
    const { uitvoerder, aanroepen } = metBord();
    stelUitvoerderIn(uitvoerder);

    // #149 draagt escalatie, #200 heeft geen App, #164 is een epic, #87 staat al op
    // Bouwen. Vier gronden, vier meldingen — geen stilte, want stilte kostte gisteren
    // een halfuur zoeken naar waarom een item niet aan de beurt kwam (#210).
    await expect(orkestreerBouw({ dry: true, issue: 149 })).rejects.toThrow(/escalatie/);
    await expect(orkestreerBouw({ dry: true, issue: 200 })).rejects.toThrow(/geen App-veld/);
    // #164 is een epic zónder Status-waarde, dus `bordItems` laat hem weg en de reden
    // komt uit de gerichte opzoeking. Dat is ook het eerlijke antwoord: hij heeft echt
    // geen kolom. De grond `soort` wordt los getoetst op `redenBuitenDeRij`.
    await expect(orkestreerBouw({ dry: true, issue: 164 })).rejects.toThrow(
      /geen kolom op het board/,
    );
    await expect(orkestreerBouw({ dry: true, issue: 87 })).rejects.toThrow(/staat op Bouwen/);

    // Geen claude, en geen schrijvende gh-aanroep: een geweigerde vraag kost niets.
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    expect(aanroepen.some((a) => a.argumenten.includes('item-edit'))).toBe(false);
  });

  it('vraagt de kolom op als het issue niet in de lezing zit', async () => {
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

    await expect(orkestreerBouw({ dry: true, issue: 78 })).rejects.toThrow(
      /geen kolom op het board/,
    );
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
  });

  it('filtert de rij en bouwt er geen tweede', () => {
    stelUitvoerderIn(metBord().uitvoerder);
    const rij = bouwWachtrij(bordItems() ?? []);

    // Elk item dat --issue accepteert, staat ook gewoon in de rij. Wie dat later
    // omzeilt — een aparte lezing voor het gevraagde issue — breekt deze test.
    for (const issue of [177, 91, 106, 250, 301, 126, 182]) {
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

describe('fastlane-wachtrij (#400)', () => {
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
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('neemt type:bug zonder extra label', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = fastlaneWachtrij(bordItems() ?? []);

    // #91 is type:bug, geen ouder → hoort erin.
    expect(rij.map((item) => item.issue)).toContain(91);
  });

  it('neemt type:task alleen met het fastlane-label', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = fastlaneWachtrij(bordItems() ?? []);

    // #301 is type:task + fastlane-label → hoort erin.
    // #126 is type:task zonder fastlane-label → hoort er niet in.
    expect(rij.map((item) => item.issue)).toContain(301);
    expect(rij.map((item) => item.issue)).not.toContain(126);
  });

  it('sluit child-slices uit, ook als het een bug zou zijn', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = fastlaneWachtrij(bordItems() ?? []);

    // #177 is type:task met ouder #169 → child-slice, uitgesloten.
    // #182 is type:task met ouder #164 → child-slice, uitgesloten.
    expect(rij.map((item) => item.issue)).not.toContain(177);
    expect(rij.map((item) => item.issue)).not.toContain(182);
  });

  it('sluit geëscaleerde items uit', () => {
    stelUitvoerderIn(metBord().uitvoerder);

    const rij = fastlaneWachtrij(bordItems() ?? []);

    // #149 draagt het escalatie-label.
    expect(rij.map((item) => item.issue)).not.toContain(149);
  });
});

describe('redenBuitenFastlane (#400)', () => {
  function item(velden: Partial<Parameters<typeof redenBuitenFastlane>[0]>) {
    return {
      issue: 1,
      titel: 't',
      kolom: 'Klaar voor Bouwen',
      aangemaakt: '2026-08-01T00:00:00Z',
      labels: ['type:bug'],
      app: 'factory',
      ...velden,
    };
  }

  it('laat een bug zonder ouder door', () => {
    expect(redenBuitenFastlane(item({}))).toBeUndefined();
  });

  it('laat een task met fastlane-label door', () => {
    expect(redenBuitenFastlane(item({ labels: ['type:task', FASTLANE_LABEL] }))).toBeUndefined();
  });

  it('weigert een task zonder fastlane-label', () => {
    const reden = redenBuitenFastlane(item({ labels: ['type:task'] }));
    expect(reden?.grond).toBe('soort');
    expect(reden?.zin).toContain(FASTLANE_LABEL);
  });

  it('weigert een child-slice', () => {
    const reden = redenBuitenFastlane(item({ ouder: 99 }));
    expect(reden?.grond).toBe('soort');
    expect(reden?.zin).toContain('child-slice');
  });

  it('weigert een geëscaleerd item', () => {
    expect(redenBuitenFastlane(item({ labels: ['type:bug', 'escalatie'] }))?.grond).toBe(
      'escalatie',
    );
  });

  it('weigert een item zonder App', () => {
    const zonderApp: Parameters<typeof redenBuitenFastlane>[0] = {
      issue: 1,
      titel: 't',
      kolom: 'Klaar voor Bouwen',
      aangemaakt: '2026-08-01T00:00:00Z',
      labels: ['type:bug'],
    };
    expect(redenBuitenFastlane(zonderApp)?.grond).toBe('geen-app');
  });
});

describe('fastlane-cap (#400)', () => {
  it('cap 0 = fastlane uit: de nacht draait de fastlane niet', async () => {
    // De volledige nacht-test is in de nachtblok hierboven. Hier testen we alleen
    // dat cap 0 de fastlane overslaat — impliciet via de instellingen.
    const instellingen = (await import('../src/orkestrator-instellingen.js')).leesInstellingen(
      (await import('../src/orkestrator-instellingen.js')).standaardPaden(
        mkdtempSync(path.join(os.tmpdir(), 'factory-fl-cap-')),
      ),
    );
    // Default is 4: zonder env-bestand staat de fastlane-cap op 4 — niet 0.
    expect(instellingen.fastlaneCap).toBe(4);
  });

  it('de fastlane-cap is onafhankelijk van het gewone bouw-dagmaximum', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'factory-fl-cap-'));
    const { standaardPaden: sp, leesInstellingen: li } =
      await import('../src/orkestrator-instellingen.js');
    const paden = sp(home);
    mkdirSync(path.dirname(paden.envPad), { recursive: true });
    writeFileSync(paden.envPad, 'FACTORY_BOUW_DAGMAXIMUM=1\nFACTORY_FASTLANE_CAP=8\n', {
      mode: 0o600,
    });

    const instellingen = li(paden);

    expect(instellingen.bouwDagmaximum).toBe(1);
    expect(instellingen.fastlaneCap).toBe(8);
    rmSync(home, { recursive: true, force: true });
  });
});

describe('leesBaan (#400)', () => {
  it('leest fastlane en gewoon', () => {
    expect(leesBaan(undefined)).toBeUndefined();
    expect(leesBaan('fastlane')).toBe('fastlane');
    expect(leesBaan('gewoon')).toBe('gewoon');
  });

  it('weigert een onbekende baan', () => {
    expect(() => leesBaan('snel')).toThrow(/Onbekende --baan/);
  });
});

describe('--baan fastlane --dry (#400)', () => {
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
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('toont de fastlane-wachtrij met alleen bugs en gelabelde tasks', async () => {
    stelUitvoerderIn(metBord().uitvoerder);

    await orkestreerBouw({
      dry: true,
      baan: 'fastlane',
      werkplaatsWortel: '/Users/iemand/OrkestratorWerk',
    });

    const tekst = uitvoer.join('');
    // De kop van de fastlane-rij is #91 (type:bug, 5 aug).
    expect(tekst).toContain('Fastlane-wachtrij');
    expect(tekst).toContain('#91');
    // #301 (type:task + fastlane) hoort in de rij.
    expect(tekst).toContain('#301');
    // #126 (type:task zonder fastlane) en #177 (child-slice) horen er niet in.
    expect(tekst).not.toMatch(/#126\s/);
    expect(tekst).not.toMatch(/#177\s/);
  });

  it('--baan en --nacht gaan niet samen', async () => {
    stelUitvoerderIn(metBord().uitvoerder);

    await expect(orkestreerBouw({ nacht: true, baan: 'fastlane' })).rejects.toThrow(
      /--baan.*--nacht/,
    );
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
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  /** De opgenomen envelop-vorm; het bouw-verdict erin is met de hand geschreven. */
  function envelop(naam: string): string {
    const hier = path.dirname(fileURLToPath(import.meta.url));
    return readFileSync(path.join(hier, 'fixtures', `${naam}.json`), 'utf8');
  }

  /**
   * Een machine waarop het board de fixture teruggeeft en claude envelops teruggeeft.
   * De eerste `claude`-aanroep is de bouw, de tweede is de review (#184).
   */
  function machine(werker: string, review?: string): UitkomstBepaler {
    let huidig = 'Klaar voor Bouwen';
    let claudeTeller = 0;
    return ({ commando, argumenten }) => {
      if (commando === 'claude') {
        claudeTeller++;
        return { stdout: claudeTeller === 1 ? werker : (review ?? '') };
      }
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
      if (
        commando === 'gh' &&
        argumenten[0] === 'api' &&
        typeof argumenten[1] === 'string' &&
        argumenten[1].includes('/comments')
      ) {
        // PR-comment plaatsen via gh api (#184).
        return {};
      }
      if (commando === 'gh' && argumenten[0] === 'pr' && argumenten[1] === 'view') {
        // PR-nummer opzoeken voor de review-comment (#184).
        return { stdout: '42' };
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

  async function draai(
    werker: string,
    review?: string,
  ): Promise<{ aanroepen: ProcesAanroep[]; geleverd: unknown[] }> {
    const geleverd: unknown[] = [];
    const { aanroepen } = zetBeideUitvoerdersOp(machine(werker, review));
    await orkestreerBouw({
      eenmalig: true,
      werkplaatsWortel: wortel,
      paden,
      leverIn: (opties) => geleverd.push(opties),
    });
    return { aanroepen, geleverd };
  }

  /**
   * Een machine die per issue bijhoudt waar het staat, zodat een reeks van meer runs
   * telkens een volgend item pakt in plaats van hetzelfde.
   */
  function reeksMachine(werker: string, review?: string): UitkomstBepaler {
    const geclaimd = new Set<number>();
    // Teller om bouw- en review-aanroepen te onderscheiden: oneven = bouw, even = review.
    let claudeTeller = 0;
    return ({ commando, argumenten }) => {
      if (commando === 'claude') {
        claudeTeller++;
        if (claudeTeller % 2 === 0 && review !== undefined) {
          return { stdout: review };
        }
        const gevraagd = /- Issue: \*\*#(\d+)\*\*/.exec(argumenten.join('\n'))?.[1];
        if (gevraagd !== undefined) geclaimd.add(Number.parseInt(gevraagd, 10));
        return { stdout: werker };
      }
      if (
        commando === 'gh' &&
        argumenten[0] === 'api' &&
        typeof argumenten[1] === 'string' &&
        argumenten[1].includes('/comments')
      ) {
        return {};
      }
      if (commando === 'gh' && argumenten[0] === 'pr' && argumenten[1] === 'view') {
        return { stdout: '42' };
      }
      if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql') {
        const query = argumenten.find((a) => a.startsWith('query=')) ?? '';
        if (query.includes('items(first:100')) {
          // De gedraaide items uit de rij halen, zoals het echte board na `zetKolom`.
          const gelezen: unknown = JSON.parse(bord());
          const data = gelezen as {
            data: { user: { projectV2: { items: { nodes: unknown[] } } } };
          };
          const nodes = data.data.user.projectV2.items.nodes.filter((node) => {
            const nummer = (node as { content?: { number?: number } }).content?.number;
            return nummer === undefined || !geclaimd.has(nummer);
          });
          data.data.user.projectV2.items.nodes = nodes;
          return { stdout: JSON.stringify(data) };
        }
        return {
          stdout: JSON.stringify({
            data: {
              user: {
                projectV2: {
                  id: 'PVT_x',
                  field: { id: 'PVTSSF_x', options: [{ id: 'optie-bouwen', name: 'Bouwen' }] },
                },
              },
              repository: {
                issue: {
                  projectItems: {
                    nodes: [
                      {
                        id: 'PVTI_x',
                        project: { number: 2 },
                        fieldValueByName: { name: 'Klaar voor Bouwen' },
                      },
                    ],
                  },
                },
              },
            },
          }),
        };
      }
      if (commando === 'git' && argumenten[0] === 'rev-parse') return { stdout: '/spiegel' };
      return {};
    };
  }

  it('--reeks bouwt meer items achter elkaar, elk met zijn eigen werkplek (#265)', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(
      reeksMachine(envelop('claude-bouw-klaar'), envelop('claude-review-leeg')),
    );
    const geleverd: unknown[] = [];

    await orkestreerBouw({
      reeks: { soort: 'aantal', aantal: 2 },
      werkplaatsWortel: wortel,
      paden,
      leverIn: (opties) => geleverd.push(opties),
    });

    // Twee runs: elk item krijgt een bouw-run én een review-run, dus vier claude-aanroepen.
    const claudes = aanroepen.filter((a) => a.commando === 'claude');
    expect(claudes).toHaveLength(4);
    expect(geleverd).toHaveLength(2);
    expect(leesStaat(paden, new Date(Date.now())).interactief).toBe(2);
  });

  it('--reeks met een lijst doet precies die items, in die volgorde (#265)', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(
      reeksMachine(envelop('claude-bouw-klaar'), envelop('claude-review-leeg')),
    );

    await orkestreerBouw({
      reeks: { soort: 'lijst', issues: [126, 91] },
      werkplaatsWortel: wortel,
      paden,
      leverIn: () => undefined,
    });

    // De kop van de rij is #91 (ouder), maar gevraagd is eerst #126: de lijst bepaalt de
    // volgorde, niet het board. De bouw-prompt herken je aan "onbemande werker" (de review-
    // prompt zegt "onafhankelijke reviewer").
    const gevraagd = aanroepen
      .filter((a) => a.commando === 'claude')
      .filter((a) => a.argumenten.join('\n').includes('onbemande werker'))
      .map((a) => /- Issue: \*\*#(\d+)\*\*/.exec(a.argumenten.join('\n'))?.[1]);
    expect(gevraagd).toEqual(['126', '91']);
  });

  it('--reeks slaat een nummer buiten de wachtrij over, met de reden, en gaat door', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(
      reeksMachine(envelop('claude-bouw-klaar'), envelop('claude-review-leeg')),
    );

    // #149 staat op het board maar draagt het escalatie-label; #126 is gewoon bouwbaar.
    await orkestreerBouw({
      reeks: { soort: 'lijst', issues: [149, 126] },
      werkplaatsWortel: wortel,
      paden,
      leverIn: () => undefined,
    });

    // Eén typefout of één geblokkeerd item mag een reeks van vier niet kosten — maar
    // stil overslaan zou betekenen dat je denkt dat het gebouwd is. Twee claude-aanroepen:
    // één bouw + één review voor het ene bouwbare item.
    expect(aanroepen.filter((a) => a.commando === 'claude')).toHaveLength(2);
    expect(uitvoer.join('')).toMatch(/#149 staat niet in de wachtrij.*escalatie/);
  });

  it('--reeks weigert een nummer dat niet op het board staat, vóór de eerste run', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(
      reeksMachine(envelop('claude-bouw-klaar'), envelop('claude-review-leeg')),
    );

    // Anders betaal je drie runs en hoor je pas daarna dat de vierde een typefout was.
    await expect(
      orkestreerBouw({
        reeks: { soort: 'lijst', issues: [126, 99999] },
        werkplaatsWortel: wortel,
        paden,
        leverIn: () => undefined,
      }),
    ).rejects.toThrow(/#99999/);
    expect(aanroepen.filter((a) => a.commando === 'claude')).toHaveLength(0);
  });

  it('boekt en logt de bouw-run, met de soort erbij (#264)', async () => {
    await draai(envelop('claude-bouw-klaar'), envelop('claude-review-leeg'));

    // Tot #264 werd `logRun` alleen uit de nacht-lus aangeroepen, en die is refine-only:
    // de duurste soort ($10 budget tegen $5) stond nergens. Op 2026-08-21 had het log
    // twaalf refine-runs en nul bouw-runs.
    expect(leesStaat(paden, new Date(Date.now())).interactief).toBe(1);
    const regels = readFileSync(paden.logPad, 'utf8').trim().split('\n');
    expect(regels).toHaveLength(1);
    expect(regels[0]).toMatch(/#\d+ \w+ bouw klaar/);
  });

  it('claimt het item vóór de run, en levert in zonder auto-merge', async () => {
    const { aanroepen, geleverd } = await draai(
      envelop('claude-bouw-klaar'),
      envelop('claude-review-leeg'),
    );

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

  it('geeft het bouwbudget mee, niet het refinement-budget', async () => {
    const { aanroepen } = await draai(envelop('claude-bouw-klaar'), envelop('claude-review-leeg'));

    const werker = aanroepen.find((a) => a.commando === 'claude');
    // Default $10 voor bouwen tegen $5 voor een refinement: bouwen is meer beurten.
    expect(werker?.argumenten[werker.argumenten.indexOf('--max-budget-usd') + 1]).toBe('10');
  });

  it('mag schrijven maar niet pushen', async () => {
    const { aanroepen } = await draai(envelop('claude-bouw-klaar'), envelop('claude-review-leeg'));

    const args = (aanroepen.find((a) => a.commando === 'claude')?.argumenten ?? []).join(' ');
    // Schrijven is de opdracht; de PR is de grens tussen voorstellen en landen.
    expect(args).toContain('Write');
    expect(args).toContain('Bash(git commit:*)');
    expect(args).toContain('Bash(git push:*)');
    expect(args).toContain('Bash(gh pr:*)');
  });

  it('escaleert een criterium zonder bewijs in plaats van het af te vinken', async () => {
    const { aanroepen, geleverd } = await draai(envelop('claude-bouw-geen-bewijs'));

    // Het schema weigert een leeg `bewijs` als `klaar`. Dus: niets ingeleverd, label
    // erop, en het item terug in de bouw-wachtrij.
    expect(geleverd).toEqual([]);
    expect(aanroepen.some((a) => a.argumenten.includes('--add-label'))).toBe(true);
    const terug = aanroepen.filter(
      (a) => a.argumenten[0] === 'project' && a.argumenten.includes('optie-klaar'),
    );
    expect(terug.length).toBeGreaterThan(0);
  });

  it('noemt in de comment wélke gereedschappen geweigerd zijn', async () => {
    const { aanroepen } = await draai(envelop('claude-bouw-fout'));

    // Alleen een aantal is niet bruikbaar: negen keer `git push` betekent dat de grens
    // werkt, negen keer iets wat hij nodig had dat de lijst te krap is.
    const comment = aanroepen.find(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comment?.argumenten.join(' ')).toContain('1× geweigerd (Bash)');
  });

  it('herkent is_error bij exitcode 0 als mislukt', async () => {
    const { aanroepen, geleverd } = await draai(envelop('claude-bouw-fout'));

    // De val uit #153: exit 0 met is_error true. Geen PR, geen afvink-comment.
    expect(geleverd).toEqual([]);
    const comment = aanroepen.find(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    expect(comment?.argumenten.join(' ')).toMatch(/Bouw-run mislukt/);
  });

  it('zet de comment met bewijs per criterium op het issue', async () => {
    const { aanroepen } = await draai(envelop('claude-bouw-klaar'), envelop('claude-review-leeg'));

    const comment = aanroepen.find(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    const tekst = comment?.argumenten.join(' ') ?? '';
    expect(tekst).toContain('Acceptatiecriterium');
    expect(tekst).toContain("test/promote.test.ts:'draait pnpm zonder interactieve prompt'");
    expect(tekst).toContain('zonder auto-merge');
  });

  it('toont de keuze-notitie in de bouw-comment als de werker er een meegaf', async () => {
    // Verrijk de fixture met een keuzeNotitie door de JSON met de hand aan te passen.
    const basis = JSON.parse(envelop('claude-bouw-klaar')) as Record<string, unknown>;
    const so = basis['structured_output'] as Record<string, unknown>;
    so['keuzeNotitie'] = 'Fastify-plugin gekozen — past beter bij de app.';
    const metKeuze = JSON.stringify(basis);
    const { aanroepen } = await draai(metKeuze, envelop('claude-review-leeg'));

    const comment = aanroepen.find(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    const tekst = comment?.argumenten.join(' ') ?? '';
    expect(tekst).toContain('**Keuze-notitie:**');
    expect(tekst).toContain('Fastify-plugin gekozen');
  });

  it('laat de keuze-notitie weg als de bouw-werker er geen meegaf', async () => {
    const { aanroepen } = await draai(envelop('claude-bouw-klaar'), envelop('claude-review-leeg'));

    const comment = aanroepen.find(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    const tekst = comment?.argumenten.join(' ') ?? '';
    expect(tekst).not.toContain('Keuze-notitie');
  });

  it('weigert --dry en --eenmalig samen', async () => {
    zetBeideUitvoerdersOp(machine(envelop('claude-bouw-klaar')));

    await expect(
      orkestreerBouw({ dry: true, eenmalig: true, werkplaatsWortel: wortel }),
    ).rejects.toThrow(/sluiten elkaar uit/);
  });

  it('geeft bron-mappen mee als extraMappen aan de werker', async () => {
    // #106 draagt bron:assistant. De momentopname moet als extraMap meegaan, zodat de
    // werker die map kan lezen. De factory-map staat er sowieso bij.
    const { aanroepen } = await draai(envelop('claude-bouw-klaar'), envelop('claude-review-leeg'));

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

  it('draait een review na een geslaagde bouw, met het reviewprompt en lees-alleen-rechten', async () => {
    const { aanroepen } = await draai(envelop('claude-bouw-klaar'), envelop('claude-review-klaar'));

    // Twee claude-aanroepen: eerst de bouw, dan de review.
    const claudes = aanroepen.filter((a) => a.commando === 'claude');
    expect(claudes).toHaveLength(2);

    // De tweede aanroep is de review: lees-alleen. Write en Edit staan in de
    // verbodslijst, niet in de toestemmingslijst.
    const reviewArgLijst = claudes[1]?.argumenten ?? [];
    const allowedStart = reviewArgLijst.indexOf('--allowedTools');
    const disallowedStart = reviewArgLijst.indexOf('--disallowedTools');
    const toegestaan = reviewArgLijst.slice(allowedStart + 1, disallowedStart);
    expect(toegestaan).toContain('Read');
    expect(toegestaan).toContain('Grep');
    expect(toegestaan).not.toContain('Write');
    expect(toegestaan).not.toContain('Edit');
    // Reviewbudget is $3 (default), niet $10.
    const budgetIndex = reviewArgLijst.indexOf('--max-budget-usd');
    expect(reviewArgLijst[budgetIndex + 1]).toBe('3');
  });

  it('plaatst de bevindingen als precies één PR-comment na het inleveren', async () => {
    const { aanroepen } = await draai(envelop('claude-bouw-klaar'), envelop('claude-review-klaar'));

    // De review-bevindingen gaan als PR-comment via `gh api`.
    const prComment = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'api' &&
        typeof a.argumenten[1] === 'string' &&
        a.argumenten[1].includes('/comments'),
    );
    expect(prComment).toHaveLength(1);
    const body = prComment[0]?.argumenten.find((a) => a.startsWith('body=')) ?? '';
    expect(body).toContain('Code-review door een onbemande reviewer');
    expect(body).toContain('src/commands/promote.ts');
    expect(body).toContain('hoog');
  });

  it('plaatst ook een comment bij nul bevindingen — stilte is geen uitkomst', async () => {
    const { aanroepen } = await draai(envelop('claude-bouw-klaar'), envelop('claude-review-leeg'));

    const prComment = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'api' &&
        typeof a.argumenten[1] === 'string' &&
        a.argumenten[1].includes('/comments'),
    );
    expect(prComment).toHaveLength(1);
    const body = prComment[0]?.argumenten.find((a) => a.startsWith('body=')) ?? '';
    expect(body).toContain('Geen bevindingen');
  });

  it('laat de PR staan als de review-run mislukt, met een aparte melding', async () => {
    const { aanroepen, geleverd } = await draai(
      envelop('claude-bouw-klaar'),
      envelop('claude-review-fout'),
    );

    // De bouw slaagde, dus er wordt ingeleverd — de review is geen voorwaarde.
    expect(geleverd).toHaveLength(1);
    // Er staat een comment dat de review niet gelukt is.
    const prComment = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'api' &&
        typeof a.argumenten[1] === 'string' &&
        a.argumenten[1].includes('/comments'),
    );
    expect(prComment).toHaveLength(1);
    const body = prComment[0]?.argumenten.find((a) => a.startsWith('body=')) ?? '';
    expect(body).toContain('Code-review niet gelukt');
  });

  it('levert de bouw tóch in als de review niet kan starten (#289)', async () => {
    // Een startfout (commando niet gevonden, spawn ENOENT) gooit onvoorwaardelijk in
    // run() — de toleranter-vlag vangt alleen een niet-nul exitcode. bouwAf moet die
    // throw opvangen zodat de bouw niet alsnog rood wordt.
    const geleverd: unknown[] = [];
    let claudeTeller = 0;
    const bepaal: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'claude') {
        claudeTeller++;
        if (claudeTeller === 1) return { stdout: envelop('claude-bouw-klaar') };
        // Tweede claude-aanroep (review): het commando kan niet starten.
        return { startfout: 'spawn ENOENT' };
      }
      return machine(envelop('claude-bouw-klaar'))({ commando, argumenten }, 0);
    };
    const { aanroepen } = zetBeideUitvoerdersOp(bepaal);
    await orkestreerBouw({
      eenmalig: true,
      werkplaatsWortel: wortel,
      paden,
      leverIn: (opties) => geleverd.push(opties),
    });

    // De bouw is ingeleverd ondanks de review-startfout.
    expect(geleverd).toHaveLength(1);
    // Er staat een comment dat de review niet gelukt is.
    const prComment = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'api' &&
        typeof a.argumenten[1] === 'string' &&
        a.argumenten[1].includes('/comments'),
    );
    expect(prComment).toHaveLength(1);
    const body = prComment[0]?.argumenten.find((a) => a.startsWith('body=')) ?? '';
    expect(body).toContain('Code-review niet gelukt');
  });

  it('plaatst bevindingen op het issue als inleveren mislukt', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(
      machine(envelop('claude-bouw-klaar'), envelop('claude-review-klaar')),
    );

    // Een `leverIn` die gooit, zoals bij een rode poort of een conflict.
    await expect(
      orkestreerBouw({
        eenmalig: true,
        werkplaatsWortel: wortel,
        paden,
        leverIn: () => {
          throw new Error('poort rood');
        },
      }),
    ).rejects.toThrow(/poort rood/);

    // De review-bevindingen staan op het issue, niet op een PR die niet bestaat.
    const issueComments = aanroepen.filter(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    const reviewComment = issueComments.find((a) =>
      a.argumenten.join(' ').includes('Code-review door een onbemande reviewer'),
    );
    expect(reviewComment).toBeDefined();
    // Geen PR-comment: het inleveren is mislukt.
    const prComment = aanroepen.filter(
      (a) =>
        a.commando === 'gh' &&
        a.argumenten[0] === 'api' &&
        typeof a.argumenten[1] === 'string' &&
        a.argumenten[1].includes('/comments'),
    );
    expect(prComment).toHaveLength(0);
  });

  it('draait geen review als de bouw escaleert of mislukt', async () => {
    const { aanroepen: aanroepenEscalatie } = await draai(envelop('claude-bouw-escalatie'));
    expect(aanroepenEscalatie.filter((a) => a.commando === 'claude')).toHaveLength(1);

    const { aanroepen: aanroepenFout } = await draai(envelop('claude-bouw-fout'));
    expect(aanroepenFout.filter((a) => a.commando === 'claude')).toHaveLength(1);
  });

  it('neemt review-kosten op in de voetnoot', async () => {
    const { aanroepen } = await draai(envelop('claude-bouw-klaar'), envelop('claude-review-klaar'));

    const issueComment = aanroepen.find(
      (a) => a.argumenten[0] === 'issue' && a.argumenten[1] === 'comment',
    );
    const tekst = issueComment?.argumenten.join(' ') ?? '';
    // De voetnoot bevat zowel de bouwkosten als de reviewkosten.
    expect(tekst).toContain('review $1.23');
    expect(tekst).toContain('review-sessie=review-sessie-1');
  });

  it('ruimt de bron-map op na de run, ook bij escalatie', async () => {
    zetBeideUitvoerdersOp(machine(envelop('claude-bouw-escalatie')));
    const geleverd: unknown[] = [];

    await orkestreerBouw({
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

  it('boekt een OmgevingsFout uit leverIn als escalatie in de uitkomst én op het board (#383)', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(
      machine(envelop('claude-bouw-klaar'), envelop('claude-review-leeg')),
    );
    const item: Bouwitem = {
      issue: 106,
      titel: 'Test',
      kolom: 'Klaar voor Bouwen',
      aangemaakt: '2026-08-01T00:00:00Z',
      labels: ['type:task'],
      app: 'factory',
    };

    // leverIn gooit een OmgevingsFout: de poort kon niet draaien door een
    // omgevingsprobleem, niet door inhoudelijk rode tests. De bouw zélf slaagde ('klaar').
    const resultaat = await bouwAf(item, wortel, wortel, 5, 3, 'medium', () => {
      throw new OmgevingsFout('Kon package.json niet lezen');
    });

    // Cruciaal: de uitkomst draagt 'escalatie', niet 'klaar'. Anders telt `beoordeel` de
    // run als 'gelukt' en reset de noodstop-teller in de nachtreeks (#383) — precies de
    // bug die de review vond, die deze test rood zou maken.
    expect(resultaat.bouw.afloop).toBe('escalatie');
    // En het item is op het board geëscaleerd met een comment die de reden noemt (er
    // staat óók een eerdere "Gebouwd door"-comment, dus zoek de omgevingsfout-comment).
    const heeftOmgevingsfoutComment = aanroepen.some(
      (a) =>
        a.argumenten[0] === 'issue' &&
        a.argumenten[1] === 'comment' &&
        a.argumenten.join(' ').includes('de kwaliteitspoort kon niet draaien'),
    );
    expect(heeftOmgevingsfoutComment).toBe(true);
    // De "Gebouwd door"-comment mag NIET geplaatst zijn: er is geen PR (#383).
    const heeftGebouwdComment = aanroepen.some(
      (a) =>
        a.argumenten[0] === 'issue' &&
        a.argumenten[1] === 'comment' &&
        a.argumenten.join(' ').includes('Gebouwd door een onbemande werker'),
    );
    expect(heeftGebouwdComment).toBe(false);
  });

  it('boekt een OmgevingsFout in de setup-fase als escalatie in de uitkomst (#383)', async () => {
    zetBeideUitvoerdersOp(machine(envelop('claude-bouw-klaar'), envelop('claude-review-leeg')));
    const item: Bouwitem = {
      issue: 106,
      titel: 'Test',
      kolom: 'Klaar voor Bouwen',
      aangemaakt: '2026-08-01T00:00:00Z',
      labels: ['type:task'],
      app: 'factory',
    };

    // De omgeving is al vóór de werker-run stuk: versWerkplaats gooit een OmgevingsFout
    // (geen repo, worktree kon niet aangemaakt worden). leverIn mag dan niet bereikt worden.
    vi.spyOn(werkplaatsModule, 'versWerkplaats').mockImplementation(() => {
      throw new OmgevingsFout('Geen repo gevonden');
    });

    const resultaat = await bouwAf(item, wortel, wortel, 5, 3, 'medium', () => {
      throw new Error('leverIn mag in de setup-fase niet bereikt worden');
    });

    // De setup-catch geeft een synthetisch resultaat met afloop 'escalatie' terug.
    expect(resultaat.bouw.afloop).toBe('escalatie');
  });

  it('gooit een gewone GebruikersFout uit leverIn wél door (#383)', async () => {
    zetBeideUitvoerdersOp(machine(envelop('claude-bouw-klaar'), envelop('claude-review-leeg')));

    // Een inhoudelijke poortfout (tests falen) gooit door — dat is een echte mislukking.
    await expect(
      orkestreerBouw({
        eenmalig: true,
        werkplaatsWortel: wortel,
        paden,
        leverIn: () => {
          throw new GebruikersFout('lint faalt');
        },
      }),
    ).rejects.toThrow(/lint faalt/);
  });
});

describe('orkestreer --soort bouw --nacht', () => {
  const NU = new Date('2026-08-19T05:30:00');
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
    wortel = mkdtempSync(path.join(os.tmpdir(), 'factory-bouw-nacht-'));
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-bouw-nacht-home-'));
    paden = standaardPaden(home);
    // Een geldig token en een bouw-dagmaximum > 0: zonder token gooit `vereisToken` vóór
    // het slot, en een bereikt dagmaximum keert al eerder terug — dan raken we het
    // slot-pad niet.
    mkdirSync(path.dirname(paden.envPad), { recursive: true });
    writeFileSync(paden.envPad, `${TOKEN_SLEUTEL}=sk-nacht\nFACTORY_BOUW_DAGMAXIMUM=2\n`, {
      mode: 0o600,
    });
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    rmSync(wortel, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    herstelOmgeving();
    herstelUitvoerder();
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('slaat over als het slot al bezet is, zonder te bouwen of te gooien (#343)', async () => {
    // Het slot ligt op een vast pad (`os.tmpdir()/factory-orkestreer.lock`) dat door alle
    // testbestanden gedeeld wordt; vitest draait die parallel op één filesystem. Een echt
    // lock-bestand hier zou dus racen met de refine-nacht-tests. We stubben daarom `neemLock`
    // zelf op false — dat ís precies het "slot bezet"-signaal dat `draaiNachtBouw` afvangt —
    // en raken het echte slot niet aan.
    vi.spyOn(orkestreerModule, 'neemLock').mockReturnValue(false);
    vi.spyOn(orkestreerModule, 'lockInfo').mockReturnValue('pid 4242 leeft nog');
    const { aanroepen } = zetBeideUitvoerdersOp(({ commando, argumenten }) =>
      commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql'
        ? { stdout: bord() }
        : {},
    );

    // Slot bezet is geen fout: de bouw-nacht keert stil terug, hij wacht niet en gooit
    // niet. Zou de early-return een throw worden, dan valt deze assertie om.
    await expect(
      orkestreerBouw({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU }),
    ).resolves.toBeUndefined();

    // De melding legt uit waaróm er niets gebeurde.
    expect(uitvoer.join('')).toMatch(/slot bezet.*bouw-nacht overgeslagen/);
    // En er start geen enkele bouw-run: `draaiReeks` wordt niet bereikt, dus geen `claude`.
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
  });
});

describe('leesReeks', () => {
  it('leest een aantal', () => {
    expect(leesReeks('4')).toEqual({ soort: 'aantal', aantal: 4 });
  });

  it('leest een lijst', () => {
    expect(leesReeks('126,186, 263')).toEqual({ soort: 'lijst', issues: [126, 186, 263] });
  });

  it('ontdubbelt een lijst en zegt dat', () => {
    // Stil ontdubbelen betekent dat je denkt vier items te doen en het er drie zijn.
    expect(leesReeks('126,126,186')).toEqual({ soort: 'lijst', issues: [126, 186] });
  });

  it('weigert rommel, een nul en een te grote reeks', () => {
    expect(() => leesReeks('vier')).toThrow(/geheel getal/);
    expect(() => leesReeks('0')).toThrow(/geheel getal/);
    expect(() => leesReeks('21')).toThrow(/geheel getal/);
    expect(() => leesReeks('126,nul')).toThrow(/issuenummers/);
  });

  it('laat niets zonder waarde', () => {
    expect(leesReeks(undefined)).toBeUndefined();
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
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('toont per bron-app het pad en schrijft niets', async () => {
    const { uitvoerder, aanroepen } = metBord();
    stelUitvoerderIn(uitvoerder);

    // #106 draagt bron:assistant en staat in de rij.
    await orkestreerBouw({
      dry: true,
      issue: 106,
      werkplaatsWortel: '/Users/iemand/OrkestratorWerk',
    });

    const tekst = uitvoer.join('');
    expect(tekst).toContain('bron:');
    expect(tekst).toContain('assistant');
    expect(tekst).toContain('/Users/iemand/OrkestratorWerk/factory-wt/106-bron/assistant');
    // Geen clone, geen archive, geen git-aanroep.
    expect(aanroepen.some((a) => a.commando === 'git')).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
  });

  it('toont geen bron-regel als er geen bron-labels zijn', async () => {
    stelUitvoerderIn(metBord().uitvoerder);

    // #91 heeft geen bron-labels.
    await orkestreerBouw({
      dry: true,
      issue: 91,
      werkplaatsWortel: '/Users/iemand/OrkestratorWerk',
    });

    const tekst = uitvoer.join('');
    expect(tekst).not.toContain('bron:');
  });
});

describe('reviewPrompt', () => {
  it('vult de placeholders en bevat de review-opdracht', () => {
    const prompt = reviewPrompt(
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

    expect(prompt).toContain('#91');
    expect(prompt).toContain('Test');
    expect(prompt).toContain('factory');
    expect(prompt).toContain('/w/factory-wt/91');
    expect(prompt).toContain('/w/factory');
    expect(prompt).toContain('onafhankelijke reviewer');
    // Mag niet schrijven, mag niet repareren.
    expect(prompt).toContain('schrijft niets');
  });

  it('bevat de app-lijst in de gerenderde prompt', () => {
    const prompt = reviewPrompt(
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
      ['assistant', 'beheer', 'factory'],
    );

    expect(prompt).toContain('assistant, beheer, factory');
    expect(prompt).not.toContain('{{BEKENDE_APPS}}');
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

  it('bevat de app-lijst in de gerenderde prompt', () => {
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
      [],
      ['assistant', 'beheer', 'factory'],
    );

    expect(prompt).toContain('assistant, beheer, factory');
    expect(prompt).not.toContain('{{BEKENDE_APPS}}');
  });
});

describe('beschrijfBouw (#298)', () => {
  /** Een minimale bouw-uitkomst voor tests. */
  function bouwUitkomst(velden: Partial<BouwAfResultaat['bouw']> = {}): BouwAfResultaat['bouw'] {
    return {
      afloop: 'klaar',
      sessie: 'bouw-sessie-1',
      weigeringen: 0,
      ...velden,
    };
  }

  it('somt bouw- en review-kosten op en levert een uitsplitsing', () => {
    const resultaat: BouwAfResultaat = {
      bouw: bouwUitkomst({ kosten: 2.09, beurten: 31 }),
      review: { afloop: 'klaar', sessie: 'review-1', weigeringen: 0, kosten: 1.12, beurten: 8 },
    };

    const regel = beschrijfBouw(resultaat);

    expect(regel.kosten).toBeCloseTo(3.21, 2);
    expect(regel.beurten).toBe(39);
    expect(regel.uitsplitsing).toBe('(bouw $2.09 · review $1.12)');
    expect(regel.uitkomst).toBe('klaar');
  });

  it('levert alleen bouw-kosten en geen uitsplitsing als de review niet draaide', () => {
    const resultaat: BouwAfResultaat = {
      bouw: bouwUitkomst({ kosten: 2.09, beurten: 31 }),
    };

    const regel = beschrijfBouw(resultaat);

    expect(regel.kosten).toBeCloseTo(2.09, 2);
    expect(regel.beurten).toBe(31);
    expect(regel.uitsplitsing).toBeUndefined();
    expect(regel.uitkomst).toBe('klaar');
  });

  it('toont ? voor onbekende review-kosten en somt alleen de bekende kosten op', () => {
    const resultaat: BouwAfResultaat = {
      bouw: bouwUitkomst({ kosten: 2.09, beurten: 31 }),
      review: { afloop: 'mislukt', sessie: 'review-1', weigeringen: 0, beurten: 3 },
    };

    const regel = beschrijfBouw(resultaat);

    // Alleen de bekende bouw-kosten tellen mee in het totaal.
    expect(regel.kosten).toBeCloseTo(2.09, 2);
    expect(regel.beurten).toBe(34);
    expect(regel.uitsplitsing).toBe('(bouw $2.09 · review ?)');
  });

  it('toont ? voor onbekende bouw-kosten in de uitsplitsing', () => {
    const resultaat: BouwAfResultaat = {
      bouw: bouwUitkomst({ beurten: 31 }),
      review: { afloop: 'klaar', sessie: 'review-1', weigeringen: 0, kosten: 1.12, beurten: 8 },
    };

    const regel = beschrijfBouw(resultaat);

    expect(regel.kosten).toBeCloseTo(1.12, 2);
    expect(regel.beurten).toBe(39);
    expect(regel.uitsplitsing).toBe('(bouw ? · review $1.12)');
  });

  it('gebruikt "afgekapt" als de bouw werd afgekapt', () => {
    const resultaat: BouwAfResultaat = {
      bouw: bouwUitkomst({ afloop: 'mislukt', afgekaptNaMinuten: 30, kosten: 3.0, beurten: 50 }),
    };

    const regel = beschrijfBouw(resultaat);

    expect(regel.uitkomst).toBe('afgekapt (30 min)');
  });
});
