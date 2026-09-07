import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bouwNachtScript,
  bouwOrkestreerPlist,
  bouwPrompt,
  ciSamenvatting,
  eigenVersie,
  escalatieComment,
  leesEscalatie,
  orkestreer,
  orkestreerAntwoord,
  orkestreerStatus,
  veiligOpruimen,
} from '../src/commands/orkestreer.js';
import {
  boekRun,
  leesStaat,
  standaardPaden,
  TOKEN_SLEUTEL,
  type OrkestratorPaden,
} from '../src/orkestrator-instellingen.js';
import { herstelAsyncUitvoerder, herstelUitvoerder } from '../src/shell.js';
import {
  zetBeideUitvoerdersOp,
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
    data: {
      user: {
        projectV2: {
          appVeld: {
            options: [{ name: 'assistant' }, { name: 'beheer' }, { name: 'factory' }],
          },
          items: { pageInfo: { hasNextPage: false }, nodes: items },
        },
      },
    },
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
              { id: 'optie-wacht-akkoord', name: 'Wacht op akkoord' },
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
      const OPTIE_MAP: Record<string, string> = {
        'optie-technisch': 'Technisch refinen',
        'optie-wacht-akkoord': 'Wacht op akkoord',
        'optie-bouwen': 'Klaar voor Bouwen',
      };
      huidig = OPTIE_MAP[optie ?? ''] ?? 'Klaar voor technische refinement';
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
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('weigert --dry en --eenmalig samen', async () => {
    zetBeideUitvoerdersOp(bepaler());

    // Stil één van de twee kiezen laat iemand denken dat de run gestart is.
    await expect(
      orkestreer({ dry: true, eenmalig: true, werkplaatsWortel: wortel }),
    ).rejects.toThrow(/sluiten elkaar uit/);
  });

  it('richt de run met --issue op dat item in plaats van op de kop', async () => {
    zetBeideUitvoerdersOp(bepaler());

    await orkestreer({ dry: true, issue: 131, werkplaatsWortel: wortel });

    // De kop is #51 (9 aug); gevraagd is #131.
    const tekst = uitvoer.join('');
    expect(tekst).toContain('Zou nu draaien: #131');
    expect(tekst).not.toContain('Zou nu draaien: #51');
  });

  it('noemt de reden als het gevraagde item niet in de wachtrij staat', async () => {
    // `escalaties` draait `gh api … --jq '.[].number'`, dus de uitvoer is één nummer
    // per regel — niet de ruwe JSON.
    const escalatie = '119';
    const { aanroepen } = zetBeideUitvoerdersOp(bepaler({ escalaties: escalatie }));

    // #119 draagt escalatie, #77 staat in een andere kolom. Zonder deze meldingen zou
    // een gerichte vraag hetzelfde stille antwoord geven als een lege rij (#210).
    await expect(orkestreer({ dry: true, issue: 119, werkplaatsWortel: wortel })).rejects.toThrow(
      /label escalatie/,
    );
    await expect(orkestreer({ dry: true, issue: 77, werkplaatsWortel: wortel })).rejects.toThrow(
      /staat niet in de wachtrij/,
    );

    // Een geweigerde vraag kost geen werker.
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
  });

  it('weigert --issue samen met --nacht', async () => {
    zetBeideUitvoerdersOp(bepaler());

    // Een nachtrun draait tot het dagmaximum; op één item gericht zou hij na de eerste
    // ronde op de lus-vanger stuiten. Dan is de vlag een dure `--eenmalig`.
    await expect(orkestreer({ nacht: true, issue: 131, werkplaatsWortel: wortel })).rejects.toThrow(
      /gaan niet samen/,
    );
  });

  it('stopt als de escalatielijst niet gelezen kan worden', async () => {
    const basis = bepaler();
    const stuk: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'gh' &&
      aanroep.argumenten[0] === 'api' &&
      aanroep.argumenten[1] !== 'graphql'
        ? { code: 1 }
        : basis(aanroep, index);
    zetBeideUitvoerdersOp(stuk);

    // Een lege lijst bij een mislukte aanroep zou betekenen dat een item dat gisteren
    // een vraag stelde vandaag opnieuw draait — met kosten en zonder nieuwe informatie.
    await expect(orkestreer({ dry: true, werkplaatsWortel: wortel })).rejects.toThrow(
      /escalaties niet lezen/,
    );
  });

  it('zet het item terug in de wachtrij als de run omvalt', async () => {
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
    const { aanroepen } = zetBeideUitvoerdersOp(stuk);

    await expect(orkestreer({ eenmalig: true, werkplaatsWortel: wortel })).rejects.toThrow(
      /claude/,
    );

    // Twee verplaatsingen: naar Technisch refinen bij aanvang, en terug bij de val.
    // Zonder die tweede staat het item in geen enkele wachtrij meer.
    const verplaatsingen = aanroepen.filter((a) => a.argumenten[0] === 'project');
    expect(verplaatsingen).toHaveLength(2);
    expect(ghArgs(aanroepen).some((a) => a.includes('--add-label'))).toBe(false);
  });

  it('maakt het escalatielabel aan voordat het gebruikt wordt', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(bepaler({ werker: werkerMislukt() }));

    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    // `gh issue edit --add-label` faalt op een label dat niet bestaat, en labelen faalt
    // zacht: zonder dit zou een escalatie stil niet gemarkeerd worden.
    const maken = aanroepen.findIndex((a) => a.argumenten[0] === 'label');
    const zetten = aanroepen.findIndex((a) => a.argumenten.includes('--add-label'));
    expect(maken).toBeGreaterThanOrEqual(0);
    expect(zetten).toBeGreaterThan(maken);
  });

  it('--eenmalig draait opruimen niet (#422)', async () => {
    zetBeideUitvoerdersOp(bepaler());
    const opruimFn = vi.fn();

    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel, opruimFn });

    // Bij een los item is de overhead niet de moeite; opruimen hoort alleen na een
    // reeks of nacht.
    expect(opruimFn).not.toHaveBeenCalled();
  });

  it('doet niets zonder --dry of --eenmalig', async () => {
    zetBeideUitvoerdersOp(bepaler());

    // Een kaal commando dat tóch een werker start is precies de verrassing die je bij
    // onbemand werk niet wilt.
    await expect(orkestreer({ werkplaatsWortel: wortel })).rejects.toThrow(/--dry .* --eenmalig/);
  });

  it('toont de wachtrij oudste eerst, en laat alles buiten die kolom staan', async () => {
    zetBeideUitvoerdersOp(bepaler());

    await orkestreer({ dry: true, werkplaatsWortel: wortel });

    const tekst = uitvoer.join('');
    expect(tekst.indexOf('#51')).toBeLessThan(tekst.indexOf('#119'));
    expect(tekst.indexOf('#119')).toBeLessThan(tekst.indexOf('#131'));
    // #77 staat op Bouwen, #78 is gesloten: allebei niet aan de beurt.
    expect(tekst).not.toContain('#77');
    expect(tekst).not.toContain('#78');
  });

  it('schrijft niets bij --dry', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(bepaler());

    await orkestreer({ dry: true, werkplaatsWortel: wortel });

    // Geen werker, geen verplaatsing, geen comment, en geen werkplaats op schijf.
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'git')).toBe(false);
    expect(ghArgs(aanroepen).some((a) => a[0] === 'project' || a[0] === 'issue')).toBe(false);
    expect(existsSync(path.join(wortel, 'assistant'))).toBe(false);
  });

  it('slaat items zonder App-veld over, met een melding', async () => {
    const board = [
      boardItem(200, null, 'Klaar voor technische refinement', '2026-08-01T00:00:00Z'),
    ];
    zetBeideUitvoerdersOp(bepaler({ board }));

    await orkestreer({ dry: true, werkplaatsWortel: wortel });

    // Zonder App weet de werker niet wélke code hij moet lezen; stil overslaan zou
    // betekenen dat zo'n item nooit aan de beurt komt zonder dat iemand het merkt.
    expect(uitvoer.join('')).toMatch(/#200 heeft geen App-veld/);
  });

  it('slaat geëscaleerde items over', async () => {
    zetBeideUitvoerdersOp(bepaler({ escalaties: '51\n' }));

    await orkestreer({ dry: true, werkplaatsWortel: wortel });

    // Een item met escalatie wacht op een antwoord; opnieuw draaien geeft dezelfde
    // vraag en kost alleen geld.
    expect(uitvoer.join('')).not.toContain('#51');
    expect(uitvoer.join('')).toContain('#119');
  });

  it('leest het board precies één keer, ongeacht hoeveel items er in de wachtrij staan', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(bepaler());

    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    // Drie items in de wachtrij. Zou elke werker het board zelf opzoeken, dan kost
    // dat een kwart van het uurbudget om iets te vinden dat de supervisor al weet.
    expect(boardLezingen(aanroepen)).toBe(1);
  });

  it('werkt het oudste item af en zet het op Klaar voor Bouwen (#438)', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(bepaler());

    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    const claude = aanroepen.find((a) => a.commando === 'claude');
    expect(claude?.argumenten[1]).toContain('#51');
    expect(claude?.cwd).toBe(path.join(wortel, 'assistant'));
    // De uitwerking landt in de body van het issue…
    expect(ghArgs(aanroepen)).toContainEqual(
      expect.arrayContaining(['issue', 'edit', '51', '--body-file']),
    );
    // …en er komt precies één comment bij.
    expect(ghArgs(aanroepen).filter((a) => a[0] === 'issue' && a[1] === 'comment')).toHaveLength(1);
    // Schone body → Klaar voor Bouwen, niet Wacht op akkoord.
    const opties = aanroepen
      .filter((a) => a.argumenten[0] === 'project')
      .map((a) => a.argumenten[a.argumenten.indexOf('--single-select-option-id') + 1]);
    expect(opties).toContain('optie-bouwen');
  });

  it('zet een body met "wacht op #N" op Wacht op akkoord (#438)', async () => {
    const wachtVerdict = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: '5ad6e642-9e2a-4b4b-8af0-ecf40f956335',
      num_turns: 12,
      total_cost_usd: 1.25,
      result: 'zie verdict',
      structured_output: {
        uitkomst: 'klaar',
        samenvatting: 'Uitgewerkt maar wacht op iets.',
        slices: 2,
        body: '# Uitwerking\n\nDeze slice wacht op #100 (de API-laag).',
      },
      permission_denials: [],
    });
    const { aanroepen } = zetBeideUitvoerdersOp(bepaler({ werker: wachtVerdict }));

    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    const opties = aanroepen
      .filter((a) => a.argumenten[0] === 'project')
      .map((a) => a.argumenten[a.argumenten.indexOf('--single-select-option-id') + 1]);
    // Eerst naar Technisch refinen (begin werkAf), dan naar Wacht op akkoord (rondAf).
    expect(opties).toContain('optie-wacht-akkoord');
    expect(opties).not.toContain('optie-bouwen');
  });

  it('rekent een run met is_error als mislukt, ook bij exitcode 0', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(bepaler({ werker: werkerMislukt() }));

    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    // Geen nieuwe body: er ís geen uitwerking. Wel een escalatie, zodat dezelfde fout
    // niet elke nacht opnieuw draait.
    expect(ghArgs(aanroepen).some((a) => a.includes('--body-file'))).toBe(false);
    expect(ghArgs(aanroepen)).toContainEqual(
      expect.arrayContaining(['issue', 'edit', '51', '--add-label', 'escalatie']),
    );
  });

  it('stopt als er al een run bezig is', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(bepaler());

    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel });
    // Het slot van de vorige run is vrijgegeven; zet er handmatig een neer alsof er
    // nog iets draait.
    const tweede = zetBeideUitvoerdersOp(bepaler());
    closeSync(openSync(LOCK_PAD, 'wx'));

    await expect(orkestreer({ eenmalig: true, werkplaatsWortel: wortel })).rejects.toThrow(
      /draait al een orkestrator-run/,
    );
    expect(tweede.aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(true);
  });

  it('geeft het slot ook vrij als de run onderweg omvalt', async () => {
    const basis = bepaler();
    const stuk: UitkomstBepaler = (aanroep, index) =>
      // De werkplaats klonen mislukt; dat gooit, halverwege werkAf.
      aanroep.commando === 'gh' && aanroep.argumenten[0] === 'repo'
        ? { code: 1 }
        : basis(aanroep, index);
    zetBeideUitvoerdersOp(stuk);

    await expect(orkestreer({ eenmalig: true, werkplaatsWortel: wortel })).rejects.toThrow();

    // Blijft het slot liggen, dan staat de rij een uur stil op een run die al klaar is.
    expect(existsSync(LOCK_PAD)).toBe(false);
  });

  it('schrijft het pid in het slotbestand', async () => {
    zetBeideUitvoerdersOp(bepaler());
    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

    // Na een geslaagde run is het slot weg; check dat een nieuw slot het pid bevat door
    // een tweede run te starten die het slot laat staan (via een crash vóór geefLockVrij).
    const stuk: UitkomstBepaler = (aanroep) =>
      aanroep.commando === 'gh' && aanroep.argumenten[0] === 'repo'
        ? { code: 1 }
        : bepaler()(aanroep, 0);
    zetBeideUitvoerdersOp(stuk);

    // Draai een run die halverwege omvalt — het slot wordt alsnog vrijgegeven (finally).
    // We moeten dus vóór geefLockVrij het bestand lezen. Doe dat via een succesvolle run
    // en lees het bestand terwijl het slot er nog is — maar het slot wordt vrijgegeven in
    // een finally. Alternatief: het slot staat er direct na neemLock. Creëer het handmatig
    // en kijk of neemLock het vult.
    // Eenvoudiger: het bestand wordt met `writeFileSync(LOCK_PAD, String(process.pid))`
    // geschreven. Kijk of een vers genomen slot dat pid bevat door het slot handmatig
    // leeg te maken en dan te checken of neemLock het opruimt en een nieuw slot neerzet.
    // Nog eenvoudiger: we weten dat een succesvolle run het slot weer weghaalt. Maar de
    // test hierboven ('stopt als er al een run bezig is') bewees al dat neemLock faalt als
    // het slot er is. Hier testen we de inhoud.
    //
    // Strategie: neem het lock via een succesvolle run, lees het lock-bestand na neemLock
    // maar vóór geefLockVrij. Dat kan niet van buitenaf. Maar we kunnen testen dat een
    // verlopen slot met ons eigen pid (dat leeft!) NIET opgeruimd wordt.
    writeFileSync(LOCK_PAD, String(process.pid));
    // Verleg de mtime naar het verleden zodat het slot "verlopen" is.
    const oud = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(LOCK_PAD, oud, oud);

    // neemLock zou het slot normaal opruimen (het is verlopen), maar het pid leeft — dus
    // het mag er niet aan komen.
    await expect(orkestreer({ eenmalig: true, werkplaatsWortel: wortel })).rejects.toThrow(
      /draait al een orkestrator-run/,
    );
    expect(existsSync(LOCK_PAD)).toBe(true);
    expect(readFileSync(LOCK_PAD, 'utf-8').trim()).toBe(String(process.pid));
  });

  it('ruimt een verlopen slot op waarvan het pid dood is', async () => {
    // Gebruik een pid dat zeker niet bestaat. pid 2_000_000 is ver boven het macOS/Linux-
    // maximum en kan geen lopend proces zijn.
    const doodPid = 2_000_000;
    writeFileSync(LOCK_PAD, String(doodPid));
    const oud = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(LOCK_PAD, oud, oud);

    zetBeideUitvoerdersOp(bepaler());
    // neemLock ziet een verlopen slot met een dood pid → ruimt op → neemt het slot.
    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel });
    const tekst = uitvoer.join('');
    expect(tekst).toContain(`oud slot van pid ${String(doodPid)} opgeruimd`);
  });

  it('valt terug op leeftijd bij een leeg slotbestand (oude versie)', async () => {
    // Een slot zonder pid (van vóór deze wijziging) dat verlopen is.
    closeSync(openSync(LOCK_PAD, 'wx'));
    const oud = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(LOCK_PAD, oud, oud);

    zetBeideUitvoerdersOp(bepaler());
    // Leeg bestand, verlopen → opruimen op leeftijd, zoals voorheen.
    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel });
    // De run slaagt: het slot werd opgeruimd en opnieuw genomen.
    expect(uitvoer.join('')).not.toContain('draait al een orkestrator-run');
  });

  it('meldt het pid in de foutmelding als het slot er is', async () => {
    writeFileSync(LOCK_PAD, String(process.pid));
    zetBeideUitvoerdersOp(bepaler());

    await expect(orkestreer({ eenmalig: true, werkplaatsWortel: wortel })).rejects.toThrow(
      new RegExp(`pid ${String(process.pid)} leeft nog`),
    );
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

  it('leest een bouw-escalatie met soort en app terug (#306)', () => {
    const comment = escalatieComment(
      224,
      'Async of sync?',
      'Async — het blokkeert anders.',
      UITKOMST,
      '/w/assistant-wt/224',
      'bouw',
      'assistant',
    );
    const terug = leesEscalatie(comment);

    expect(terug?.soort).toBe('bouw');
    expect(terug?.app).toBe('assistant');
    expect(terug?.vraag).toBe('Async of sync?');
    expect(terug?.advies).toBe('Async — het blokkeert anders.');
    expect(terug?.sessie).toBe(UITKOMST.sessie);
    expect(terug?.werkmap).toBe('/w/assistant-wt/224');
  });

  it('leest oude comments zonder soort als refine (backwards-compatibiliteit)', () => {
    // Vóór #306 stond er geen `soort` of `app` in de marker.
    const comment = escalatieComment(94, 'v', 'a', UITKOMST, '/w/assistant');
    const terug = leesEscalatie(comment);

    expect(terug?.soort).toBe('refine');
    expect(terug?.app).toBeUndefined();
  });

  it('bevat het antwoord-commando ook bij een bouw-escalatie', () => {
    expect(escalatieComment(224, 'v', 'a', UITKOMST, '/w', 'bouw', 'assistant')).toContain(
      'factory orkestreer antwoord 224',
    );
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
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('zet een geëscaleerd item terug in de wachtrij-kolom, met het label', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(bepaler({ werker: werkerEscaleert() }));

    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

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

  it('schrijft de vraag en het advies in de comment', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(bepaler({ werker: werkerEscaleert() }));

    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel });

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
    boardItem(200, 'factory', 'Wacht op akkoord', '2026-08-20T00:00:00Z'),
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
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('toont de drie dagtellers van vandaag (#264, #343)', () => {
    zetBeideUitvoerdersOp(statusBepaler);
    const nu = new Date(Date.now());
    boekRun(statusPaden, nu, 'nacht');
    boekRun(statusPaden, nu, 'nacht-bouw');
    boekRun(statusPaden, nu, 'interactief');
    boekRun(statusPaden, nu, 'interactief');

    orkestreerStatus('/repo', { paden: statusPaden });

    // Zonder deze regels zie je de nachtpot pas leeg als de nacht meldt dat hij niets doet.
    const tekst = uitvoer.join('');
    expect(tekst).toMatch(/nacht refine:\s+1\/4/);
    expect(tekst).toMatch(/nacht bouw:\s+1\/2/);
    expect(tekst).toMatch(/zelf gestart:\s+2/);
  });

  it('toont vier blokken en zet elk item in precies één (#438)', () => {
    zetBeideUitvoerdersOp(statusBepaler);

    orkestreerStatus('/repo', { paden: statusPaden });

    const tekst = uitvoer.join('');
    // #51 is geëscaleerd: hij staat wel in de wachtrij-kolom, maar hoort in het
    // escalatie-blok en niet in de rij — anders lijkt het alsof hij zo aan de beurt is.
    expect(tekst).toMatch(/wacht op jouw akkoord \(1\)/);
    expect(tekst).toMatch(/wacht op een antwoord \(1\)/);
    // De nieuwe Wacht op akkoord-kolom (#438).
    expect(tekst).toMatch(/Wacht op akkoord \(1\)/);
    expect(tekst).toContain('#200');
    expect(tekst).toMatch(/Klaar voor technische refinement \(1\)/);
    expect(tekst.indexOf('#96')).toBeLessThan(tekst.indexOf('#51'));
    expect(tekst.indexOf('#51')).toBeLessThan(tekst.indexOf('#119'));
  });

  it('toont bij een escalatie de vraag, het advies en hoe je antwoordt', () => {
    zetBeideUitvoerdersOp(statusBepaler);

    orkestreerStatus('/repo', { paden: statusPaden });

    const tekst = uitvoer.join('');
    expect(tekst).toContain('WASM of native crypto-SDK?');
    expect(tekst).toContain('geen native compilatie');
    expect(tekst).toContain('factory orkestreer antwoord 51');
  });

  it('toont ook een bouw-escalatie met de vraag en het antwoord-commando (#306)', () => {
    const BOUW_ESCALATIE = escalatieComment(
      51,
      'Async of sync?',
      'Async — blokkeert anders.',
      {
        afloop: 'escalatie' as const,
        sessie: 'bouw-esc-1',
        kosten: 2.0,
        beurten: 10,
        weigeringen: 0,
      },
      '/w/assistant-wt/51',
      'bouw',
      'assistant',
    );
    const metBouw: UitkomstBepaler = (aanroep, index) =>
      aanroep.argumenten[1]?.includes('/comments') === true
        ? { stdout: commentsAntwoord([BOUW_ESCALATIE]) }
        : statusBepaler(aanroep, index);
    zetBeideUitvoerdersOp(metBouw);

    orkestreerStatus('/repo', { paden: statusPaden });

    const tekst = uitvoer.join('');
    expect(tekst).toContain('Async of sync?');
    expect(tekst).toContain('Async — blokkeert anders.');
    expect(tekst).toContain('factory orkestreer antwoord 51');
  });

  it('zegt het als een escalatie geen leesbare comment heeft', () => {
    const zonder: UitkomstBepaler = (aanroep, index) =>
      aanroep.argumenten[1]?.includes('/comments') === true
        ? { stdout: commentsAntwoord(['alleen menselijke tekst']) }
        : statusBepaler(aanroep, index);
    zetBeideUitvoerdersOp(zonder);

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
    herstelAsyncUitvoerder();
    vi.restoreAllMocks();
  });

  it('hervat de sessie in de werkmap uit de comment', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(antwoordBepaler());

    await orkestreerAntwoord('51', 'doe WASM', {}, '/repo');

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

  it('haalt het escalatie-label weg zodra er een uitwerking staat', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(antwoordBepaler());

    await orkestreerAntwoord('51', 'doe WASM', {}, '/repo');

    expect(ghArgs(aanroepen)).toContainEqual(
      expect.arrayContaining(['issue', 'edit', '51', '--body-file']),
    );
    expect(ghArgs(aanroepen)).toContainEqual(
      expect.arrayContaining(['issue', 'edit', '51', '--remove-label', 'escalatie']),
    );
  });

  it('begint met --opnieuw een verse sessie mét de volledige opdracht', async () => {
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
    const { aanroepen } = zetBeideUitvoerdersOp(metBoard);

    await orkestreerAntwoord(
      '51',
      'doe WASM',
      { opnieuw: true, werkplaatsWortel: wortel },
      '/repo',
    );
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

  it('zegt het als de sessie niet meer te hervatten is, en biedt een verse run aan', async () => {
    // Gemeten: een onbekende sessie geeft platte tekst met exit 1, geen JSON.
    const weg: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude'
        ? { code: 1, stdout: 'No conversation found with session ID: 5ad6e642-…' }
        : antwoordBepaler()(aanroep, index);
    zetBeideUitvoerdersOp(weg);

    // Niet stil falen: er staat letterlijk wat je nu moet doen.
    await expect(orkestreerAntwoord('51', 'doe WASM', {}, '/repo')).rejects.toThrow(/--opnieuw/);
  });

  it('vindt de escalatie ook als er daarna nog een comment kwam', async () => {
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
    const { aanroepen } = zetBeideUitvoerdersOp(naEscalatie);

    await orkestreerAntwoord('51', 'doe WASM', {}, '/repo');

    // De mislukt-comment draagt ook de sessie-markering maar geen vraag; alleen naar
    // de laatste kijken zou de vraag een comment hoger onvindbaar maken.
    const claude = aanroepen.find((a) => a.commando === 'claude');
    expect(claude?.argumenten[1]).toBe('5ad6e642-9e2a-4b4b-8af0-ecf40f956335');
  });

  it('weigert een issue zonder escalatie-comment', async () => {
    const leeg: UitkomstBepaler = ({ commando, argumenten }) =>
      commando === 'gh' && argumenten[1]?.includes('/comments') === true
        ? { stdout: Buffer.from('[]', 'utf8').toString('base64') }
        : {};
    zetBeideUitvoerdersOp(leeg);

    await expect(orkestreerAntwoord('51', 'doe WASM', {}, '/repo')).rejects.toThrow(
      /Geen escalatie gevonden/,
    );
  });

  it('stopt op het lock, net als een gewone run', async () => {
    closeSync(openSync(LOCK_PAD, 'wx'));
    const { aanroepen } = zetBeideUitvoerdersOp(antwoordBepaler());

    // Twee antwoorden tegelijk hervatten dezelfde sessie en schrijven allebei een body
    // en een comment; de laatste wint en je houdt een dubbele comment over.
    await expect(orkestreerAntwoord('51', 'doe WASM', {}, '/repo')).rejects.toThrow(
      /draait al een orkestrator-run/,
    );
    expect(aanroepen.some((a) => a.commando === 'claude')).toBe(false);
    rmSync(LOCK_PAD, { force: true });
  });

  it('weigert een aanroep zonder nummer of tekst', async () => {
    zetBeideUitvoerdersOp();

    await expect(orkestreerAntwoord('51', '  ', {}, '/repo')).rejects.toThrow(
      /Gebruik: factory orkestreer antwoord/,
    );
  });

  it('hervat een bouw-escalatie met het bouw-schema en schrijft een nieuwe escalatie-comment (#306)', async () => {
    // De werker escaleert opnieuw — zo toetsen we de routing zonder het hele
    // inleverpad te moeten mocken.
    const BOUW_ESCALATIE = escalatieComment(
      51,
      'Async of sync?',
      'Async.',
      {
        afloop: 'escalatie' as const,
        sessie: 'bouw-sessie-1234',
        kosten: 2.0,
        beurten: 10,
        weigeringen: 0,
      },
      '/w/assistant-wt/51',
      'bouw',
      'assistant',
    );
    const bouwBepaler: UitkomstBepaler = ({ commando, argumenten }) => {
      if (commando === 'claude') return { stdout: werkerEscaleert() };
      if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1]?.includes('/comments')) {
        return { stdout: commentsAntwoord([BOUW_ESCALATIE]) };
      }
      if (commando === 'gh' && argumenten[1] === 'graphql') {
        return { stdout: doelwitAntwoord('Klaar voor Bouwen') };
      }
      return {};
    };
    const { aanroepen } = zetBeideUitvoerdersOp(bouwBepaler);
    const wortel = mkdtempSync(path.join(os.tmpdir(), 'factory-bouw-antw-'));

    await orkestreerAntwoord('51', 'doe async', { werkplaatsWortel: wortel }, '/repo');
    rmSync(wortel, { recursive: true, force: true });

    // De `claude`-aanroep hervat de bestaande sessie.
    const claude = aanroepen.find((a) => a.commando === 'claude');
    expect(claude?.argumenten[0]).toBe('--resume');
    expect(claude?.argumenten[1]).toBe('bouw-sessie-1234');
    // Het schema bevat `criteria` (bouw), niet `slices` (refine).
    const schemaArg = claude?.argumenten[claude.argumenten.indexOf('--json-schema') + 1] ?? '';
    expect(schemaArg).toContain('criteria');
    expect(schemaArg).not.toContain('"slices"');
    // De nieuwe escalatie-comment heeft de bouw-markers.
    const comment = aanroepen.find((a) => a.argumenten[1] === 'comment')?.argumenten.at(-1) ?? '';
    const terug = leesEscalatie(comment);
    expect(terug?.soort).toBe('bouw');
    expect(terug?.app).toBe('assistant');
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
    herstelAsyncUitvoerder();
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

  it('boekt en logt een run die met de hand gestart is', async () => {
    zetBeideUitvoerdersOp(bepaler());

    // Tot #264 zat boeken en loggen in de nacht-lus: een `--eenmalig`-run telde niet mee
    // in het dagmaximum en liet geen spoor na. Toen de teller vol zat werkte de wachtrij
    // zich met losse aanroepen verder af — de geldrem was te omzeilen zonder omzeilen.
    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel, paden });

    expect(leesStaat(paden, new Date(Date.now())).interactief).toBe(1);
    const regels = runRegels();
    expect(regels).toHaveLength(1);
    expect(regels[0]).toMatch(/#51 assistant refine klaar/);
  });

  it('noemt de soort in de logregel', async () => {
    zetBeideUitvoerdersOp(bepaler());

    await orkestreer({ eenmalig: true, werkplaatsWortel: wortel, paden });

    // Een gemiddelde over refine en bouw door elkaar zegt niets: $5 budget tegen $10.
    expect(runRegels()[0]).toContain(' refine ');
  });

  it('logt ook een run die omvalt, met de reden', async () => {
    const basis = bepaler();
    const stuk: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude'
        ? { code: 1, stdout: '', startfout: 'spawn claude ENOENT' }
        : basis(aanroep, index);
    zetBeideUitvoerdersOp(stuk);

    await expect(orkestreer({ eenmalig: true, werkplaatsWortel: wortel, paden })).rejects.toThrow(
      /claude/,
    );

    // Een teller op 1 met een leeg log is precies de stilte die je niet kunt lezen.
    expect(leesStaat(paden, new Date(Date.now())).interactief).toBe(1);
    expect(runRegels()[0]).toMatch(/#51 assistant refine afgebroken/);
  });

  it('boekt en logt niets bij --dry', async () => {
    zetBeideUitvoerdersOp(bepaler());

    await orkestreer({ dry: true, werkplaatsWortel: wortel, paden });

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
    herstelAsyncUitvoerder();
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

  it('--reeks doet het gevraagde aantal, buiten het dagmaximum om (#265)', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    // Dagmaximum 2 in het instellingenbestand, en toch drie runs: op wat jij zelf start
    // staat geen maximum, want dat aantal geef je hier mee. De nachtpot blijft leeg.
    await orkestreer({
      reeks: { soort: 'aantal', aantal: 3 },
      werkplaatsWortel: wortel,
      paden,
      nu: NU,
    });

    expect(claudeAanroepen(aanroepen)).toHaveLength(3);
    const staat = leesStaat(paden, NU);
    expect(staat.interactief).toBe(3);
    expect(staat.gestart).toBe(0);
  });

  it('--reeks geeft elke run dezelfde tijdslimiet als de nacht', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    await orkestreer({
      reeks: { soort: 'aantal', aantal: 2 },
      werkplaatsWortel: wortel,
      paden,
      nu: NU,
    });

    // Een hangende werker in een reeks van vier is even duur als een hangende werker om
    // 04:00 (#206); zonder deze grens loopt hij door tot iemand hem stopt.
    for (const aanroep of claudeAanroepen(aanroepen)) {
      expect(aanroep.timeoutMs).toBe(30 * 60 * 1000);
    }
  });

  it('--reeks gaat door na één mislukte run', async () => {
    const bord = nachtBord(WACHTRIJ);
    let claudes = 0;
    const eersteMislukt: UitkomstBepaler = (aanroep, index) => {
      if (aanroep.commando === 'claude') {
        claudes += 1;
        if (claudes === 1) return { stdout: werkerMislukt() };
      }
      return bord(aanroep, index);
    };
    const { aanroepen } = zetBeideUitvoerdersOp(eersteMislukt);

    await orkestreer({
      reeks: { soort: 'aantal', aantal: 3 },
      werkplaatsWortel: wortel,
      paden,
      nu: NU,
    });

    // Eén escalatie is gewoon werk en kost alleen dat item — de les van #202.
    expect(claudeAanroepen(aanroepen)).toHaveLength(3);
  });

  it('--reeks stopt na twee mislukte runs op rij, met de reden', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(nachtBord(WACHTRIJ, { werker: werkerMislukt() }));

    await orkestreer({
      reeks: { soort: 'aantal', aantal: 3 },
      werkplaatsWortel: wortel,
      paden,
      nu: NU,
    });

    // Twee achter elkaar betekent dat de machine zelf stuk is; doorgaan is dan geld
    // weggooien. Wel luid, want dit is een andere uitkomst dan "de rij is leeg".
    expect(claudeAanroepen(aanroepen)).toHaveLength(2);
    expect(uitvoer.join('')).toMatch(/twee runs op rij mislukt/);
  });

  it('--reeks sluit af met wat er gedaan is en wat het kostte', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    await orkestreer({
      reeks: { soort: 'aantal', aantal: 2 },
      werkplaatsWortel: wortel,
      paden,
      nu: NU,
    });

    expect(uitvoer.join('')).toMatch(/reeks klaar: 2 gedaan, 2 geslaagd, \$\d+\.\d\d/);
  });

  it('--reeks draait opruimen na afloop (#422)', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));
    const opruimFn = vi.fn();

    await orkestreer({
      reeks: { soort: 'aantal', aantal: 2 },
      werkplaatsWortel: wortel,
      paden,
      nu: NU,
      opruimFn,
    });

    expect(opruimFn).toHaveBeenCalledOnce();
  });

  it('--nacht draait opruimen na afloop (#422)', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));
    const opruimFn = vi.fn();

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU, opruimFn });

    expect(opruimFn).toHaveBeenCalledOnce();
  });

  it('een fout in opruimen verandert de reeks-uitkomst niet (#422)', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));
    const opruimFn = vi.fn(() => {
      throw new Error('git fetch mislukt');
    });

    // De run slaagt ondanks de fout in opruimen.
    await orkestreer({
      reeks: { soort: 'aantal', aantal: 2 },
      werkplaatsWortel: wortel,
      paden,
      nu: NU,
      opruimFn,
    });

    expect(opruimFn).toHaveBeenCalledOnce();
    // De fout wordt gelogd als waarschuwing.
    expect(uitvoer.join('')).toContain('opruimen mislukt');
  });

  it('stopt bij het dagmaximum, ook al staan er meer items in de rij', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Dagmaximum 2 uit het instellingenbestand; de wachtrij heeft er drie.
    expect(claudeAanroepen(aanroepen)).toHaveLength(2);
    expect(leesStaat(paden, NU).gestart).toBe(2);
  });

  it('deelt dat maximum met een tweede run op dezelfde kalenderdag', async () => {
    const eerste = zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));
    await orkestreer({
      nacht: true,
      werkplaatsWortel: wortel,
      paden,
      nu: new Date('2026-08-19T04:00:00'),
    });
    expect(claudeAanroepen(eerste.aanroepen)).toHaveLength(2);

    const tweede = zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));
    rmSync(LOCK_PAD, { force: true });
    await orkestreer({
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

  it('begint na een dagovergang weer bij nul', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));
    await orkestreer({
      nacht: true,
      werkplaatsWortel: wortel,
      paden,
      nu: new Date('2026-08-19T04:00:00'),
    });

    const morgen = zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));
    rmSync(LOCK_PAD, { force: true });
    await orkestreer({
      nacht: true,
      werkplaatsWortel: wortel,
      paden,
      nu: new Date('2026-08-20T04:00:00'),
    });

    // Anders zou de orkestrator na één volle nacht nooit meer draaien.
    expect(claudeAanroepen(morgen.aanroepen)).toHaveLength(2);
  });

  it('stopt zodra de wachtrij leeg is, en leest die rij per ronde opnieuw', async () => {
    const eenItem = [
      boardItem(131, 'factory', 'Klaar voor technische refinement', '2026-08-01T00:00:00Z'),
    ];
    const { aanroepen } = zetBeideUitvoerdersOp(nachtBord(eenItem));

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Eén item, dus één werker — en niet twee keer hetzelfde item omdat de lijst van
    // vóór de eerste run nog in het geheugen zat.
    expect(claudeAanroepen(aanroepen)).toHaveLength(1);
    expect(boardLezingen(aanroepen)).toBeGreaterThan(1);
    expect(uitvoer.join('')).toMatch(/wachtrij leeg/);
  });

  it('geeft het budget uit de instellingen mee en de token buiten de plist om', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    const eerste = claudeAanroepen(aanroepen)[0];
    expect(eerste?.argumenten[eerste.argumenten.indexOf('--max-budget-usd') + 1]).toBe('3');
    // De token reist als omgevingsvariabele mee; hij staat nergens in de argumenten,
    // want die zijn zichtbaar in `ps`.
    expect(eerste?.env?.[TOKEN_SLEUTEL]).toBe('sk-nacht');
    expect(eerste?.argumenten.join(' ')).not.toContain('sk-nacht');
  });

  it('schrijft per run een regel met issue, uitkomst, kosten en beurten', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Zonder eigen logregels zou alleen de stdout van launchd iets vastleggen, en dan
    // legt een handmatige run niets vast.
    const log = readFileSync(paden.logPad, 'utf8');
    expect(log).toMatch(/#51 assistant refine klaar \$1\.25 12 beurten/);
    // Drie regels: de startregel met de versie (#237), en twee runregels.
    expect(log.trim().split('\n')).toHaveLength(3);
  });

  it('telt een run mee die niet oplevert wat hij moest opleveren', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ, { werker: werkerMislukt() }));

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Een teller die alleen geslaagde runs telt is geen rem: een kapot item zou de
    // hele nacht opnieuw mogen draaien. En een mislukking is een escalatie, dus het
    // item wordt niet vannacht nog eens gepakt.
    expect(leesStaat(paden, NU).gestart).toBe(2);
    expect(readFileSync(paden.logPad, 'utf8')).toMatch(/#51 assistant refine mislukt/);
  });

  it('laat een run die zijn budget opmaakt als escalatie achter', async () => {
    // De echte, opgenomen envelop van een budget-afkapping (`subtype:
    // error_max_budget_usd`, exit 1). Zonder deze weg zou een item dat elke nacht zijn
    // budget opmaakt elke nacht opnieuw geld kosten.
    const opgenomen = readFileSync(fixture('claude-run-fout.json'), 'utf8');
    const budgetOp: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude'
        ? { code: 1, stdout: opgenomen }
        : nachtBord(WACHTRIJ, { werker: opgenomen })(aanroep, index);
    const { aanroepen } = zetBeideUitvoerdersOp(budgetOp);

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    const label = ghArgs(aanroepen).find((a) => a.includes('--add-label'));
    expect(label).toContain('escalatie');
    expect(readFileSync(paden.logPad, 'utf8')).toMatch(/#51 assistant refine mislukt \$0\.10/);
  });

  it('slaat een item over dat na zijn run nog in de wachtrij staat, en gaat door met de rest', async () => {
    // `zetKolom` faalt zacht — een board-hik of een leeg GraphQL-budget is genoeg — en dan
    // blijft het item staan. Hetzelfde issue twee keer refinen is twee keer betalen voor
    // één uitwerking, dus overslaan; maar de rest van de nacht hoort door te gaan (#202).
    const basis = nachtBord(WACHTRIJ);
    const bordBlijftStaan: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude'
        ? { stdout: werkerKlaar() } // geen verzet: het item blijft in de wachtrij staan
        : basis(aanroep, index);
    const { aanroepen } = zetBeideUitvoerdersOp(bordBlijftStaan);

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Twee runs (het dagmaximum), op twee verschillende items: geen herhaling, geen stop.
    const gedraaid = claudeAanroepen(aanroepen).map(
      (a) => /- Issue: \*\*#(\d+)\*\*/.exec(a.argumenten.join('\n'))?.[1],
    );
    expect(gedraaid).toHaveLength(2);
    expect(new Set(gedraaid).size).toBe(2);
    expect(uitvoer.join('')).toMatch(/overgeslagen voor vannacht/);
    expect(uitvoer.join('')).not.toMatch(/gestopt om een lus te voorkomen/);
  });

  it('gaat door met de rij als het eerste item escaleert en de escalatielijst achterloopt', async () => {
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
    const { aanroepen } = zetBeideUitvoerdersOp(achterlopend);

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Het geëscaleerde item wordt overgeslagen, niet herhaald, en de nacht gaat door.
    const gedraaid = claudeAanroepen(aanroepen).map(
      (a) => /- Issue: \*\*#(\d+)\*\*/.exec(a.argumenten.join('\n'))?.[1],
    );
    expect(gedraaid).toHaveLength(2);
    expect(new Set(gedraaid).size).toBe(2);
    expect(uitvoer.join('')).toMatch(/overgeslagen voor vannacht/);
  });

  it('laat een overgeslagen item de dagteller niet verhogen', async () => {
    const basis = nachtBord(WACHTRIJ);
    const bordBlijftStaan: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude' ? { stdout: werkerKlaar() } : basis(aanroep, index);
    zetBeideUitvoerdersOp(bordBlijftStaan);

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Twee runs, dus de teller staat op 2 — niet op 3 doordat de overslag ook meetelde.
    expect(uitvoer.join('')).toMatch(/2\/2 van vannacht gedaan/);
    expect(uitvoer.join('')).not.toMatch(/3\/2/);
  });

  it('gaat na een afgekapte run door met het volgende item', async () => {
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
    const { aanroepen } = zetBeideUitvoerdersOp(kaptEersteAf);

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Twee runs: de afgekapte en de volgende. Zonder deze slice stopte de nacht hier.
    expect(claudeAanroepen(aanroepen)).toHaveLength(2);
    // De afkapping staat in het log, met de reden erin.
    // Zoals de uitwerking hem voorschrijft: "#93 beheer afgekapt (30 min)".
    expect(readFileSync(paden.logPad, 'utf8')).toMatch(/#\d+ \w+ refine afgekapt \(30 min\)/);
    // En het item is geëscaleerd, niet stil overgeslagen.
    const label = ghArgs(aanroepen).find((a) => a.includes('--add-label'));
    expect(label).toContain('escalatie');
  });

  it('boekt en logt een run die de CLI omvertrekt, en stopt na twee zulke op rij', async () => {
    // `claude` is niet te starten: `run` gooit een GebruikersFout. Sinds #282 laat de
    // reeks één zulke run niet de hele nacht kosten — hij boekt en logt hem (de stilte
    // die je 's ochtends niet kunt lezen is precies wat we vermijden) en gaat door. Twee
    // op rij is wél het signaal dat de machine stuk is; dán stopt de nacht.
    const basis = nachtBord(WACHTRIJ);
    const geenClaude: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'claude'
        ? { code: 1, stdout: '', startfout: 'spawn claude ENOENT' }
        : basis(aanroep, index);
    zetBeideUitvoerdersOp(geenClaude);

    // Geen throw meer: de noodstop vangt het, netjes.
    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    expect(readFileSync(paden.logPad, 'utf8')).toMatch(/#\d+ \w+ refine afgebroken/);
    // Twee geboekte runs (de twee mislukte starts), daarna de noodstop.
    expect(leesStaat(paden, NU).gestart).toBe(2);
    expect(uitvoer.join('')).toMatch(/twee runs op rij mislukt/);
  });

  it('geeft elke runregel zijn eigen tijdstempel', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // Drie regels: de startregel en twee runs. De runregels hebben elk hun eigen
    // tijdstempel; twee gelijke stempels zeggen niets over hoe lang een run duurde.
    const regels = readFileSync(paden.logPad, 'utf8').trim().split('\n');
    expect(regels).toHaveLength(3);
    const runStempels = regels.slice(1).map((regel) => regel.split(' ')[0]);
    expect(runStempels[0]).not.toBe(NU.toISOString());
  });

  it('logt met welke versie de nacht draaide (#237)', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });

    // De eerste logregel vermeldt de factory-versie, zodat je 's ochtends ziet of het
    // bijwerken gewerkt heeft.
    const log = readFileSync(paden.logPad, 'utf8');
    expect(log).toMatch(/nacht gestart \(factory \d+\.\d+\.\d+/);
  });

  it('logt een waarschuwing bij een versie-mismatch met FACTORY_VERWACHTE_VERSIE (#332)', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    // Simuleer een mislukte zelf-update: de env var zegt welke versie verwacht werd,
    // maar de draaiende bin is een andere.
    const vorige = process.env['FACTORY_VERWACHTE_VERSIE'];
    process.env['FACTORY_VERWACHTE_VERSIE'] = '99.99.99';
    try {
      await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });
    } finally {
      if (vorige === undefined) {
        delete process.env['FACTORY_VERWACHTE_VERSIE'];
      } else {
        process.env['FACTORY_VERWACHTE_VERSIE'] = vorige;
      }
    }

    // De waarschuwing verschijnt in de uitvoer en in het log.
    expect(uitvoer.join('')).toContain('de zelf-update is mislukt');
    const log = readFileSync(paden.logPad, 'utf8');
    expect(log).toContain('WARNING');
    expect(log).toContain('verwacht 99.99.99');
    expect(log).toContain('de zelf-update is mislukt');
  });

  it('logt geen waarschuwing als FACTORY_VERWACHTE_VERSIE niet gezet is (#332)', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    // Zonder de env var (handmatige run, of tag-ophaal mislukt) is er niets te vergelijken.
    const vorige = process.env['FACTORY_VERWACHTE_VERSIE'];
    delete process.env['FACTORY_VERWACHTE_VERSIE'];
    try {
      await orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU });
    } finally {
      if (vorige !== undefined) {
        process.env['FACTORY_VERWACHTE_VERSIE'] = vorige;
      }
    }

    expect(uitvoer.join('')).not.toContain('de zelf-update is mislukt');
  });

  it('weigert onbemand te draaien zonder token, met het recept erbij', async () => {
    writeFileSync(paden.envPad, 'FACTORY_DAGMAXIMUM=2\n', { mode: 0o600 });
    const { aanroepen } = zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    await expect(
      orkestreer({ nacht: true, werkplaatsWortel: wortel, paden, nu: NU }),
    ).rejects.toThrow(/claude setup-token/);

    // En vóórdat er een item uit de wachtrij is gehaald: geen kolom verzet, geen werker.
    expect(aanroepen).toHaveLength(0);
  });

  it('weigert --nacht samen met --dry', async () => {
    zetBeideUitvoerdersOp(nachtBord(WACHTRIJ));

    await expect(
      orkestreer({ nacht: true, dry: true, werkplaatsWortel: wortel, paden, nu: NU }),
    ).rejects.toThrow(/sluiten elkaar uit/);
  });
});

describe('de LaunchAgent van de orkestrator', () => {
  const opzet = {
    bin: '/usr/local/bin/factory',
    werkmap: '/Users/gjvv',
    logPad: '/Users/gjvv/Library/Logs/nl.factory.orkestreer.log',
    label: 'nl.factory.orkestreer',
    uur: 4,
    minuut: 0,
    nachtCommando: '"/usr/local/bin/factory" orkestreer --nacht',
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

  it('haalt tags op via git ls-remote zonder een lokale repo te raken (#332)', () => {
    const script = bouwNachtScript(opzet);

    // De nieuwe aanpak: git ls-remote naar de publieke URL.
    expect(script).toContain('git ls-remote');
    expect(script).toContain('https://github.com/gjvv13/factory.git');
    // Geen git -C: een lokale repo is niet nodig en TCC blokkeert ~/Documents.
    expect(script).not.toContain('git -C');
  });

  it('exporteert FACTORY_VERWACHTE_VERSIE vóór de exec (#332)', () => {
    const script = bouwNachtScript(opzet);

    expect(script).toContain('export FACTORY_VERWACHTE_VERSIE=');
    // De export staat vóór de exec.
    const exportIndex = script.indexOf('FACTORY_VERWACHTE_VERSIE');
    const execIndex = script.indexOf('exec');
    expect(exportIndex).toBeGreaterThan(-1);
    expect(execIndex).toBeGreaterThan(exportIndex);
  });

  it('draait niet met een working directory of repo onder ~/Documents (#332)', () => {
    const plist = bouwOrkestreerPlist(opzet);

    // De #332-regressie ging over een ~/Documents-pad als working directory en een
    // `git -C` naar een factory-repo daaronder — dat blokkeert macOS TCC voor
    // achtergrondprocessen. De ingebakken PATH mág een ~/Documents-entry bevatten:
    // launchd heeft die nodig om node/gh/claude te vinden, en dat is geen werkmap- of
    // repo-pad. Toets daarom de working directory en het fetch-script, niet de hele plist.
    const werkdir = /<key>WorkingDirectory<\/key><string>([^<]*)<\/string>/.exec(plist)?.[1] ?? '';
    expect(werkdir).not.toContain('Documents');

    const script = bouwNachtScript(opzet);
    expect(script).not.toContain('Documents');
    expect(script).not.toContain('git -C');
  });
});

describe('de bouw-LaunchAgent (#343)', () => {
  const bouwOpzet = {
    bin: '/usr/local/bin/factory',
    werkmap: '/Users/gjvv',
    logPad: '/Users/gjvv/Library/Logs/nl.factory.orkestreer.log',
    label: 'nl.factory.orkestreer.bouw',
    uur: 5,
    minuut: 30,
    nachtCommando: '"/usr/local/bin/factory" orkestreer --soort bouw --nacht',
  };

  it('heeft een eigen label, draait om 05:30 en roept --soort bouw --nacht aan', () => {
    const plist = bouwOrkestreerPlist(bouwOpzet);

    expect(plist).toContain('<key>Label</key><string>nl.factory.orkestreer.bouw</string>');
    expect(plist).toContain('orkestreer --soort bouw --nacht');
    expect(plist).toContain('<key>Hour</key><integer>5</integer>');
    expect(plist).toContain('<key>Minute</key><integer>30</integer>');
  });

  it('start niet meteen bij het laden en draagt de token niet mee', () => {
    const plist = bouwOrkestreerPlist(bouwOpzet);

    expect(plist).not.toContain('RunAtLoad');
    expect(plist).not.toContain(TOKEN_SLEUTEL);
  });

  it('werkt de globale bin bij vóór het bouw-nacht-commando (#237)', () => {
    const script = bouwNachtScript(bouwOpzet);

    // De install-stap staat vóór de exec.
    const installIndex = script.indexOf('npm install -g');
    const execIndex = script.indexOf('exec');
    expect(installIndex).toBeGreaterThan(-1);
    expect(execIndex).toBeGreaterThan(installIndex);

    // De exec draait het bouw-nacht-commando.
    const regels = script.split('\n');
    const execRegel = regels[regels.length - 1];
    expect(execRegel).toContain('orkestreer --soort bouw --nacht');
  });

  it('draait niet met een working directory of repo onder ~/Documents (#332)', () => {
    const plist = bouwOrkestreerPlist(bouwOpzet);

    // Zie de refine-variant hierboven: de ingebakken PATH mág een ~/Documents-entry
    // bevatten (launchd vindt node/gh/claude daarmee); wat #332 verbiedt is een
    // ~/Documents-pad als working directory of een `git -C` naar een repo daaronder.
    const werkdir = /<key>WorkingDirectory<\/key><string>([^<]*)<\/string>/.exec(plist)?.[1] ?? '';
    expect(werkdir).not.toContain('Documents');

    const script = bouwNachtScript(bouwOpzet);
    expect(script).not.toContain('Documents');
    expect(script).not.toContain('git -C');
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
    herstelAsyncUitvoerder();
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

  it('installeert de globale bin uit de nieuwste tag en laadt de agent', async () => {
    metToken();
    const { aanroepen } = zetBeideUitvoerdersOp(machine());

    await orkestreer({ installeer: true, paden });

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

  it('is idempotent: twee keer installeren geeft dezelfde agent', async () => {
    metToken();
    zetBeideUitvoerdersOp(machine());

    await orkestreer({ installeer: true, paden });
    const eerste = readFileSync(paden.agentPad, 'utf8');
    await orkestreer({ installeer: true, paden });

    expect(readFileSync(paden.agentPad, 'utf8')).toBe(eerste);
  });

  it('weigert te installeren zonder token, en laat dan niets achter', async () => {
    const { aanroepen } = zetBeideUitvoerdersOp(machine());

    // Een geladen agent zonder token draait vannacht een ronde die op niets uitloopt,
    // en dat merk je dan pas morgen.
    await expect(orkestreer({ installeer: true, paden })).rejects.toThrow(/claude setup-token/);

    expect(existsSync(paden.agentPad)).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'launchctl')).toBe(false);
    // Het skelet staat er wel, met 0600, klaar om de token in te zetten.
    expect(statSync(paden.envPad).mode & 0o777).toBe(0o600);
  });

  it('weigert te installeren buiten de factory-repo', async () => {
    metToken();
    const buiten: UitkomstBepaler = (aanroep, index) =>
      aanroep.commando === 'git' && aanroep.argumenten[0] === 'remote'
        ? { stdout: 'git@github.com:gjvv13/assistant.git\n' }
        : machine()(aanroep, index);
    zetBeideUitvoerdersOp(buiten);

    // De globale bin komt uit de tags van dit repo; buiten de factory zou hij uit een
    // ander repo komen, of uit niets.
    await expect(orkestreer({ installeer: true, paden })).rejects.toThrow(/factory-repo/);
  });

  it('slaat de install over als er al een even nieuwe globale factory staat', async () => {
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
    const { aanroepen } = zetBeideUitvoerdersOp(bepaal);

    await orkestreer({ installeer: true, paden });

    // Zo downgradet een oudere pin de gedeelde bin nooit — dezelfde regel als bij
    // `integreer --installeer`.
    expect(aanroepen.some((a) => a.commando === 'npm' && a.argumenten[0] === 'install')).toBe(
      false,
    );
    expect(uitvoer.join('')).toMatch(/staat al globaal/);
  });

  it('weigert een agent te plannen op een bin die --nacht niet kent', async () => {
    metToken();
    const oudeBin: UitkomstBepaler = (aanroep, index) =>
      aanroep.argumenten[0] === 'help'
        ? { stdout: 'factory orkestreer <--dry|--eenmalig>\n' }
        : machine()(aanroep, index);
    const { aanroepen } = zetBeideUitvoerdersOp(oudeBin);

    // De globale bin komt uit de nieuwste tag, en die loopt achter op de branch waarin
    // --nacht net gebouwd is. Zo'n agent ketst om 04:00 stil af.
    await expect(orkestreer({ installeer: true, paden })).rejects.toThrow(/nog niet is/);

    expect(existsSync(paden.agentPad)).toBe(false);
    expect(aanroepen.some((a) => a.commando === 'launchctl')).toBe(false);
  });

  it('verwijdert de agent, ook als hij er niet staat', async () => {
    metToken();
    zetBeideUitvoerdersOp(machine());
    await orkestreer({ installeer: true, paden });

    await orkestreer({ verwijder: true, paden });
    expect(existsSync(paden.agentPad)).toBe(false);

    // Idempotent: een tweede keer verwijderen is een no-op en geen fout.
    await expect(orkestreer({ verwijder: true, paden })).resolves.not.toThrow();
  });
});

describe('bouwPrompt (refine)', () => {
  it('bevat de app-lijst in de gerenderde prompt', () => {
    const prompt = bouwPrompt(
      {
        issue: 51,
        titel: 'Test',
        app: 'assistant',
        kolom: 'Klaar voor technische refinement',
        aangemaakt: '',
        labels: [],
      },
      '/w/assistant',
      '/w/factory',
      ['assistant', 'beheer', 'factory'],
    );

    expect(prompt).toContain('assistant, beheer, factory');
    expect(prompt).not.toContain('{{BEKENDE_APPS}}');
  });
});

describe('ciSamenvatting — CI-status uit de statusCheckRollup', () => {
  it('leest CheckRuns (Actions) uit conclusion/status, niet uit state', () => {
    // GitHub Actions-checks dragen status/conclusion; `state` is afwezig. Een eerdere
    // versie las alleen `state` en rapporteerde een groene PR daardoor als 'lopend' (#437).
    const groen = [
      { name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'auto-merge', status: 'COMPLETED', conclusion: 'SKIPPED' },
    ];
    expect(ciSamenvatting(groen)).toBe('groen');
  });

  it('een gefaalde check kleurt het geheel rood', () => {
    const rood = [
      { status: 'COMPLETED', conclusion: 'SUCCESS' },
      { status: 'COMPLETED', conclusion: 'FAILURE' },
    ];
    expect(ciSamenvatting(rood)).toBe('rood');
  });

  it('een nog lopende check is lopend', () => {
    const lopend = [{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }];
    expect(ciSamenvatting(lopend)).toBe('lopend');
  });

  it('valt terug op state voor legacy StatusContexts', () => {
    expect(ciSamenvatting([{ state: 'SUCCESS' }])).toBe('groen');
    expect(ciSamenvatting([{ state: 'FAILURE' }])).toBe('rood');
    expect(ciSamenvatting([{ state: 'PENDING' }])).toBe('lopend');
  });

  it('geeft leeg terug zonder checks', () => {
    expect(ciSamenvatting([])).toBe('');
  });
});

describe('veiligOpruimen (#422)', () => {
  let uitvoer: string[];

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('roept de meegegeven functie aan', () => {
    const fn = vi.fn();

    veiligOpruimen(fn);

    expect(fn).toHaveBeenCalledOnce();
  });

  it('vangt een fout op en logt een waarschuwing', () => {
    const fn = vi.fn(() => {
      throw new Error('git fetch mislukt');
    });

    // Gooit niet — de fout wordt gevangen.
    veiligOpruimen(fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(uitvoer.join('')).toContain('opruimen mislukt: git fetch mislukt');
  });
});
