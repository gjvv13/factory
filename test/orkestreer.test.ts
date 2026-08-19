import { closeSync, existsSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orkestreer } from '../src/commands/orkestreer.js';
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

/** Het antwoord waarmee `zetKolom` zijn ids vindt. */
const DOELWIT_ANTWOORD = JSON.stringify({
  data: {
    user: {
      projectV2: {
        id: 'PVT_x',
        field: { id: 'PVTSSF_x', options: [{ id: 'optie-technisch', name: 'Technisch refinen' }] },
      },
    },
    repository: {
      issue: {
        projectItems: {
          nodes: [
            {
              id: 'PVTI_x',
              project: { number: 2 },
              fieldValueByName: { name: 'Klaar voor technische refinement' },
            },
          ],
        },
      },
    },
  },
});

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
  return ({ commando, argumenten }) => {
    if (commando === 'claude') return { stdout: opties.werker ?? werkerKlaar() };
    if (commando === 'gh' && argumenten[0] === 'api' && argumenten[1] === 'graphql') {
      const query = argumenten.find((a) => a.startsWith('query=')) ?? '';
      if (query.includes('items(first:100'))
        return { stdout: boardAntwoord(opties.board ?? WACHTRIJ) };
      return { stdout: DOELWIT_ANTWOORD };
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
    const stuk: UitkomstBepaler = (aanroep, index) =>
      // De werkplaats klonen mislukt; dat gooit, halverwege werkAf.
      aanroep.commando === 'gh' && aanroep.argumenten[0] === 'repo'
        ? { code: 1 }
        : bepaler()(aanroep, index);
    stelUitvoerderIn(maakUitvoerderOpnemer(stuk).uitvoerder);

    expect(() => {
      orkestreer({ eenmalig: true, werkplaatsWortel: wortel });
    }).toThrow();

    // Blijft het slot liggen, dan staat de rij een uur stil op een run die al klaar is.
    expect(existsSync(LOCK_PAD)).toBe(false);
  });
});
