import { closeSync, existsSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  escalatieComment,
  leesEscalatie,
  orkestreer,
  orkestreerAntwoord,
  orkestreerStatus,
} from '../src/commands/orkestreer.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import {
  maakUitvoerderOpnemer,
  zetBoardOmgeving,
  type ProcesAanroep,
  type UitkomstBepaler,
} from './helpers.js';

const LOCK_PAD = path.join(os.tmpdir(), 'factory-orkestreer.lock');

/** Eén item zoals het board het teruggeeft. */
function boardItem(
  nummer: number,
  app: string | null,
  kolom: string,
  aangemaakt: string,
  staat = 'OPEN',
): unknown {
  return {
    status: { name: kolom },
    app: app === null ? null : { name: app },
    content: {
      number: nummer,
      title: `titel ${String(nummer)}`,
      state: staat,
      createdAt: aangemaakt,
    },
  };
}

function boardAntwoord(items: unknown[]): string {
  return JSON.stringify({
    data: { user: { projectV2: { items: { pageInfo: { hasNextPage: false }, nodes: items } } } },
  });
}

/**
 * Het antwoord waarmee `zetKolom` zijn ids vindt. `huidig` verandert mee: `zetKolom`
 * slaat een verplaatsing over als het item al in de doelkolom staat, dus een vast
 * antwoord zou de tweede verplaatsing onzichtbaar maken.
 */
function doelwitAntwoord(huidig: string): string {
  return JSON.stringify({
    data: {
      user: {
        projectV2: {
          id: 'PVT_x',
          field: {
            id: 'PVTSSF_x',
            options: [
              { id: 'optie-wachtrij', name: 'Klaar voor technische refinement' },
              { id: 'optie-technisch', name: 'Technisch refinen' },
              { id: 'optie-bouwen', name: 'Klaar voor Bouwen' },
            ],
          },
        },
      },
      repository: {
        issue: {
          projectItems: {
            nodes: [{ id: 'PVTI_x', project: { number: 2 }, fieldValueByName: { name: huidig } }],
          },
        },
      },
    },
  });
}

/** Een geslaagde werker-envelop met een verdict. */
function werkerKlaar(): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: '5ad6e642-9e2a-4b4b-8af0-ecf40f956335',
    num_turns: 12,
    total_cost_usd: 1.25,
    result: 'zie verdict',
    structured_output: {
      uitkomst: 'klaar',
      samenvatting: 'Premisse getoetst, drie slices.',
      slices: 3,
      body: '# Nieuwe uitwerking\n\nDit is de body.',
    },
    permission_denials: [],
  });
}

/** Een werker die een vraag stelt in plaats van een uitwerking te leveren. */
function werkerEscaleert(): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: '5ad6e642-9e2a-4b4b-8af0-ecf40f956335',
    num_turns: 7,
    total_cost_usd: 1.1,
    result: 'zie verdict',
    structured_output: {
      uitkomst: 'escalatie',
      vraag: 'WASM of native crypto-SDK?',
      advies: 'WASM — geen native compilatie in de bouw.',
    },
    permission_denials: [],
  });
}

/** Een mislukte werker-envelop: `is_error: true` bij exitcode 0 — de echte val. */
function werkerMislukt(): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: true,
    session_id: '5ad6e642-9e2a-4b4b-8af0-ecf40f956335',
    num_turns: 1,
    total_cost_usd: 0.1,
    result: 'API Error: 400 iets kapots',
    terminal_reason: 'api_error',
  });
}

const WACHTRIJ = [
  boardItem(119, 'assistant', 'Klaar voor technische refinement', '2026-08-18T20:24:09Z'),
  boardItem(51, 'assistant', 'Klaar voor technische refinement', '2026-08-09T19:11:45Z'),
  boardItem(131, 'factory', 'Klaar voor technische refinement', '2026-08-19T13:02:16Z'),
  boardItem(77, 'beheer', 'Bouwen', '2026-08-01T10:00:00Z'),
  boardItem(78, 'beheer', 'Klaar voor technische refinement', '2026-08-02T10:00:00Z', 'CLOSED'),
];

/** De gelukkige weg: board vult zich, geen escalaties, werker levert een verdict. */
function bepaler(
  opties: { board?: unknown[]; escalaties?: string; werker?: string } = {},
): UitkomstBepaler {
  // Het board onthoudt waar het item staat, zodat `zetKolom` zich net zo gedraagt als
  // in het echt: hij verplaatst alleen als de kolom écht verandert.
  let huidig = 'Klaar voor technische refinement';
  return ({ commando, argumenten }) => {
    if (commando === 'claude') return { stdout: opties.werker ?? werkerKlaar() };
    if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql') {
      const query = argumenten.find((a) => a.startsWith('query=')) ?? '';
      if (query.includes('items(first:100'))
        return { stdout: boardAntwoord(opties.board ?? WACHTRIJ) };
      return { stdout: doelwitAntwoord(huidig) };
    }
    if (commando === 'gh' && argumenten[0] === 'project') {
      const optie = argumenten[argumenten.indexOf('--single-select-option-id') + 1];
      huidig =
        optie === 'optie-technisch' ? 'Technisch refinen' : 'Klaar voor technische refinement';
      return {};
    }
    if (commando === 'gh' && argumenten[0] === 'api') return { stdout: opties.escalaties ?? '' };
    return {};
  };
}

function ghArgs(aanroepen: ProcesAanroep[]): string[][] {
  return aanroepen.filter((a) => a.commando === 'gh').map((a) => a.argumenten);
}

/** Hoeveel keer de dure board-query gedaan is. */
function boardLezingen(aanroepen: ProcesAanroep[]): number {
  return aanroepen.filter((a) =>
    a.argumenten.some((arg) => arg.startsWith('query=') && arg.includes('items(first:100')),
  ).length;
}

describe('orkestreer', () => {
  let uitvoer: string[];
  let wortel: string;
  let herstelOmgeving: () => void;

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    wortel = mkdtempSync(path.join(os.tmpdir(), 'factory-ork-'));
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
    rmSync(LOCK_PAD, { force: true });
  });

  afterEach(() => {
    rmSync(wortel, { recursive: true, force: true });
    rmSync(LOCK_PAD, { force: true });
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('weigert --dry en --eenmalig samen', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler()).uitvoerder);

    // Stil één van de twee kiezen laat iemand denken dat de run gestart is.
    expect(() => {
      orkestreer({ dry: true, eenmalig: true, werkplaatsWortel: wortel });
    }).toThrow(/sluiten elkaar uit/);
  });

  it('stopt als de escalatielijst niet gelezen kan worden', () => {
    const basis = bepaler();
    const stuk: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'gh' &&
      aanroep.argumenten[0] === 'api' &&
      aanroep.argumenten[1] !== 'graphql'
        ? { code: 1 }
        : basis(aanroep, index);
    stelUitvoerderIn(maakUitvoerderOpnemer(stuk).uitvoerder);

    // Een lege lijst bij een mislukte aanroep zou betekenen dat een item dat gisteren
    // een vraag stelde vandaag opnieuw draait — met kosten en zonder nieuwe informatie.
    expect(() => {
      orkestreer({ dry: true, werkplaatsWortel: wortel });
    }).toThrow(/escalaties niet lezen/);
  });

  it('zet het item terug in de wachtrij als de run omvalt', () => {
    // `claude` is niet geïnstalleerd: `run` gooit op een startfout, ook met toleranter.
    // Dat is een probleem van de machine, niet van dit item — het hoort dus terug in
    // de wachtrij en niet met een escalatie geblokkeerd te worden.
    // Eén bepaler-instantie: hij houdt de kolom bij, dus elke aanroep opnieuw bouwen
    // zou het board telkens terugzetten op de beginstand.
    const basis = bepaler();
    const stuk: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude'
        ? { code: 1, stdout: '', startfout: 'spawn claude ENOENT' }
        : basis(aanroep, index);
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(stuk);
    stelUitvoerderIn(uitvoerder);

    expect(() => {
      orkestreer({ eenmalig: true, werkplaatsWortel: wortel });
    }).toThrow(/claude/);

    // Twee verplaatsingen: naar Technisch refinen bij aanvang, en terug bij de val.
    // Zonder die tweede staat het item in geen enkele wachtrij meer.
    const verplaatsingen = aanroepen.filter((a) => a.argumenten[0] === 'project');
    expect(verplaatsingen).toHaveLength(2);
    expect(ghArgs(aanroepen).some((a) => a.includes('--add-label'))).toBe(false);
  });

  it('maakt het escalatielabel aan voordat het gebruikt wordt', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler({ werker: werkerMislukt() }));
    stelUitvoerderIn(uitvoerder);

    orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    // `gh issue edit --add-label` faalt op een label dat niet bestaat, en labelen faalt
    // zacht: zonder dit zou een escalatie stil niet gemarkeerd worden.
    const maken = aanroepen.findIndex((a) => a.argumenten[0] === 'label');
    const zetten = aanroepen.findIndex((a) => a.argumenten.includes('--add-label'));
    expect(maken).toBeGreaterThanOrEqual(0);
    expect(zetten).toBeGreaterThan(maken);
  });

  it('doet niets zonder --dry of --eenmalig', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler()).uitvoerder);

    // Een kaal commando dat tóch een werker start is precies de verrassing die je bij
    // onbemand werk niet wilt.
    expect(() => {
      orkestreer({ werkplaatsWortel: wortel });
    }).toThrow(/--dry .* --eenmalig/);
  });

  it('toont de wachtrij oudste eerst, en laat alles buiten die kolom staan', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler()).uitvoerder);

    orkestreer({ dry: true, werkplaatsWortel: wortel });

    const tekst = uitvoer.join('');
    expect(tekst.indexOf('#51')).toBeLessThan(tekst.indexOf('#119'));
    expect(tekst.indexOf('#119')).toBeLessThan(tekst.indexOf('#131'));
    // #77 staat op Bouwen, #78 is gesloten: allebei niet aan de beurt.
    expect(tekst).not.toContain('#77');
    expect(tekst).not.toContain('#78');
  });

  it('schrijft niets bij --dry', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler());
    stelUitvoerderIn(uitvoerder);

    orkestreer({ dry: true, werkplaatsWortel: wortel });

    // Geen werker, geen verplaatsing, geen comment, en geen werkplaats op schijf.
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'git')).toBe(false);
    expect(ghArgs(aanroepen).some((a) => a[0] === 'project' || a[0] === 'issue')).toBe(false);
    expect(existsSync(path.join(wortel, 'assistant'))).toBe(false);
  });

  it('slaat items zonder App-veld over, met een melding', () => {
    const board = [
      boardItem(200, null, 'Klaar voor technische refinement', '2026-08-01T00:00:00Z'),
    ];
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler({ board })).uitvoerder);

    orkestreer({ dry: true, werkplaatsWortel: wortel });

    // Zonder App weet de werker niet wélke code hij moet lezen; stil overslaan zou
    // betekenen dat zo'n item nooit aan de beurt komt zonder dat iemand het merkt.
    expect(uitvoer.join('')).toMatch(/#200 heeft geen App-veld/);
  });

  it('slaat geëscaleerde items over', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler({ escalaties: '51\n' })).uitvoerder);

    orkestreer({ dry: true, werkplaatsWortel: wortel });

    // Een item met escalatie wacht op een antwoord; opnieuw draaien geeft dezelfde
    // vraag en kost alleen geld.
    expect(uitvoer.join('')).not.toContain('#51');
    expect(uitvoer.join('')).toContain('#119');
  });

  it('leest het board precies één keer, ongeacht hoeveel items er in de wachtrij staan', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler());
    stelUitvoerderIn(uitvoerder);

    orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    // Drie items in de wachtrij. Zou elke werker het board zelf opzoeken, dan kost
    // dat een kwart van het uurbudget om iets te vinden dat de supervisor al weet.
    expect(boardLezingen(aanroepen)).toBe(1);
  });

  it('werkt het oudste item af en laat het op Technisch refinen wachten', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler());
    stelUitvoerderIn(uitvoerder);

    orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    const claude = aanroepen.find((a) => a.commando === 'claude');
    expect(claude?.argumenten[1]).toContain('#51');
    expect(claude?.cwd).toBe(path.join(wortel, 'assistant'));
    // De uitwerking landt in de body van het issue…
    expect(ghArgs(aanroepen)).toContainEqual(
      expect.arrayContaining(['issue', 'edit', '51', '--body-file']),
    );
    // …en er komt precies één comment bij.
    expect(ghArgs(aanroepen).filter((a) => a[0] === 'issue' && a[1] === 'comment')).toHaveLength(1);
  });

  it('promoveert nooit naar Klaar voor Bouwen', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler());
    stelUitvoerderIn(uitvoerder);

    orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    // Voor een refinement bestaat geen verify die hem kan afkeuren; de enige poort is
    // de gebruiker. Een werker die zijn eigen werk goedkeurt heeft geen poort meer.
    const zoekQueries = aanroepen.flatMap((a) =>
      a.argumenten.filter((arg) => arg.startsWith('query=')),
    );
    expect(zoekQueries.join('')).not.toContain('Klaar voor Bouwen');
    expect(uitvoer.join('')).not.toContain('Klaar voor Bouwen\n');
  });

  it('rekent een run met is_error als mislukt, ook bij exitcode 0', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler({ werker: werkerMislukt() }));
    stelUitvoerderIn(uitvoerder);

    orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    // Geen nieuwe body: er ís geen uitwerking. Wel een escalatie, zodat dezelfde fout
    // niet elke nacht opnieuw draait.
    expect(ghArgs(aanroepen).some((a) => a.includes('--body-file'))).toBe(false);
    expect(ghArgs(aanroepen)).toContainEqual(
      expect.arrayContaining(['issue', 'edit', '51', '--add-label', 'escalatie']),
    );
  });

  it('stopt als er al een run bezig is', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler());
    stelUitvoerderIn(uitvoerder);
    orkestreer({ eenmalig: true, werkplaatsWortel: wortel });
    // Het slot van de vorige run is vrijgegeven; zet er handmatig een neer alsof er
    // nog iets draait.
    const tweede = maakUitvoerderOpnemer(bepaler());
    stelUitvoerderIn(tweede.uitvoerder);
    closeSync(openSync(LOCK_PAD, 'wx'));

    expect(() => {
      orkestreer({ eenmalig: true, werkplaatsWortel: wortel });
    }).toThrow(/draait al een orkestrator-run/);
    expect(tweede.aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(true);
  });

  it('geeft het slot ook vrij als de run onderweg omvalt', () => {
    const basis = bepaler();
    const stuk: UitkomstBepaler = (aanroep, index) =>
      // De werkplaats klonen mislukt; dat gooit, halverwege werkAf.
      aanroep.commando === 'gh' && aanroep.argumenten[0] === 'repo'
        ? { code: 1 }
        : basis(aanroep, index);
    stelUitvoerderIn(maakUitvoerderOpnemer(stuk).uitvoerder);

    expect(() => {
      orkestreer({ eenmalig: true, werkplaatsWortel: wortel });
    }).toThrow();

    // Blijft het slot liggen, dan staat de rij een uur stil op een run die al klaar is.
    expect(existsSync(LOCK_PAD)).toBe(false);
  });
});

describe('escalatie-comment', () => {
  const UITKOMST = {
    afloop: 'escalatie' as const,
    sessie: '5ad6e642-9e2a-4b4b-8af0-ecf40f956335',
    kosten: 1.5,
    beurten: 7,
    weigeringen: 0,
  };

  it('is terug te lezen, ook als de vraag zelf opmaak bevat', () => {
    const vraag = 'Via **de assistent** of via `beheer`?\n\nBeide kan.';
    const advies = 'Via de assistent — beheer heeft geen kanaal naar buiten.';

    const comment = escalatieComment(94, vraag, advies, UITKOMST, '/w/beheer');
    const terug = leesEscalatie(comment);

    // De grenzen zijn HTML-comments, dus opmaak in de tekst zelf breekt niets.
    expect(terug?.vraag).toBe(vraag);
    expect(terug?.advies).toBe(advies);
    expect(terug?.sessie).toBe(UITKOMST.sessie);
    expect(terug?.werkmap).toBe('/w/beheer');
  });

  it('noemt het commando waarmee je antwoordt, met het juiste nummer', () => {
    expect(escalatieComment(94, 'v', 'a', UITKOMST, '/w')).toContain(
      'factory orkestreer antwoord 94',
    );
  });

  it('geeft undefined bij een comment zonder sessie-markering', () => {
    // Een handgeschreven comment is geen escalatie; die mag `antwoord` niet hervatten.
    expect(leesEscalatie('gewoon een opmerking van een mens')).toBeUndefined();
  });
});

describe('escalatie in de wachtrij', () => {
  let wortel: string;
  let herstelOmgeving: () => void;
  let uitvoer: string[];

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    wortel = mkdtempSync(path.join(os.tmpdir(), 'factory-esc-'));
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
    rmSync(LOCK_PAD, { force: true });
  });

  afterEach(() => {
    rmSync(wortel, { recursive: true, force: true });
    rmSync(LOCK_PAD, { force: true });
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('zet een geëscaleerd item terug in de wachtrij-kolom, met het label', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler({ werker: werkerEscaleert() }));
    stelUitvoerderIn(uitvoerder);

    orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    // Er wordt niet aan gewerkt, dus het hoort niet op "Technisch refinen" te blijven
    // staan; het label houdt hem uit de rij tot jij antwoordt.
    const opties = aanroepen
      .filter((a) => a.argumenten[0] === 'project')
      .map((a) => a.argumenten[a.argumenten.indexOf('--single-select-option-id') + 1]);
    expect(opties).toEqual(['optie-technisch', 'optie-wachtrij']);
    expect(ghArgs(aanroepen)).toContainEqual(
      expect.arrayContaining(['issue', 'edit', '51', '--add-label', 'escalatie']),
    );
    // Geen uitwerking, dus ook geen body.
    expect(ghArgs(aanroepen).some((a) => a.includes('--body-file'))).toBe(false);
  });

  it('schrijft de vraag en het advies in de comment', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler({ werker: werkerEscaleert() }));
    stelUitvoerderIn(uitvoerder);

    orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    const comment = aanroepen.find((a) => a.argumenten[1] === 'comment')?.argumenten.at(-1) ?? '';
    expect(leesEscalatie(comment)).toMatchObject({
      vraag: 'WASM of native crypto-SDK?',
      advies: 'WASM — geen native compilatie in de bouw.',
      werkmap: path.join(wortel, 'assistant'),
    });
  });
});

describe('orkestreer status', () => {
  let uitvoer: string[];
  let herstelOmgeving: () => void;

  const ESCALATIE_COMMENT = escalatieComment(
    51,
    'WASM of native crypto-SDK?',
    'WASM — geen native compilatie in de bouw.',
    {
      afloop: 'escalatie' as const,
      sessie: '5ad6e642-9e2a-4b4b-8af0-ecf40f956335',
      kosten: 1.1,
      beurten: 7,
      weigeringen: 0,
    },
    '/w/assistant',
  );

  /** Zoals `gh api …/comments --jq '[.[].body] | @base64'` het teruggeeft. */
  function commentsAntwoord(bodies: string[]): string {
    return Buffer.from(JSON.stringify(bodies), 'utf8').toString('base64');
  }

  const BOARD = [
    boardItem(51, 'assistant', 'Klaar voor technische refinement', '2026-08-09T00:00:00Z'),
    boardItem(96, 'beheer', 'Technisch refinen', '2026-08-10T00:00:00Z'),
    boardItem(119, 'assistant', 'Klaar voor technische refinement', '2026-08-18T00:00:00Z'),
  ];

  const statusBepaler: UitkomstBepaler = ({ commando, argumenten }) => {
    if (commando === 'gh' && argumenten[1] === 'graphql') {
      return { stdout: boardAntwoord(BOARD) };
    }
    if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1]?.includes('/comments')) {
      return { stdout: commentsAntwoord(['een mens zegt iets', ESCALATIE_COMMENT]) };
    }
    if (commando === 'gh' && argumenten[0] === 'api') return { stdout: '51\n' };
    return {};
  };

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

  it('toont drie blokken en zet elk item in precies één', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(statusBepaler).uitvoerder);

    orkestreerStatus('/repo');

    const tekst = uitvoer.join('');
    // #51 is geëscaleerd: hij staat wel in de wachtrij-kolom, maar hoort in het
    // escalatie-blok en niet in de rij — anders lijkt het alsof hij zo aan de beurt is.
    expect(tekst).toMatch(/wacht op jouw akkoord \(1\)/);
    expect(tekst).toMatch(/wacht op een antwoord \(1\)/);
    expect(tekst).toMatch(/Klaar voor technische refinement \(1\)/);
    expect(tekst.indexOf('#96')).toBeLessThan(tekst.indexOf('#51'));
    expect(tekst.indexOf('#51')).toBeLessThan(tekst.indexOf('#119'));
  });

  it('toont bij een escalatie de vraag, het advies en hoe je antwoordt', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(statusBepaler).uitvoerder);

    orkestreerStatus('/repo');

    const tekst = uitvoer.join('');
    expect(tekst).toContain('WASM of native crypto-SDK?');
    expect(tekst).toContain('geen native compilatie');
    expect(tekst).toContain('factory orkestreer antwoord 51');
  });

  it('zegt het als een escalatie geen leesbare comment heeft', () => {
    const zonder: UitkomstBepaler = (aanroep, index) =>
      aanroep.argumenten[1]?.includes('/comments') === true
        ? { stdout: commentsAntwoord(['alleen menselijke tekst']) }
        : statusBepaler(aanroep, index);
    stelUitvoerderIn(maakUitvoerderOpnemer(zonder).uitvoerder);

    orkestreerStatus('/repo');

    // Stil laten zou betekenen dat je een escalatie ziet die je niet kunt beantwoorden
    // zonder te weten waarom.
    expect(uitvoer.join('')).toContain('geen leesbare escalatie-comment');
  });
});

describe('orkestreer antwoord', () => {
  let herstelOmgeving: () => void;

  const ESCALATIE = escalatieComment(
    51,
    'WASM of native?',
    'WASM.',
    {
      afloop: 'escalatie' as const,
      sessie: '5ad6e642-9e2a-4b4b-8af0-ecf40f956335',
      kosten: 1.1,
      beurten: 7,
      weigeringen: 0,
    },
    '/w/assistant',
  );

  function commentsAntwoord(bodies: string[]): string {
    return Buffer.from(JSON.stringify(bodies), 'utf8').toString('base64');
  }

  /** Comment gevonden, werker levert een uitwerking. */
  function antwoordBepaler(werker?: string): UitkomstBepaler {
    return ({ commando, argumenten }) => {
      if (commando === 'claude') return { stdout: werker ?? werkerKlaar() };
      if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1]?.includes('/comments')) {
        return { stdout: commentsAntwoord([ESCALATIE]) };
      }
      if (commando === 'gh' && argumenten[1] === 'graphql') {
        return { stdout: doelwitAntwoord('Klaar voor technische refinement') };
      }
      return {};
    };
  }

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('hervat de sessie in de werkmap uit de comment', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(antwoordBepaler());
    stelUitvoerderIn(uitvoerder);

    orkestreerAntwoord('51', 'doe WASM', {}, '/repo');

    const claude = aanroepen.find((a) => a.commando === 'claude');
    // Hervatten, niet opnieuw beginnen: gemeten $0,02 tegen $0,32, en het werk tot de
    // escalatie blijft staan.
    expect(claude?.argumenten[0]).toBe('--resume');
    expect(claude?.argumenten[1]).toBe('5ad6e642-9e2a-4b4b-8af0-ecf40f956335');
    expect(claude?.argumenten).not.toContain('--session-id');
    expect(claude?.cwd).toBe('/w/assistant');
    // Het antwoord staat in de prompt, met de vraag erbij als context.
    expect(claude?.argumenten.join(' ')).toContain('doe WASM');
  });

  it('haalt het escalatie-label weg zodra er een uitwerking staat', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(antwoordBepaler());
    stelUitvoerderIn(uitvoerder);

    orkestreerAntwoord('51', 'doe WASM', {}, '/repo');

    expect(ghArgs(aanroepen)).toContainEqual(
      expect.arrayContaining(['issue', 'edit', '51', '--body-file']),
    );
    expect(ghArgs(aanroepen)).toContainEqual(
      expect.arrayContaining(['issue', 'edit', '51', '--remove-label', 'escalatie']),
    );
  });

  it('begint een verse sessie met --opnieuw', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(antwoordBepaler());
    stelUitvoerderIn(uitvoerder);

    orkestreerAntwoord('51', 'doe WASM', { opnieuw: true }, '/repo');

    const claude = aanroepen.find((a) => a.commando === 'claude');
    expect(claude?.argumenten).not.toContain('--resume');
    expect(claude?.argumenten).toContain('--session-id');
  });

  it('zegt het als de sessie niet meer te hervatten is, en biedt een verse run aan', () => {
    // Gemeten: een onbekende sessie geeft platte tekst met exit 1, geen JSON.
    const weg: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude'
        ? { code: 1, stdout: 'No conversation found with session ID: 5ad6e642-…' }
        : antwoordBepaler()(aanroep, index);
    stelUitvoerderIn(maakUitvoerderOpnemer(weg).uitvoerder);

    // Niet stil falen: er staat letterlijk wat je nu moet doen.
    expect(() => {
      orkestreerAntwoord('51', 'doe WASM', {}, '/repo');
    }).toThrow(/--opnieuw/);
  });

  it('weigert een issue zonder escalatie-comment', () => {
    const leeg: UitkomstBepaler = ({ commando, argumenten }) =>
      commando === 'gh' && argumenten[1]?.includes('/comments') === true
        ? { stdout: Buffer.from('[]', 'utf8').toString('base64') }
        : {};
    stelUitvoerderIn(maakUitvoerderOpnemer(leeg).uitvoerder);

    expect(() => {
      orkestreerAntwoord('51', 'doe WASM', {}, '/repo');
    }).toThrow(/Geen escalatie gevonden/);
  });

  it('weigert een aanroep zonder nummer of tekst', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer().uitvoerder);

    expect(() => {
      orkestreerAntwoord('51', '  ', {}, '/repo');
    }).toThrow(/Gebruik: factory orkestreer antwoord/);
  });
});
