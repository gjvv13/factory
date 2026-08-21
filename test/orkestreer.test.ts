import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bouwNachtScript,
  bouwOrkestreerPlist,
  eigenVersie,
  escalatieComment,
  leesEscalatie,
  orkestreer,
  orkestreerAntwoord,
  orkestreerStatus,
} from '../src/commands/orkestreer.js';
import {
  boekRun,
  leesStaat,
  standaardPaden,
  TOKEN_SLEUTEL,
  type OrkestratorPaden,
} from '../src/orkestrator-instellingen.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import {
  maakUitvoerderOpnemer,
  zetBoardOmgeving,
  type ProcesAanroep,
  type UitkomstBepaler,
} from './helpers.js';

const LOCK_PAD = path.join(os.tmpdir(), 'factory-orkestreer.lock');

/** Pad naar een opgenomen `claude`-respons in `test/fixtures`. */
function fixture(naam: string): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', naam);
}

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

  it('richt de run met --issue op dat item in plaats van op de kop', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler()).uitvoerder);

    orkestreer({ dry: true, issue: 131, werkplaatsWortel: wortel });

    // De kop is #51 (9 aug); gevraagd is #131.
    const tekst = uitvoer.join('');
    expect(tekst).toContain('Zou nu draaien: #131');
    expect(tekst).not.toContain('Zou nu draaien: #51');
  });

  it('noemt de reden als het gevraagde item niet in de wachtrij staat', () => {
    // `escalaties` draait `gh api … --jq '.[].number'`, dus de uitvoer is één nummer
    // per regel — niet de ruwe JSON.
    const escalatie = '119';
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaler({ escalaties: escalatie }));
    stelUitvoerderIn(uitvoerder);

    // #119 draagt escalatie, #77 staat in een andere kolom. Zonder deze meldingen zou
    // een gerichte vraag hetzelfde stille antwoord geven als een lege rij (#210).
    expect(() => {
      orkestreer({ dry: true, issue: 119, werkplaatsWortel: wortel });
    }).toThrow(/label escalatie/);
    expect(() => {
      orkestreer({ dry: true, issue: 77, werkplaatsWortel: wortel });
    }).toThrow(/staat niet in de wachtrij/);

    // Een geweigerde vraag kost geen werker.
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
  });

  it('weigert --issue samen met --nacht', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler()).uitvoerder);

    // Een nachtrun draait tot het dagmaximum; op één item gericht zou hij na de eerste
    // ronde op de lus-vanger stuiten. Dan is de vlag een dure `--eenmalig`.
    expect(() => {
      orkestreer({ nacht: true, issue: 131, werkplaatsWortel: wortel });
    }).toThrow(/gaan niet samen/);
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
  let statusHome: string;
  let statusPaden: OrkestratorPaden;

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
    // Eigen home: status leest sinds #264 de dagteller, en die van de gebruiker die de
    // tests draait hoort er niet in mee te wegen.
    statusHome = mkdtempSync(path.join(os.tmpdir(), 'factory-status-home-'));
    statusPaden = standaardPaden(statusHome);
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    rmSync(statusHome, { recursive: true, force: true });
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('toont de twee dagtellers van vandaag (#264)', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(statusBepaler).uitvoerder);
    const nu = new Date(Date.now());
    boekRun(statusPaden, nu, 'nacht');
    boekRun(statusPaden, nu, 'interactief');
    boekRun(statusPaden, nu, 'interactief');

    orkestreerStatus('/repo', { paden: statusPaden });

    // Zonder deze regels zie je de nachtpot pas leeg als de nacht meldt dat hij niets doet.
    const tekst = uitvoer.join('');
    expect(tekst).toMatch(/nacht:\s+1\/4/);
    expect(tekst).toMatch(/zelf gestart:\s+2/);
  });

  it('toont drie blokken en zet elk item in precies één', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(statusBepaler).uitvoerder);

    orkestreerStatus('/repo', { paden: statusPaden });

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

    orkestreerStatus('/repo', { paden: statusPaden });

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

    orkestreerStatus('/repo', { paden: statusPaden });

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

  it('begint met --opnieuw een verse sessie mét de volledige opdracht', () => {
    const wortel = mkdtempSync(path.join(os.tmpdir(), 'factory-opnieuw-'));
    const metBoard: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'gh' &&
      aanroep.argumenten[1] === 'graphql' &&
      (aanroep.argumenten.find((a) => a.startsWith('query=')) ?? '').includes('items(first:100')
        ? {
            stdout: boardAntwoord([
              boardItem(
                51,
                'assistant',
                'Klaar voor technische refinement',
                '2026-08-09T00:00:00Z',
              ),
            ]),
          }
        : antwoordBepaler()(aanroep, index);
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(metBoard);
    stelUitvoerderIn(uitvoerder);

    orkestreerAntwoord('51', 'doe WASM', { opnieuw: true, werkplaatsWortel: wortel }, '/repo');
    rmSync(wortel, { recursive: true, force: true });

    const claude = aanroepen.find((a) => a.commando === 'claude');
    expect(claude?.argumenten).not.toContain('--resume');
    // Een verse id: hergebruik van de oude faalt met "Session ID is already in use"
    // zodra die sessie toch nog bestaat (gemeten).
    const sessie = claude?.argumenten[claude.argumenten.indexOf('--session-id') + 1];
    expect(sessie).not.toBe('5ad6e642-9e2a-4b4b-8af0-ecf40f956335');
    expect(sessie).toMatch(/^[0-9a-f-]{36}$/);
    // En de volledige opdracht, niet alleen het antwoord: een lege sessie weet anders
    // niet wélk issue, wélke applicatie of wat er opgeleverd moet worden.
    const prompt = claude?.argumenten[claude.argumenten.indexOf('-p') + 1] ?? '';
    expect(prompt).toContain('#51');
    expect(prompt).toContain('assistant');
    expect(prompt).toContain('doe WASM');
    expect(prompt).toContain('WASM of native?');
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

  it('vindt de escalatie ook als er daarna nog een comment kwam', () => {
    const laterMislukt =
      '**Run mislukt.** iets\n\n<sub>$0.10</sub>\n<!-- orkestrator: sessie=x werkmap=/w -->';
    const naEscalatie: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'claude') return { stdout: werkerKlaar() };
      if (commando === 'gh' && argumenten[1]?.includes('/comments') === true) {
        return { stdout: commentsAntwoord([ESCALATIE, laterMislukt]) };
      }
      if (commando === 'gh' && argumenten[1] === 'graphql') {
        return { stdout: doelwitAntwoord('Klaar voor technische refinement') };
      }
      return {};
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(naEscalatie);
    stelUitvoerderIn(uitvoerder);

    orkestreerAntwoord('51', 'doe WASM', {}, '/repo');

    // De mislukt-comment draagt ook de sessie-markering maar geen vraag; alleen naar
    // de laatste kijken zou de vraag een comment hoger onvindbaar maken.
    const claude = aanroepen.find((a) => a.commando === 'claude');
    expect(claude?.argumenten[1]).toBe('5ad6e642-9e2a-4b4b-8af0-ecf40f956335');
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

  it('stopt op het lock, net als een gewone run', () => {
    closeSync(openSync(LOCK_PAD, 'wx'));
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(antwoordBepaler());
    stelUitvoerderIn(uitvoerder);

    // Twee antwoorden tegelijk hervatten dezelfde sessie en schrijven allebei een body
    // en een comment; de laatste wint en je houdt een dubbele comment over.
    expect(() => {
      orkestreerAntwoord('51', 'doe WASM', {}, '/repo');
    }).toThrow(/draait al een orkestrator-run/);
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    rmSync(LOCK_PAD, { force: true });
  });

  it('weigert een aanroep zonder nummer of tekst', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer().uitvoerder);

    expect(() => {
      orkestreerAntwoord('51', '  ', {}, '/repo');
    }).toThrow(/Gebruik: factory orkestreer antwoord/);
  });
});

describe('orkestreer — boekhouding per run (#264)', () => {
  let uitvoer: string[];
  let wortel: string;
  let home: string;
  let paden: OrkestratorPaden;
  let herstelOmgeving: () => void;

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    wortel = mkdtempSync(path.join(os.tmpdir(), 'factory-boek-'));
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-boek-home-'));
    paden = standaardPaden(home);
    mkdirSync(path.dirname(paden.envPad), { recursive: true });
    writeFileSync(paden.envPad, `${TOKEN_SLEUTEL}=sk-boek\nFACTORY_BUDGET_USD=3\n`, {
      mode: 0o600,
    });
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
    rmSync(LOCK_PAD, { force: true });
  });

  afterEach(() => {
    rmSync(wortel, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(LOCK_PAD, { force: true });
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  /** De regels van het runlog, zonder de kopregels van een nacht. */
  function runRegels(): string[] {
    if (!existsSync(paden.logPad)) return [];
    return readFileSync(paden.logPad, 'utf8')
      .trim()
      .split('\n')
      .filter((regel) => regel.includes('#'));
  }

  it('boekt en logt een run die met de hand gestart is', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler()).uitvoerder);

    // Tot #264 zat boeken en loggen in de nacht-lus: een `--eenmalig`-run telde niet mee
    // in het dagmaximum en liet geen spoor na. Toen de teller vol zat werkte de wachtrij
    // zich met losse aanroepen verder af — de geldrem was te omzeilen zonder omzeilen.
    orkestreer({ eenmalig: true, werkplaatsWortel: wortel, paden });

    expect(leesStaat(paden, new Date(Date.now())).interactief).toBe(1);
    const regels = runRegels();
    expect(regels).toHaveLength(1);
    expect(regels[0]).toMatch(/#51 assistant refine klaar/);
  });

  it('noemt de soort in de logregel', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler()).uitvoerder);

    orkestreer({ eenmalig: true, werkplaatsWortel: wortel, paden });

    // Een gemiddelde over refine en bouw door elkaar zegt niets: $5 budget tegen $10.
    expect(runRegels()[0]).toContain(' refine ');
  });

  it('logt ook een run die omvalt, met de reden', () => {
    const basis = bepaler();
    const stuk: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude'
        ? { code: 1, stdout: '', startfout: 'spawn claude ENOENT' }
        : basis(aanroep, index);
    stelUitvoerderIn(maakUitvoerderOpnemer(stuk).uitvoerder);

    expect(() => {
      orkestreer({ eenmalig: true, werkplaatsWortel: wortel, paden });
    }).toThrow(/claude/);

    // Een teller op 1 met een leeg log is precies de stilte die je niet kunt lezen.
    expect(leesStaat(paden, new Date(Date.now())).interactief).toBe(1);
    expect(runRegels()[0]).toMatch(/#51 assistant refine afgebroken/);
  });

  it('boekt en logt niets bij --dry', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(bepaler()).uitvoerder);

    orkestreer({ dry: true, werkplaatsWortel: wortel, paden });

    expect(leesStaat(paden, new Date(Date.now())).gestart).toBe(0);
    expect(runRegels()).toHaveLength(0);
  });
});

describe('orkestreer --nacht', () => {
  let uitvoer: string[];
  let wortel: string;
  let home: string;
  let paden: OrkestratorPaden;
  let herstelOmgeving: () => void;

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    wortel = mkdtempSync(path.join(os.tmpdir(), 'factory-nacht-'));
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-nacht-home-'));
    paden = standaardPaden(home);
    mkdirSync(path.dirname(paden.envPad), { recursive: true });
    writeFileSync(
      paden.envPad,
      `${TOKEN_SLEUTEL}=sk-nacht\nFACTORY_DAGMAXIMUM=2\nFACTORY_BUDGET_USD=3\n`,
      { mode: 0o600 },
    );
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
    rmSync(LOCK_PAD, { force: true });
  });

  afterEach(() => {
    rmSync(wortel, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(LOCK_PAD, { force: true });
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  const NU = new Date('2026-08-19T04:00:00');

  /** Het issuenummer van een opgenomen board-item. */
  function nummerVan(item: unknown): number {
    return (item as { content: { number: number } }).content.number;
  }

  /**
   * Een board dat meebeweegt met wat de orkestrator ermee doet — nodig voor `--nacht`,
   * want die leest de wachtrij per ronde opnieuw. Een afgewerkt item verlaat de
   * wachtrij-kolom; een geblokkeerd item blijft er staan maar duikt op in de
   * escalatielijst, precies zoals `blokkeer` het achterlaat.
   */
  function nachtBord(items: unknown[], opties: { werker?: string } = {}): UitkomstBepaler {
    const verzet = new Set<number>();
    const geblokkeerd = new Set<number>();
    return ({ commando, argumenten }) => {
      if (commando === 'claude') {
        const gevraagd = /- Issue: \*\*#(\d+)\*\*/.exec(argumenten.join('\n'))?.[1];
        if (gevraagd !== undefined) {
          verzet.add(Number.parseInt(gevraagd, 10));
        }
        return { stdout: opties.werker ?? werkerKlaar() };
      }
      if (commando === 'gh' && argumenten[0] === 'issue' && argumenten.includes('--add-label')) {
        const nummer = Number.parseInt(argumenten[2] ?? '', 10);
        geblokkeerd.add(nummer);
        verzet.delete(nummer);
        return {};
      }
      if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql') {
        const query = argumenten.find((a) => a.startsWith('query=')) ?? '';
        if (query.includes('items(first:100')) {
          return { stdout: boardAntwoord(items.filter((item) => !verzet.has(nummerVan(item)))) };
        }
        return { stdout: doelwitAntwoord('Klaar voor technische refinement') };
      }
      if (commando === 'gh' && argumenten[0] === 'api') {
        return { stdout: [...geblokkeerd].map(String).join('\n') };
      }
      return {};
    };
  }

  function claudeAanroepen(aanroepen: ProcesAanroep[]): ProcesAanroep[] {
    return aanroepen.filter((a) => a.commando === 'claude');
  }

  it('stopt bij het dagmaximum, ook al staan er meer items in de rij', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(nachtBord(WACHTRIJ));
    stelUitvoerderIn(uitvoerder);

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Dagmaximum 2 uit het instellingenbestand; de wachtrij heeft er drie.
    expect(claudeAanroepen(aanroepen)).toHaveLength(2);
    expect(leesStaat(paden, NU).gestart).toBe(2);
  });

  it('deelt dat maximum met een tweede run op dezelfde kalenderdag', () => {
    const eerste = maakUitvoerderOpnemer(nachtBord(WACHTRIJ));
    stelUitvoerderIn(eerste.uitvoerder);
    orkestreer({
      nacht: true,
      werkplaatsWortel: wortel,
      paden,
      nu: new Date('2026-08-19T04:00:00'),
    });
    expect(claudeAanroepen(eerste.aanroepen)).toHaveLength(2);

    const tweede = maakUitvoerderOpnemer(nachtBord(WACHTRIJ));
    stelUitvoerderIn(tweede.uitvoerder);
    rmSync(LOCK_PAD, { force: true });
    orkestreer({
      nacht: true,
      werkplaatsWortel: wortel,
      paden,
      nu: new Date('2026-08-19T22:00:00'),
    });

    // Zonder deze deling is een handmatige extra run 's avonds een gratis verdubbeling
    // van wat ik de volgende dag moet beoordelen.
    expect(claudeAanroepen(tweede.aanroepen)).toHaveLength(0);
    expect(uitvoer.join('')).toMatch(/dagmaximum al bereikt \(2\/2\)/);
  });

  it('begint na een dagovergang weer bij nul', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(nachtBord(WACHTRIJ)).uitvoerder);
    orkestreer({
      nacht: true,
      werkplaatsWortel: wortel,
      paden,
      nu: new Date('2026-08-19T04:00:00'),
    });

    const morgen = maakUitvoerderOpnemer(nachtBord(WACHTRIJ));
    stelUitvoerderIn(morgen.uitvoerder);
    rmSync(LOCK_PAD, { force: true });
    orkestreer({
      nacht: true,
      werkplaatsWortel: wortel,
      paden,
      nu: new Date('2026-08-20T04:00:00'),
    });

    // Anders zou de orkestrator na één volle nacht nooit meer draaien.
    expect(claudeAanroepen(morgen.aanroepen)).toHaveLength(2);
  });

  it('stopt zodra de wachtrij leeg is, en leest die rij per ronde opnieuw', () => {
    const eenItem = [
      boardItem(131, 'factory', 'Klaar voor technische refinement', '2026-08-01T00:00:00Z'),
    ];
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(nachtBord(eenItem));
    stelUitvoerderIn(uitvoerder);

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Eén item, dus één werker — en niet twee keer hetzelfde item omdat de lijst van
    // vóór de eerste run nog in het geheugen zat.
    expect(claudeAanroepen(aanroepen)).toHaveLength(1);
    expect(boardLezingen(aanroepen)).toBeGreaterThan(1);
    expect(uitvoer.join('')).toMatch(/wachtrij leeg/);
  });

  it('geeft het budget uit de instellingen mee en de token buiten de plist om', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(nachtBord(WACHTRIJ));
    stelUitvoerderIn(uitvoerder);

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    const eerste = claudeAanroepen(aanroepen)[0];
    expect(eerste?.argumenten[eerste.argumenten.indexOf('--max-budget-usd') + 1]).toBe('3');
    // De token reist als omgevingsvariabele mee; hij staat nergens in de argumenten,
    // want die zijn zichtbaar in `ps`.
    expect(eerste?.env?.[TOKEN_SLEUTEL]).toBe('sk-nacht');
    expect(eerste?.argumenten.join(' ')).not.toContain('sk-nacht');
  });

  it('schrijft per run een regel met issue, uitkomst, kosten en beurten', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(nachtBord(WACHTRIJ)).uitvoerder);

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Zonder eigen logregels zou alleen de stdout van launchd iets vastleggen, en dan
    // legt een handmatige run niets vast.
    const log = readFileSync(paden.logPad, 'utf8');
    expect(log).toMatch(/#51 assistant refine klaar \$1\.25 12 beurten/);
    // Drie regels: de startregel met de versie (#237), en twee runregels.
    expect(log.trim().split('\n')).toHaveLength(3);
  });

  it('telt een run mee die niet oplevert wat hij moest opleveren', () => {
    stelUitvoerderIn(
      maakUitvoerderOpnemer(nachtBord(WACHTRIJ, { werker: werkerMislukt() })).uitvoerder,
    );

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Een teller die alleen geslaagde runs telt is geen rem: een kapot item zou de
    // hele nacht opnieuw mogen draaien. En een mislukking is een escalatie, dus het
    // item wordt niet vannacht nog eens gepakt.
    expect(leesStaat(paden, NU).gestart).toBe(2);
    expect(readFileSync(paden.logPad, 'utf8')).toMatch(/#51 assistant refine mislukt/);
  });

  it('laat een run die zijn budget opmaakt als escalatie achter', () => {
    // De echte, opgenomen envelop van een budget-afkapping (`subtype:
    // error_max_budget_usd`, exit 1). Zonder deze weg zou een item dat elke nacht zijn
    // budget opmaakt elke nacht opnieuw geld kosten.
    const opgenomen = readFileSync(fixture('claude-run-fout.json'), 'utf8');
    const budgetOp: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude'
        ? { code: 1, stdout: opgenomen }
        : nachtBord(WACHTRIJ, { werker: opgenomen })(aanroep, index);
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(budgetOp);
    stelUitvoerderIn(uitvoerder);

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    const label = ghArgs(aanroepen).find((a) => a.includes('--add-label'));
    expect(label).toContain('escalatie');
    expect(readFileSync(paden.logPad, 'utf8')).toMatch(/#51 assistant refine mislukt \$0\.10/);
  });

  it('slaat een item over dat na zijn run nog in de wachtrij staat, en gaat door met de rest', () => {
    // `zetKolom` faalt zacht — een board-hik of een leeg GraphQL-budget is genoeg — en dan
    // blijft het item staan. Hetzelfde issue twee keer refinen is twee keer betalen voor
    // één uitwerking, dus overslaan; maar de rest van de nacht hoort door te gaan (#202).
    const basis = nachtBord(WACHTRIJ);
    const bordBlijftStaan: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude'
        ? { stdout: werkerKlaar() } // geen verzet: het item blijft in de wachtrij staan
        : basis(aanroep, index);
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bordBlijftStaan);
    stelUitvoerderIn(uitvoerder);

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Twee runs (het dagmaximum), op twee verschillende items: geen herhaling, geen stop.
    const gedraaid = claudeAanroepen(aanroepen).map(
      (a) => /- Issue: \*\*#(\d+)\*\*/.exec(a.argumenten.join('\n'))?.[1],
    );
    expect(gedraaid).toHaveLength(2);
    expect(new Set(gedraaid).size).toBe(2);
    expect(uitvoer.join('')).toMatch(/overgeslagen voor vannacht/);
    expect(uitvoer.join('')).not.toMatch(/gestopt om een lus te voorkomen/);
  });

  it('gaat door met de rij als het eerste item escaleert en de escalatielijst achterloopt', () => {
    // Precies de storing van 2026-08-20: #131 escaleerde, GitHub's labelfilter liep een
    // paar seconden achter, dus het item stond nog vooraan — en de nacht stopte met
    // "2/4 gedaan" terwijl er werk lag.
    const basis = nachtBord(WACHTRIJ);
    const achterlopend: UitkomstBepaler = (aanroep, index) => {
      // De escalatie-uitvraag (REST, niet graphql) blijft leeg: het label is gezet, maar
      // GitHub's filter kent het nog niet. Daardoor staat het geëscaleerde item de
      // volgende ronde nog vooraan in de rij — precies wat er vannacht gebeurde.
      if (
        aanroep.commando === 'gh' &&
        aanroep.argumenten[0] === 'api' &&
        aanroep.argumenten[1] !== 'graphql'
      ) {
        return { stdout: '' };
      }
      if (aanroep.commando === 'claude') return { stdout: werkerEscaleert() };
      return basis(aanroep, index);
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(achterlopend);
    stelUitvoerderIn(uitvoerder);

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Het geëscaleerde item wordt overgeslagen, niet herhaald, en de nacht gaat door.
    const gedraaid = claudeAanroepen(aanroepen).map(
      (a) => /- Issue: \*\*#(\d+)\*\*/.exec(a.argumenten.join('\n'))?.[1],
    );
    expect(gedraaid).toHaveLength(2);
    expect(new Set(gedraaid).size).toBe(2);
    expect(uitvoer.join('')).toMatch(/overgeslagen voor vannacht/);
  });

  it('laat een overgeslagen item de dagteller niet verhogen', () => {
    const basis = nachtBord(WACHTRIJ);
    const bordBlijftStaan: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude' ? { stdout: werkerKlaar() } : basis(aanroep, index);
    stelUitvoerderIn(maakUitvoerderOpnemer(bordBlijftStaan).uitvoerder);

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Twee runs, dus de teller staat op 2 — niet op 3 doordat de overslag ook meetelde.
    expect(uitvoer.join('')).toMatch(/2\/2 van vannacht gedaan/);
    expect(uitvoer.join('')).not.toMatch(/3\/2/);
  });

  it('gaat na een afgekapte run door met het volgende item', () => {
    // De hangende werker (#206): afkappen mag één item kosten, niet de nacht. Het item
    // gaat langs het bestaande escalatiepad van #154 en de rij schuift door.
    const basis = nachtBord(WACHTRIJ);
    let eerste = true;
    const kaptEersteAf: UitkomstBepaler = (aanroep, index) => {
      if (aanroep.commando === 'claude' && eerste) {
        eerste = false;
        return { code: 124, stdout: '', stderr: '', afgekapt: true as const };
      }
      return basis(aanroep, index);
    };
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(kaptEersteAf);
    stelUitvoerderIn(uitvoerder);

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Twee runs: de afgekapte en de volgende. Zonder deze slice stopte de nacht hier.
    expect(claudeAanroepen(aanroepen)).toHaveLength(2);
    // De afkapping staat in het log, met de reden erin.
    // Zoals de uitwerking hem voorschrijft: "#93 beheer afgekapt (30 min)".
    expect(readFileSync(paden.logPad, 'utf8')).toMatch(/#\d+ \w+ refine afgekapt \(30 min\)/);
    // En het item is geëscaleerd, niet stil overgeslagen.
    const label = ghArgs(aanroepen).find((a) => a.includes('--add-label'));
    expect(label).toContain('escalatie');
  });

  it('logt ook een run die de CLI omvertrekt', () => {
    // `claude` is niet te starten: `run` gooit. Zonder deze regel staat de dagteller op
    // 1 en het log op niets — de stilte die je 's ochtends niet kunt lezen.
    const basis = nachtBord(WACHTRIJ);
    const geenClaude: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude'
        ? { code: 1, stdout: '', startfout: 'spawn claude ENOENT' }
        : basis(aanroep, index);
    stelUitvoerderIn(maakUitvoerderOpnemer(geenClaude).uitvoerder);

    expect(() => {
      orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });
    }).toThrow(/claude/);

    expect(readFileSync(paden.logPad, 'utf8')).toMatch(/#51 assistant refine afgebroken/);
    expect(leesStaat(paden, NU).gestart).toBe(1);
  });

  it('geeft elke runregel zijn eigen tijdstempel', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(nachtBord(WACHTRIJ)).uitvoerder);

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Drie regels: de startregel en twee runs. De runregels hebben elk hun eigen
    // tijdstempel; twee gelijke stempels zeggen niets over hoe lang een run duurde.
    const regels = readFileSync(paden.logPad, 'utf8').trim().split('\n');
    expect(regels).toHaveLength(3);
    const runStempels = regels.slice(1).map((regel) => regel.split(' ')[0]);
    expect(runStempels[0]).not.toBe(NU.toISOString());
  });

  it('logt met welke versie de nacht draaide (#237)', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(nachtBord(WACHTRIJ)).uitvoerder);

    orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // De eerste logregel vermeldt de factory-versie, zodat je 's ochtends ziet of het
    // bijwerken gewerkt heeft.
    const log = readFileSync(paden.logPad, 'utf8');
    expect(log).toMatch(/nacht gestart \(factory \d+\.\d+\.\d+/);
  });

  it('weigert onbemand te draaien zonder token, met het recept erbij', () => {
    writeFileSync(paden.envPad, 'FACTORY_DAGMAXIMUM=2\n', { mode: 0o600 });
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(nachtBord(WACHTRIJ));
    stelUitvoerderIn(uitvoerder);

    expect(() => {
      orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });
    }).toThrow(/claude setup-token/);

    // En vóórdat er een item uit de wachtrij is gehaald: geen kolom verzet, geen werker.
    expect(aanroepen).toHaveLength(0);
  });

  it('weigert --nacht samen met --dry', () => {
    stelUitvoerderIn(maakUitvoerderOpnemer(nachtBord(WACHTRIJ)).uitvoerder);

    expect(() => {
      orkestreer({ nacht: true, dry: true, werkplaatsWortel: wortel, paden, nu: NU });
    }).toThrow(/sluiten elkaar uit/);
  });
});

describe('de LaunchAgent van de orkestrator', () => {
  const opzet = {
    bin: '/usr/local/bin/factory',
    werkmap: '/Users/gjvv',
    logPad: '/Users/gjvv/Library/Logs/nl.factory.orkestreer.log',
    factoryRepo: '/Users/gjvv/Documents/Software/factory',
  };

  it('draait --nacht één keer per nacht, buiten ~/Documents', () => {
    const plist = bouwOrkestreerPlist(opzet);

    expect(plist).toContain('<key>Label</key><string>nl.factory.orkestreer</string>');
    expect(plist).toContain('orkestreer --nacht');
    expect(plist).toContain('<key>WorkingDirectory</key><string>/Users/gjvv</string>');
    // Een moment, geen frequentie: deze agent start werkers die geld kosten.
    expect(plist).toContain('<key>Hour</key><integer>4</integer>');
    expect(plist).not.toContain('StartInterval');
  });

  it('start niet meteen bij het laden en draagt de token niet mee', () => {
    const plist = bouwOrkestreerPlist(opzet);

    // RunAtLoad zou het installeren van de automatiek zelf de verrassing maken die de
    // hele opzet wil vermijden; de token hoort in een 0600-bestand, niet in een plist
    // die voor iedereen leesbaar is.
    expect(plist).not.toContain('RunAtLoad');
    expect(plist).not.toContain(TOKEN_SLEUTEL);
  });

  it('werkt de globale bin bij vóór --nacht, en draait alsnog bij een mislukte update (#237)', () => {
    const plist = bouwOrkestreerPlist(opzet);

    // De plist draait nu een shellscript via /bin/sh: eerst bijwerken, dan exec.
    expect(plist).toContain('<string>/bin/sh</string>');
    expect(plist).toContain('<string>-c</string>');

    // De install-stap staat vóór de exec naar --nacht.
    const script = bouwNachtScript(opzet);
    const installIndex = script.indexOf('npm install -g');
    const execIndex = script.indexOf('exec');
    expect(installIndex).toBeGreaterThan(-1);
    expect(execIndex).toBeGreaterThan(installIndex);

    // Faalt het bijwerken, dan draait de nacht alsnog: de exec is onvoorwaardelijk.
    expect(script).toContain('WARNING bijwerken naar');
    expect(script).toContain('nacht draait op de huidige versie');
    // De exec staat buiten elke if/fi, dus hij draait altijd.
    const regels = script.split('\n');
    const execRegel = regels[regels.length - 1];
    expect(execRegel).toMatch(/^exec /);
  });

  it('haalt tags op uit de meegegeven factory-repo', () => {
    const script = bouwNachtScript(opzet);

    expect(script).toContain(`git -C "${opzet.factoryRepo}"`);
    // Twee keer: één keer fetch, één keer tag --list
    const gitAanroepen = script.match(new RegExp(`git -C "${opzet.factoryRepo}"`, 'g'));
    expect(gitAanroepen?.length).toBe(2);
  });
});

describe('eigenVersie', () => {
  it('leest de versie uit het eigen package.json', () => {
    // De draaiende code is de factory zelf, dus eigenVersie levert een geldige semver.
    const versie = eigenVersie();
    expect(versie).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('orkestreer --installeer en --verwijder', () => {
  let home: string;
  let paden: OrkestratorPaden;
  let uitvoer: string[];

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    home = mkdtempSync(path.join(os.tmpdir(), 'factory-agent-home-'));
    paden = standaardPaden(home);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  /** Een machine waarop de factory-repo staat, met tags en een globale npm-prefix. */
  function machine(opties: { globaleVersie?: string } = {}): UitkomstBepaler {
    return ({ commando, argumenten }) => {
      if (commando === 'git' && argumenten[0] === 'remote') {
        return { stdout: 'git@github.com:gjvv13/factory.git\n' };
      }
      if (commando === 'git' && argumenten[0] === 'tag') {
        return { stdout: 'v1.15.13\nv1.15.12\nv1.9.0\n' };
      }
      if (commando === 'npm' && argumenten[0] === 'prefix') {
        return { stdout: '/opt/homebrew\n' };
      }
      if (argumenten[0] === 'help') {
        // De globaal geïnstalleerde bin die `--nacht` wél kent.
        return { stdout: 'factory orkestreer <--dry|--eenmalig|--nacht>\n' };
      }
      if (commando === 'npm' && argumenten[0] === 'root') {
        return opties.globaleVersie === undefined ? { code: 1 } : { stdout: '/opt/homebrew/lib' };
      }
      return {};
    };
  }

  function metToken(): void {
    mkdirSync(path.dirname(paden.envPad), { recursive: true });
    writeFileSync(paden.envPad, `${TOKEN_SLEUTEL}=sk-nacht\n`, { mode: 0o600 });
  }

  it('installeert de globale bin uit de nieuwste tag en laadt de agent', () => {
    metToken();
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(machine());
    stelUitvoerderIn(uitvoerder);

    orkestreer({ installeer: true, paden });

    // De tag is de bron van waarheid over de laatste release, niet main's package.json.
    const install = aanroepen.find((a) => a.commando === 'npm' && a.argumenten[0] === 'install');
    expect(install?.argumenten[2]).toBe(
      'https://codeload.github.com/gjvv13/factory/tar.gz/refs/tags/v1.15.13',
    );
    // De bin komt uit de globale prefix en dus niet uit deze werkkopie in ~/Documents.
    // In de plist staat hij in het shellscript dat via /bin/sh -c draait.
    expect(readFileSync(paden.agentPad, 'utf8')).toContain('/opt/homebrew/bin/factory');
    // De plist bevat de install-stap vóór --nacht (#237).
    const plistInhoud = readFileSync(paden.agentPad, 'utf8');
    expect(plistInhoud).toContain('npm install -g');
    expect(plistInhoud).toContain('exec');
    expect(plistInhoud).toContain('orkestreer --nacht');
    // Ontladen vóór laden, zodat een tweede installatie geen dubbele agent oplevert.
    const launchctl = aanroepen
      .filter((a) => a.commando === 'launchctl')
      .map((a) => a.argumenten[0]);
    expect(launchctl).toEqual(['unload', 'load']);
  });

  it('is idempotent: twee keer installeren geeft dezelfde agent', () => {
    metToken();
    stelUitvoerderIn(maakUitvoerderOpnemer(machine()).uitvoerder);

    orkestreer({ installeer: true, paden });
    const eerste = readFileSync(paden.agentPad, 'utf8');
    orkestreer({ installeer: true, paden });

    expect(readFileSync(paden.agentPad, 'utf8')).toBe(eerste);
  });

  it('weigert te installeren zonder token, en laat dan niets achter', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(machine());
    stelUitvoerderIn(uitvoerder);

    // Een geladen agent zonder token draait vannacht een ronde die op niets uitloopt,
    // en dat merk je dan pas morgen.
    expect(() => {
      orkestreer({ installeer: true, paden });
    }).toThrow(/claude setup-token/);

    expect(existsSync(paden.agentPad)).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'launchctl')).toBe(false);
    // Het skelet staat er wel, met 0600, klaar om de token in te zetten.
    expect(statSync(paden.envPad).mode & 0o777).toBe(0o600);
  });

  it('weigert te installeren buiten de factory-repo', () => {
    metToken();
    const buiten: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'git' && aanroep.argumenten[0] === 'remote'
        ? { stdout: 'git@github.com:gjvv13/assistant.git\n' }
        : machine()(aanroep, index);
    stelUitvoerderIn(maakUitvoerderOpnemer(buiten).uitvoerder);

    // De globale bin komt uit de tags van dit repo; buiten de factory zou hij uit een
    // ander repo komen, of uit niets.
    expect(() => {
      orkestreer({ installeer: true, paden });
    }).toThrow(/factory-repo/);
  });

  it('slaat de install over als er al een even nieuwe globale factory staat', () => {
    metToken();
    mkdirSync(path.join(home, 'globaal', 'factory'), { recursive: true });
    const bepaal: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'npm' && aanroep.argumenten[0] === 'root'
        ? { stdout: path.join(home, 'globaal') }
        : machine()(aanroep, index);
    writeFileSync(
      path.join(home, 'globaal', 'factory', 'package.json'),
      JSON.stringify({ version: '1.15.13' }),
    );
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(bepaal);
    stelUitvoerderIn(uitvoerder);

    orkestreer({ installeer: true, paden });

    // Zo downgradet een oudere pin de gedeelde bin nooit — dezelfde regel als bij
    // `integreer --installeer`.
    expect(aanroepen.some((a) => a.commando === 'npm' && a.argumenten[0] === 'install')).toBe(
      false,
    );
    expect(uitvoer.join('')).toMatch(/staat al globaal/);
  });

  it('weigert een agent te plannen op een bin die --nacht niet kent', () => {
    metToken();
    const oudeBin: UitkomstBepaler = (aanroep, index) =>
      aanroep.argumenten[0] === 'help'
        ? { stdout: 'factory orkestreer <--dry|--eenmalig>\n' }
        : machine()(aanroep, index);
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(oudeBin);
    stelUitvoerderIn(uitvoerder);

    // De globale bin komt uit de nieuwste tag, en die loopt achter op de branch waarin
    // --nacht net gebouwd is. Zo'n agent ketst om 04:00 stil af.
    expect(() => {
      orkestreer({ installeer: true, paden });
    }).toThrow(/nog niet is/);

    expect(existsSync(paden.agentPad)).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'launchctl')).toBe(false);
  });

  it('verwijdert de agent, ook als hij er niet staat', () => {
    metToken();
    stelUitvoerderIn(maakUitvoerderOpnemer(machine()).uitvoerder);
    orkestreer({ installeer: true, paden });

    orkestreer({ verwijder: true, paden });
    expect(existsSync(paden.agentPad)).toBe(false);

    // Idempotent: een tweede keer verwijderen is een no-op en geen fout.
    expect(() => {
      orkestreer({ verwijder: true, paden });
    }).not.toThrow();
  });
});
