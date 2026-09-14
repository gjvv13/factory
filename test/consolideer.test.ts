/**
 * Unit-tests voor `factory consolideer` (#372): voorstel lezen/schrijven/valideren,
 * 7-dagen-weigering, bestandscontrole, plist-generatie, brief-sectie met/zonder
 * voorstel, en de `--voer-uit`-executielogica.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bouwConsolideerPlist,
  eersteOntbrekendPad,
  leesVoorstel,
  leesVoorstelRuw,
  schrijfVoorstel,
  voerVoorstelUit,
  voorstelSchema,
  VOORSTEL_VERVALT_MS,
  type ConsolidatieVoorstel,
} from '../src/commands/consolideer.js';
import { standaardPaden, CONSOLIDEER_LAUNCH_LABEL } from '../src/orkestrator-instellingen.js';
import { bouwBrief, type BriefBronnen } from '../src/regie-brief.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NU = new Date('2026-09-14T10:00:00.000Z');

function tmpDir(): string {
  return os.homedir(); // test/setup.ts zet HOME naar een tijdelijke map
}

function paden() {
  return standaardPaden(tmpDir());
}

function maakVoorstel(overrides: Partial<ConsolidatieVoorstel> = {}): ConsolidatieVoorstel {
  return {
    aangemaakt: '2026-09-10T09:00:00.000Z',
    geheugenMap: '/tmp/test-geheugen',
    acties: [{ soort: 'verwijder', pad: 'stale.md', reden: 'verouderd' }],
    indexRegels: ['# MEMORY.md', '', '- kept.md — bewaard'],
    samenvatting: '1 verouderd bestand verwijderd.',
    ...overrides,
  };
}

function maakBronnen(overrides: Partial<BriefBronnen> = {}): BriefBronnen {
  return {
    items: [],
    escalatieNummers: new Set(),
    escalatieContext: [],
    runlog: [],
    deployRuns: [],
    openPrs: [],
    nu: NU,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// voorstelSchema
// ---------------------------------------------------------------------------

describe('voorstelSchema', () => {
  it('accepteert een geldig voorstel', () => {
    const gelezen = voorstelSchema.safeParse(maakVoorstel());
    expect(gelezen.success).toBe(true);
  });

  it('weigert een voorstel zonder samenvatting', () => {
    const gelezen = voorstelSchema.safeParse({ ...maakVoorstel(), samenvatting: '' });
    expect(gelezen.success).toBe(false);
  });

  it('weigert een actie zonder pad', () => {
    const gelezen = voorstelSchema.safeParse({
      ...maakVoorstel(),
      acties: [{ soort: 'verwijder', pad: '', reden: 'test' }],
    });
    expect(gelezen.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// leesVoorstel / schrijfVoorstel
// ---------------------------------------------------------------------------

describe('leesVoorstel + schrijfVoorstel', () => {
  afterEach(() => {
    // Opruimen zodat tests niet elkaars voorstelbestand zien.
    const p = paden();
    rmSync(p.consolideerVoorstelPad, { force: true });
  });

  it('schrijft en leest een voorstel terug', () => {
    const p = paden();
    const voorstel = maakVoorstel({ aangemaakt: NU.toISOString() });
    schrijfVoorstel(p, voorstel);
    const gelezen = leesVoorstel(p, NU);
    expect(gelezen).toEqual(voorstel);
  });

  it('geeft undefined als het bestand niet bestaat', () => {
    const p = paden();
    expect(leesVoorstel(p, NU)).toBeUndefined();
  });

  it('geeft undefined als het bestand ongeldig JSON is', () => {
    const p = paden();
    mkdirSync(path.dirname(p.consolideerVoorstelPad), { recursive: true });
    writeFileSync(p.consolideerVoorstelPad, 'dit is geen json');
    expect(leesVoorstel(p, NU)).toBeUndefined();
  });

  it('geeft undefined als het voorstel ouder is dan 7 dagen', () => {
    const p = paden();
    const oudVoorstel = maakVoorstel({ aangemaakt: '2026-09-01T00:00:00.000Z' });
    schrijfVoorstel(p, oudVoorstel);
    // NU = 2026-09-14, voorstel van 2026-09-01 = 13 dagen oud
    expect(leesVoorstel(p, NU)).toBeUndefined();
  });

  it('leest een voorstel dat precies 7 dagen oud is niet (grenswaarde)', () => {
    const p = paden();
    // Precies 7 dagen voor NU
    const precies7Dagen = new Date(NU.getTime() - VOORSTEL_VERVALT_MS).toISOString();
    const voorstel = maakVoorstel({ aangemaakt: precies7Dagen });
    schrijfVoorstel(p, voorstel);
    expect(leesVoorstel(p, NU)).toBeUndefined();
  });

  it('leest een voorstel dat net binnen 7 dagen is (grenswaarde)', () => {
    const p = paden();
    const net6Dagen = new Date(NU.getTime() - VOORSTEL_VERVALT_MS + 1).toISOString();
    const voorstel = maakVoorstel({ aangemaakt: net6Dagen });
    schrijfVoorstel(p, voorstel);
    expect(leesVoorstel(p, NU)).toEqual(voorstel);
  });
});

// ---------------------------------------------------------------------------
// leesVoorstelRuw (zonder vervaltijd)
// ---------------------------------------------------------------------------

describe('leesVoorstelRuw', () => {
  afterEach(() => {
    rmSync(paden().consolideerVoorstelPad, { force: true });
  });

  it('leest een oud voorstel zonder vervaltijd-controle', () => {
    const p = paden();
    const oudVoorstel = maakVoorstel({ aangemaakt: '2026-09-01T00:00:00.000Z' });
    schrijfVoorstel(p, oudVoorstel);
    expect(leesVoorstelRuw(p)).toEqual(oudVoorstel);
  });

  it('geeft undefined als het bestand niet bestaat', () => {
    expect(leesVoorstelRuw(paden())).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// eersteOntbrekendPad
// ---------------------------------------------------------------------------

describe('eersteOntbrekendPad', () => {
  let geheugenMap: string;

  beforeEach(() => {
    geheugenMap = path.join(tmpDir(), 'test-geheugen-controle');
    mkdirSync(geheugenMap, { recursive: true });
  });

  it('geeft undefined als alle paden bestaan', () => {
    writeFileSync(path.join(geheugenMap, 'bestand.md'), 'inhoud');
    const voorstel = maakVoorstel({
      geheugenMap,
      acties: [{ soort: 'verwijder', pad: 'bestand.md', reden: 'test' }],
    });
    expect(eersteOntbrekendPad(voorstel)).toBeUndefined();
  });

  it('geeft het ontbrekende pad terug', () => {
    const voorstel = maakVoorstel({
      geheugenMap,
      acties: [{ soort: 'verwijder', pad: 'bestaat-niet.md', reden: 'test' }],
    });
    expect(eersteOntbrekendPad(voorstel)).toBe('bestaat-niet.md');
  });
});

// ---------------------------------------------------------------------------
// voerVoorstelUit
// ---------------------------------------------------------------------------

describe('voerVoorstelUit', () => {
  let geheugenMap: string;

  beforeEach(() => {
    geheugenMap = path.join(tmpDir(), 'test-geheugen-uitvoer');
    mkdirSync(geheugenMap, { recursive: true });
    // Vang stdout op zodat ok()-aanroepen niet in de test-output komen
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('verwijdert een bestand bij actie "verwijder"', () => {
    writeFileSync(path.join(geheugenMap, 'te-verwijderen.md'), 'inhoud');
    const voorstel = maakVoorstel({
      geheugenMap,
      acties: [{ soort: 'verwijder', pad: 'te-verwijderen.md', reden: 'verouderd' }],
    });
    voerVoorstelUit(voorstel);
    expect(existsSync(path.join(geheugenMap, 'te-verwijderen.md'))).toBe(false);
  });

  it('herschrijft een bestand bij actie "herschrijf"', () => {
    writeFileSync(path.join(geheugenMap, 'te-herschrijven.md'), 'oud');
    const voorstel = maakVoorstel({
      geheugenMap,
      acties: [
        {
          soort: 'herschrijf',
          pad: 'te-herschrijven.md',
          reden: 'ontdubbeld',
          nieuweInhoud: 'nieuw',
        },
      ],
    });
    voerVoorstelUit(voorstel);
    expect(readFileSync(path.join(geheugenMap, 'te-herschrijven.md'), 'utf8')).toBe('nieuw');
  });

  it('voegt bestanden samen bij actie "samenvoeg"', () => {
    writeFileSync(path.join(geheugenMap, 'bron.md'), 'bron');
    const voorstel = maakVoorstel({
      geheugenMap,
      acties: [
        {
          soort: 'samenvoeg',
          pad: 'bron.md',
          reden: 'samengevoegd',
          nieuwePad: 'doel.md',
          nieuweInhoud: 'samengevoegd',
        },
      ],
    });
    voerVoorstelUit(voorstel);
    expect(existsSync(path.join(geheugenMap, 'bron.md'))).toBe(false);
    expect(readFileSync(path.join(geheugenMap, 'doel.md'), 'utf8')).toBe('samengevoegd');
  });

  it('genereert MEMORY.md uit indexRegels', () => {
    writeFileSync(path.join(geheugenMap, 'x.md'), 'inhoud');
    const voorstel = maakVoorstel({
      geheugenMap,
      acties: [{ soort: 'verwijder', pad: 'x.md', reden: 'test' }],
      indexRegels: ['# MEMORY', '', '- kept.md'],
    });
    voerVoorstelUit(voorstel);
    expect(readFileSync(path.join(geheugenMap, 'MEMORY.md'), 'utf8')).toBe('# MEMORY\n\n- kept.md');
  });

  it('gooit een fout als herschrijf geen nieuweInhoud heeft', () => {
    writeFileSync(path.join(geheugenMap, 'bestand.md'), 'inhoud');
    const voorstel = maakVoorstel({
      geheugenMap,
      acties: [{ soort: 'herschrijf', pad: 'bestand.md', reden: 'test' }],
    });
    expect(() => {
      voerVoorstelUit(voorstel);
    }).toThrow('mist nieuweInhoud');
  });

  it('gooit een fout als samenvoeg geen nieuwePad heeft', () => {
    writeFileSync(path.join(geheugenMap, 'bestand.md'), 'inhoud');
    const voorstel = maakVoorstel({
      geheugenMap,
      acties: [
        {
          soort: 'samenvoeg',
          pad: 'bestand.md',
          reden: 'test',
          nieuweInhoud: 'nieuw',
        },
      ],
    });
    expect(() => {
      voerVoorstelUit(voorstel);
    }).toThrow('mist nieuwePad');
  });
});

// ---------------------------------------------------------------------------
// bouwConsolideerPlist
// ---------------------------------------------------------------------------

describe('bouwConsolideerPlist', () => {
  it('bevat het juiste label', () => {
    const plist = bouwConsolideerPlist({
      bin: '/usr/local/bin/factory',
      werkmap: '/Users/test',
      logPad: '/tmp/test.log',
    });
    expect(plist).toContain(`<string>${CONSOLIDEER_LAUNCH_LABEL}</string>`);
  });

  it('bevat Weekday in StartCalendarInterval', () => {
    const plist = bouwConsolideerPlist({
      bin: '/usr/local/bin/factory',
      werkmap: '/Users/test',
      logPad: '/tmp/test.log',
    });
    expect(plist).toContain('<key>Weekday</key><integer>1</integer>');
  });

  it('bevat het juiste uur en minuut', () => {
    const plist = bouwConsolideerPlist({
      bin: '/usr/local/bin/factory',
      werkmap: '/Users/test',
      logPad: '/tmp/test.log',
    });
    expect(plist).toContain('<key>Hour</key><integer>9</integer>');
    expect(plist).toContain('<key>Minute</key><integer>0</integer>');
  });

  it('bevat het self-update-script met het consolideer-commando', () => {
    const plist = bouwConsolideerPlist({
      bin: '/usr/local/bin/factory',
      werkmap: '/Users/test',
      logPad: '/tmp/test.log',
    });
    expect(plist).toContain('consolideer --dry');
    expect(plist).toContain('git ls-remote');
  });

  it('heeft geen RunAtLoad', () => {
    const plist = bouwConsolideerPlist({
      bin: '/usr/local/bin/factory',
      werkmap: '/Users/test',
      logPad: '/tmp/test.log',
    });
    expect(plist).not.toContain('RunAtLoad');
  });
});

// ---------------------------------------------------------------------------
// Brief-sectie consolidatie
// ---------------------------------------------------------------------------

describe('consolidatieSectie in bouwBrief', () => {
  it('toont de consolidatie-sectie als er een voorstel is', () => {
    const voorstel = maakVoorstel();
    const tekst = bouwBrief(maakBronnen({ consolidatieVoorstel: voorstel }));
    expect(tekst).toContain('🧹 Geheugenconsolidatie');
    expect(tekst).toContain('1 acties');
    expect(tekst).toContain('1× verwijder');
    expect(tekst).toContain(voorstel.samenvatting);
    expect(tekst).toContain('factory consolideer --voer-uit');
  });

  it('laat de sectie weg als er geen voorstel is', () => {
    const tekst = bouwBrief(maakBronnen());
    expect(tekst).not.toContain('Geheugenconsolidatie');
  });

  it('toont de telling per actiesoort bij meerdere acties', () => {
    const voorstel = maakVoorstel({
      acties: [
        { soort: 'verwijder', pad: 'a.md', reden: 'oud' },
        { soort: 'herschrijf', pad: 'b.md', reden: 'dubbel', nieuweInhoud: 'nieuw' },
        { soort: 'herschrijf', pad: 'c.md', reden: 'dubbel', nieuweInhoud: 'nieuw' },
      ],
    });
    const tekst = bouwBrief(maakBronnen({ consolidatieVoorstel: voorstel }));
    expect(tekst).toContain('3 acties');
    expect(tekst).toContain('1× verwijder');
    expect(tekst).toContain('2× herschrijf');
  });
});

// ---------------------------------------------------------------------------
// VOORSTEL_VERVALT_MS
// ---------------------------------------------------------------------------

describe('VOORSTEL_VERVALT_MS', () => {
  it('is precies 7 dagen in milliseconden', () => {
    expect(VOORSTEL_VERVALT_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
