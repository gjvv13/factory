import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSlices, herschrijfBody, parseAppAntwoord, splits } from '../src/splits.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer, zetBoardOmgeving, type ProcesAanroep } from './helpers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TWEE_SLICES_BODY = `---
id: test-feature
titel: Test Feature
status: refined
---

# Test Feature

## Samenvatting

Dit is een testfeature met twee slices.

## Functionele architectuur

### Gedrag

De gebruiker kan iets doen.

## Technische architectuur

### Onderdelen

| Laag | Bestand | Wat er verandert |
| ---- | ------- | ---------------- |
| core | src/core/test.ts | nieuw |

## Slices

### Slice 1 — Basisfunctionaliteit

- **Doel:** de basis werkt
- **Acceptatiecriteria:**
  - [ ] criterium 1
- **Tests:** unit: test1
- **Testdata:** fixture1
- **Flag:** geen

### Slice 2 — Uitbreiding

- **Doel:** de uitbreiding werkt
- **Acceptatiecriteria:**
  - [ ] criterium 2
- **Tests:** unit: test2
- **Testdata:** fixture2
- **Flag:** geen

## Risico's

Geen bijzondere risico's.

## Besluiten

Geen openstaande besluiten.
`;

const EEN_SLICE_BODY = `# Eenvoudig issue

## Slices

### Slice 1 — Alles

- **Doel:** alles werkt
- **Acceptatiecriteria:**
  - [ ] criterium 1

## Risico's

Geen.
`;

const GEEN_SLICES_BODY = `# Issue zonder slices

## Samenvatting

Dit issue heeft geen slice-secties.

## Risico's

Geen.
`;

const AFWIJKEND_FORMAAT_BODY = `# Issue met afwijkend formaat

### Slice A — Fout genummerd

Dit heeft een letter i.p.v. een nummer.

### slice 2 — klein geschreven

Dit heeft een kleine s.
`;

// ---------------------------------------------------------------------------
// parseSlices — unit-tests voor de body-parser
// ---------------------------------------------------------------------------

describe('parseSlices', () => {
  it('herkent twee slices conform het refinement-template', () => {
    const slices = parseSlices(TWEE_SLICES_BODY);

    expect(slices).toHaveLength(2);
    expect(slices[0]?.nummer).toBe(1);
    expect(slices[0]?.naam).toBe('Basisfunctionaliteit');
    expect(slices[0]?.body).toContain('criterium 1');
    expect(slices[1]?.nummer).toBe(2);
    expect(slices[1]?.naam).toBe('Uitbreiding');
    expect(slices[1]?.body).toContain('criterium 2');
  });

  it('stopt de slice-body bij de volgende ## -kop (Risicos)', () => {
    const slices = parseSlices(TWEE_SLICES_BODY);

    expect(slices[1]?.body).not.toContain('Risico');
    expect(slices[1]?.body).not.toContain('Besluiten');
  });

  it('geeft een lege lijst voor een één-slice-issue', () => {
    const slices = parseSlices(EEN_SLICE_BODY);

    expect(slices).toHaveLength(0);
  });

  it('geeft een lege lijst als er geen slice-secties zijn', () => {
    const slices = parseSlices(GEEN_SLICES_BODY);

    expect(slices).toHaveLength(0);
  });

  it('herkent geen afwijkend formaat (letter i.p.v. nummer, kleine s)', () => {
    const slices = parseSlices(AFWIJKEND_FORMAAT_BODY);

    // "Slice A" matcht niet op \d+ en "slice 2" matcht niet op "Slice" (hoofdletter).
    expect(slices).toHaveLength(0);
  });

  it('geeft een lege lijst bij een lege body', () => {
    expect(parseSlices('')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// herschrijfBody — unit-tests voor de body-herschrijving
// ---------------------------------------------------------------------------

describe('herschrijfBody', () => {
  it('vervangt de slice-secties door verwijzingen naar kinderen', () => {
    const kinderen = [
      { issue: 400, naam: 'Basisfunctionaliteit' },
      { issue: 401, naam: 'Uitbreiding' },
    ];

    const resultaat = herschrijfBody(TWEE_SLICES_BODY, kinderen);

    expect(resultaat).toContain('- #400 — Basisfunctionaliteit');
    expect(resultaat).toContain('- #401 — Uitbreiding');
  });

  it('behoudt de architectuursecties boven de slices', () => {
    const kinderen = [
      { issue: 400, naam: 'Basisfunctionaliteit' },
      { issue: 401, naam: 'Uitbreiding' },
    ];

    const resultaat = herschrijfBody(TWEE_SLICES_BODY, kinderen);

    expect(resultaat).toContain('## Samenvatting');
    expect(resultaat).toContain('## Functionele architectuur');
    expect(resultaat).toContain('## Technische architectuur');
  });

  it('behoudt Risicos en Besluiten na de slices', () => {
    const kinderen = [
      { issue: 400, naam: 'A' },
      { issue: 401, naam: 'B' },
    ];

    const resultaat = herschrijfBody(TWEE_SLICES_BODY, kinderen);

    expect(resultaat).toContain('## Risico');
    expect(resultaat).toContain('## Besluiten');
  });

  it('bevat geen slice-koppen meer na de herschrijving', () => {
    const kinderen = [
      { issue: 400, naam: 'A' },
      { issue: 401, naam: 'B' },
    ];

    const resultaat = herschrijfBody(TWEE_SLICES_BODY, kinderen);

    expect(resultaat).not.toMatch(/### Slice \d+ —/);
  });

  it('retourneert de originele body als er geen slice-koppen zijn', () => {
    const resultaat = herschrijfBody(GEEN_SLICES_BODY, []);

    expect(resultaat).toBe(GEEN_SLICES_BODY);
  });
});

// ---------------------------------------------------------------------------
// parseAppAntwoord — unit-test voor de GraphQL-parse
// ---------------------------------------------------------------------------

describe('parseAppAntwoord', () => {
  it('leest de app-naam uit een geldig GraphQL-antwoord', () => {
    const ruw = JSON.stringify({
      data: {
        repository: {
          issue: {
            projectItems: {
              nodes: [
                {
                  project: { number: 2 },
                  app: { name: 'assistant' },
                },
              ],
            },
          },
        },
      },
    });

    expect(parseAppAntwoord(ruw)).toBe('assistant');
  });

  it('geeft undefined als het App-veld niet gezet is', () => {
    const ruw = JSON.stringify({
      data: {
        repository: {
          issue: {
            projectItems: {
              nodes: [
                {
                  project: { number: 2 },
                  app: null,
                },
              ],
            },
          },
        },
      },
    });

    expect(parseAppAntwoord(ruw)).toBeUndefined();
  });

  it('geeft undefined bij ongeldige JSON', () => {
    expect(parseAppAntwoord('geen json')).toBeUndefined();
  });

  it('filtert op het juiste projectnummer', () => {
    const ruw = JSON.stringify({
      data: {
        repository: {
          issue: {
            projectItems: {
              nodes: [
                { project: { number: 99 }, app: { name: 'verkeerd' } },
                { project: { number: 2 }, app: { name: 'goed' } },
              ],
            },
          },
        },
      },
    });

    expect(parseAppAntwoord(ruw)).toBe('goed');
  });
});

// ---------------------------------------------------------------------------
// splits — integratie (met opgenomen uitvoerder)
// ---------------------------------------------------------------------------

/** Simuleert het gh-antwoord voor `gh issue view`. */
function issueViewAntwoord(body: string, labels: string[] = ['type:task']): string {
  return JSON.stringify({
    title: 'Factory · Test feature',
    body,
    labels: labels.map((name) => ({ name })),
    url: 'https://github.com/gjvv13/factory/issues/100',
  });
}

/** Simuleert het GraphQL-antwoord voor de App-query. */
function appQueryAntwoord(app: string): string {
  return JSON.stringify({
    data: {
      repository: {
        issue: {
          projectItems: {
            nodes: [{ project: { number: 2 }, app: { name: app } }],
          },
        },
      },
    },
  });
}

/** Het antwoord waarmee `zetKolom` zijn ids vindt. */
function doelwit(huidig: string): string {
  return JSON.stringify({
    data: {
      user: {
        projectV2: {
          id: 'PVT_x',
          field: {
            id: 'PVTSSF_x',
            options: [
              { id: 'optie-bouwen', name: 'Klaar voor Bouwen' },
              { id: 'optie-idee', name: 'Idee' },
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

function ghArgs(aanroepen: ProcesAanroep[]): string[][] {
  return aanroepen.filter((a) => a.commando === 'gh').map((a) => a.argumenten);
}

describe('splits — commando', () => {
  let uitvoer: string[];
  let herstelOmgeving: () => void;

  beforeEach(() => {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    herstelOmgeving = zetBoardOmgeving({ inWorkflow: false });
  });

  afterEach(() => {
    herstelOmgeving();
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  it('maakt child-issues aan voor elke slice en zet labels, app en kolom', () => {
    let kindTeller = 0;
    const opnemer = maakUitvoerderOpnemer(({ commando, argumenten }) => {
      if (commando !== 'gh') return {};
      // gh issue view — lees het issue
      if (argumenten[0] === 'issue' && argumenten[1] === 'view') {
        return { stdout: issueViewAntwoord(TWEE_SLICES_BODY) };
      }
      // App-query
      if (
        argumenten[0] === 'api' &&
        argumenten[1] === 'graphql' &&
        argumenten.some((a) => a.includes('App'))
      ) {
        return { stdout: appQueryAntwoord('assistant') };
      }
      // zoekDoelwit (zetKolom)
      if (argumenten[0] === 'api' && argumenten[1] === 'graphql') {
        return { stdout: doelwit('Technisch refinen') };
      }
      // gh issue create — maak een kind
      if (argumenten[0] === 'issue' && argumenten[1] === 'create') {
        kindTeller += 1;
        return { stdout: `https://github.com/gjvv13/factory/issues/${String(400 + kindTeller)}` };
      }
      return {};
    });
    stelUitvoerderIn(opnemer.uitvoerder);

    splits('100');

    // Twee child-issues aangemaakt
    const creates = ghArgs(opnemer.aanroepen).filter((a) => a[0] === 'issue' && a[1] === 'create');
    expect(creates).toHaveLength(2);

    // Eerste kind heeft de juiste titel
    const eersteTitel = creates[0]?.find((_, i, arr) => arr[i - 1] === '--title');
    expect(eersteTitel).toBe('Factory · Slice 1 — Basisfunctionaliteit');

    // --parent meegegeven
    const eersteParent = creates[0]?.find((_, i, arr) => arr[i - 1] === '--parent');
    expect(eersteParent).toBe('https://github.com/gjvv13/factory/issues/100');

    // Labels meegegeven (type:task van de ouder)
    const eersteLabel = creates[0]?.find((_, i, arr) => arr[i - 1] === '--label');
    expect(eersteLabel).toBe('type:task');

    // App-veld gezet op elk kind (project item-add + item-edit met App)
    const appEdits = ghArgs(opnemer.aanroepen).filter(
      (a) => a[0] === 'project' && a[1] === 'item-edit' && a.includes('App'),
    );
    expect(appEdits).toHaveLength(2);
    expect(appEdits[0]).toContain('assistant');

    // Kolom gezet via zetKolom (project item-edit met optie-bouwen)
    const kolomEdits = ghArgs(opnemer.aanroepen).filter(
      (a) => a[0] === 'project' && a[1] === 'item-edit' && a.includes('optie-bouwen'),
    );
    expect(kolomEdits).toHaveLength(2);

    // type:epic label op de ouder
    const epicLabel = ghArgs(opnemer.aanroepen).find(
      (a) => a[0] === 'issue' && a[1] === 'edit' && a.includes('type:epic'),
    );
    expect(epicLabel).toBeDefined();

    // Kolom van de ouder gewist (project item-edit met --clear)
    const clearKolom = ghArgs(opnemer.aanroepen).find(
      (a) => a[0] === 'project' && a[1] === 'item-edit' && a.includes('--clear'),
    );
    expect(clearKolom).toBeDefined();

    // Ouder-body herschreven (gh issue edit --body-file)
    const bodyEdit = ghArgs(opnemer.aanroepen).find(
      (a) => a[0] === 'issue' && a[1] === 'edit' && a.includes('--body-file'),
    );
    expect(bodyEdit).toBeDefined();
  });

  it('meldt dat splitsen niet nodig is bij een één-slice-issue', () => {
    const opnemer = maakUitvoerderOpnemer(({ commando, argumenten }) => {
      if (commando === 'gh' && argumenten[0] === 'issue' && argumenten[1] === 'view') {
        return { stdout: issueViewAntwoord(EEN_SLICE_BODY) };
      }
      return {};
    });
    stelUitvoerderIn(opnemer.uitvoerder);

    splits('100');

    expect(uitvoer.join('')).toMatch(/niet nodig/);
    // Geen issues aangemaakt
    const creates = ghArgs(opnemer.aanroepen).filter((a) => a[0] === 'issue' && a[1] === 'create');
    expect(creates).toHaveLength(0);
  });

  it('meldt dat splitsen niet nodig is als er geen slice-secties zijn', () => {
    const opnemer = maakUitvoerderOpnemer(({ commando, argumenten }) => {
      if (commando === 'gh' && argumenten[0] === 'issue' && argumenten[1] === 'view') {
        return { stdout: issueViewAntwoord(GEEN_SLICES_BODY) };
      }
      return {};
    });
    stelUitvoerderIn(opnemer.uitvoerder);

    splits('100');

    expect(uitvoer.join('')).toMatch(/niet nodig/);
  });

  it('gooit een fout bij een ontbrekend issuenummer', () => {
    expect(() => {
      splits(undefined);
    }).toThrow(/issuenummer/);
  });

  it('gooit een fout bij een ongeldig issuenummer', () => {
    expect(() => {
      splits('abc');
    }).toThrow(/geldig/);
  });

  it('geeft type:epic niet door als label aan kinderen', () => {
    let kindTeller = 0;
    const opnemer = maakUitvoerderOpnemer(({ commando, argumenten }) => {
      if (commando !== 'gh') return {};
      if (argumenten[0] === 'issue' && argumenten[1] === 'view') {
        // Ouder heeft al type:epic (zou niet voorkomen, maar defensief)
        return { stdout: issueViewAntwoord(TWEE_SLICES_BODY, ['type:epic', 'type:task']) };
      }
      if (
        argumenten[0] === 'api' &&
        argumenten[1] === 'graphql' &&
        argumenten.some((a) => a.includes('App'))
      ) {
        return { stdout: appQueryAntwoord('factory') };
      }
      if (argumenten[0] === 'api' && argumenten[1] === 'graphql') {
        return { stdout: doelwit('Technisch refinen') };
      }
      if (argumenten[0] === 'issue' && argumenten[1] === 'create') {
        kindTeller += 1;
        return { stdout: `https://github.com/gjvv13/factory/issues/${String(500 + kindTeller)}` };
      }
      return {};
    });
    stelUitvoerderIn(opnemer.uitvoerder);

    splits('100');

    // Controleer dat de kinderen geen type:epic label kregen
    const creates = ghArgs(opnemer.aanroepen).filter((a) => a[0] === 'issue' && a[1] === 'create');
    for (const create of creates) {
      const labels = create.filter((_, i, arr) => arr[i - 1] === '--label');
      expect(labels).not.toContain('type:epic');
    }
  });

  it('zet geen extra type:epic label als de ouder dat al heeft', () => {
    let kindTeller = 0;
    const opnemer = maakUitvoerderOpnemer(({ commando, argumenten }) => {
      if (commando !== 'gh') return {};
      if (argumenten[0] === 'issue' && argumenten[1] === 'view') {
        return { stdout: issueViewAntwoord(TWEE_SLICES_BODY, ['type:epic']) };
      }
      if (
        argumenten[0] === 'api' &&
        argumenten[1] === 'graphql' &&
        argumenten.some((a) => a.includes('App'))
      ) {
        return { stdout: appQueryAntwoord('factory') };
      }
      if (argumenten[0] === 'api' && argumenten[1] === 'graphql') {
        return { stdout: doelwit('Technisch refinen') };
      }
      if (argumenten[0] === 'issue' && argumenten[1] === 'create') {
        kindTeller += 1;
        return { stdout: `https://github.com/gjvv13/factory/issues/${String(600 + kindTeller)}` };
      }
      return {};
    });
    stelUitvoerderIn(opnemer.uitvoerder);

    splits('100');

    // Geen aparte zetLabel-aanroep voor type:epic (de ouder heeft het al)
    const epicEdits = ghArgs(opnemer.aanroepen).filter(
      (a) => a[0] === 'issue' && a[1] === 'edit' && a.includes('type:epic'),
    );
    expect(epicEdits).toHaveLength(0);
  });
});
