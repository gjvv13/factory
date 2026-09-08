import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import type { CoverageMapData } from 'istanbul-lib-coverage';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beoordeelDekking,
  beschikbareScripts,
  leesDiffTegenMain,
  STAPPEN,
  telKwetsbaarheden,
  toetsDiffDekking,
  verify,
} from '../src/commands/verify.js';
import type { DekkingsConfig } from '../src/dekking-config.js';
import {
  aantalWaarschuwingen,
  GebruikersFout,
  herstelUitvoerder,
  OmgevingsFout,
  resetWaarschuwingen,
  stelUitvoerderIn,
  waarschuwing,
} from '../src/shell.js';
import type { ProcesUitkomst } from '../src/shell.js';

/** Maakt een tmp-map met een minimale package.json die de standaard verify-scripts bevat. */
function maakVerifyDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'verify-'));
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      scripts: {
        'format:check': 'echo ok',
        lint: 'echo ok',
        typecheck: 'echo ok',
        'test:unit': 'echo ok',
        'test:contract': 'echo ok',
        'test:e2e': 'echo ok',
        build: 'echo ok',
      },
    }),
  );
  return dir;
}

/**
 * Coverage draait via de omgevingsvariabele `FACTORY_COVERAGE`, die `verify`
 * alleen bij een volledige poort zet. We vangen de uitvoerder af en kijken of die
 * vlag bij de test-stap wél/niet meekomt — zonder echt pnpm of vitest te starten.
 */
interface Aanroep {
  readonly script: string;
  readonly coverage: boolean;
}

function vangAanroepen(): Aanroep[] {
  const aanroepen: Aanroep[] = [];
  stelUitvoerderIn((_commando, argumenten, options): ProcesUitkomst => {
    const script = argumenten[argumenten.indexOf('run') + 1] ?? '';
    aanroepen.push({ script, coverage: options.env?.FACTORY_COVERAGE === '1' });
    return { code: 0, stdout: '' };
  });
  return aanroepen;
}

afterEach(() => {
  herstelUitvoerder();
});

describe('verify — coverage', () => {
  it('meet coverage op de test-stap bij een volledige poort', () => {
    const aanroepen = vangAanroepen();
    // Gebruik een tmp-map als cwd zodat de rmSync op coverage/ niet de coverage
    // van de testrunner zelf verwijdert.
    verify({ cwd: maakVerifyDir() });
    expect(aanroepen.find((a) => a.script === 'test:unit')?.coverage).toBe(true);
  });

  it('slaat coverage over bij --snel', () => {
    const aanroepen = vangAanroepen();
    verify({ snel: true });
    expect(aanroepen.find((a) => a.script === 'test:unit')?.coverage).toBe(false);
  });

  it('slaat coverage over bij --pre-commit', () => {
    const aanroepen = vangAanroepen();
    verify({ preCommit: true });
    expect(aanroepen.find((a) => a.script === 'test:unit')?.coverage).toBe(false);
  });
});

describe('verify — pact-verify stap in STAPPEN', () => {
  const pactStap = STAPPEN.find((s) => s.script === 'test:pact-verify');
  const scripts = STAPPEN.map((s) => s.script);

  it('staat na test:contract en vóór test:e2e', () => {
    const contractIdx = scripts.indexOf('test:contract');
    const pactIdx = scripts.indexOf('test:pact-verify');
    const e2eIdx = scripts.indexOf('test:e2e');
    expect(pactIdx).toBeGreaterThan(contractIdx);
    expect(pactIdx).toBeLessThan(e2eIdx);
  });

  it('draait niet bij --snel', () => {
    expect(pactStap?.snel).toBe(false);
  });

  it('draait niet bij --pre-commit', () => {
    expect(pactStap?.preCommit).toBe(false);
  });

  it('heeft geen coverageNaam', () => {
    expect(pactStap).toBeDefined();
    expect('coverageNaam' in pactStap!).toBe(false);
  });
});

describe('beoordeelDekking', () => {
  it('geeft geen oordeel zonder ingestelde drempel', () => {
    expect(beoordeelDekking([72], undefined)).toBeUndefined();
  });

  it('geeft geen oordeel zonder metingen', () => {
    expect(beoordeelDekking([], 80)).toBeUndefined();
  });

  it('faalt als het totaal onder de drempel zakt', () => {
    expect(beoordeelDekking([71, 60], 80)).toEqual({ totaal: 71, faalt: true });
  });

  it('slaagt als het totaal de drempel haalt', () => {
    expect(beoordeelDekking([72, 90], 80)).toEqual({ totaal: 90, faalt: false });
  });

  it('gebruikt het gemergede totaal als dat er is, in plaats van de hoogste soort', () => {
    // De losse soorten halen 95%, maar de echte gecombineerde dekking is 60%: die telt.
    expect(beoordeelDekking([95, 40], 80, 60)).toEqual({ totaal: 60, faalt: true });
  });

  it('valt terug op de hoogste soort als er geen merge-cijfer is', () => {
    expect(beoordeelDekking([72, 90], 80, undefined)).toEqual({ totaal: 90, faalt: false });
  });

  it('geeft geen oordeel zonder metingen én zonder merge-cijfer', () => {
    expect(beoordeelDekking([], 80, undefined)).toBeUndefined();
  });
});

describe('telKwetsbaarheden', () => {
  const uitvoer = (v: Record<string, number>): string =>
    JSON.stringify({ metadata: { vulnerabilities: v } });

  it('telt alleen wat op of boven het drempelniveau zit', () => {
    const telling = telKwetsbaarheden(
      uitvoer({ info: 3, low: 2, moderate: 1, high: 2, critical: 1 }),
      'high',
    );
    expect(telling).toEqual({ aantal: 3, perNiveau: { high: 2, critical: 1 } });
  });

  it('telt niets als er onder de drempel niets ligt', () => {
    expect(telKwetsbaarheden(uitvoer({ low: 5, high: 0 }), 'high')).toEqual({
      aantal: 0,
      perNiveau: {},
    });
  });

  it('onderscheidt "kon niet draaien" van "niets gevonden"', () => {
    // Geen netwerk: pnpm schrijft een foutmelding in plaats van json.
    expect(telKwetsbaarheden('ERR_PNPM_AUDIT_ENDPOINT_FAILED', 'high')).toBeUndefined();
    expect(telKwetsbaarheden('', 'high')).toBeUndefined();
    // Geldige json, maar niet de vorm die we verwachten.
    expect(telKwetsbaarheden('{"advisories":{}}', 'high')).toBeUndefined();
  });

  it('respecteert een lagere drempel', () => {
    expect(telKwetsbaarheden(uitvoer({ moderate: 2, high: 1 }), 'moderate')).toEqual({
      aantal: 3,
      perNiveau: { moderate: 2, high: 1 },
    });
  });
});

describe('verify — cwd (#379)', () => {
  let origineleCwd: string;

  afterEach(() => {
    process.chdir(origineleCwd);
  });

  it('gebruikt opties.cwd in plaats van process.cwd() voor het lezen van package.json en het draaien van scripts', () => {
    // Maak een tmp-map met een minimale package.json die de scripts bevat die
    // verify verwacht. Zet process.cwd() op een map zónder package.json — als
    // verify de meegegeven cwd correct doorgeeft, vindt hij package.json in de
    // tmp-map; valt hij terug op process.cwd(), dan breekt hij.
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'verify-cwd-'));
    writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        scripts: { lint: 'echo ok', typecheck: 'echo ok', 'test:unit': 'echo ok' },
      }),
    );

    origineleCwd = process.cwd();
    // Een map zonder package.json: de repo-wortel van os is veilig genoeg.
    process.chdir(tmpdir());

    const cwds: string[] = [];
    stelUitvoerderIn((_commando, _argumenten, options): ProcesUitkomst => {
      if (options.cwd !== undefined) cwds.push(options.cwd);
      return { code: 0, stdout: '' };
    });

    verify({ cwd: tmpDir, snel: true });

    // Alle draaiScript-aanroepen moeten de meegegeven cwd gebruiken, niet process.cwd().
    expect(cwds.length).toBeGreaterThan(0);
    for (const cwd of cwds) {
      expect(cwd).toBe(tmpDir);
    }
  });

  it('toont de meegegeven cwd in de foutmelding als package.json niet bestaat', () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'verify-cwd-fout-'));
    // Geen package.json in tmpDir.

    origineleCwd = process.cwd();
    process.chdir(tmpdir());

    stelUitvoerderIn((): ProcesUitkomst => ({ code: 0, stdout: '' }));

    expect(() => {
      verify({ cwd: tmpDir });
    }).toThrow(tmpDir);
  });
});

describe('beschikbareScripts — OmgevingsFout (#383)', () => {
  it('gooit OmgevingsFout bij een onbestaande map, niet GebruikersFout', () => {
    const onbestaand = path.join(tmpdir(), 'bestaat-niet-' + String(Date.now()));
    expect(() => beschikbareScripts(onbestaand)).toThrow(OmgevingsFout);
  });
});

// ---------------------------------------------------------------------------
// leesDiffTegenMain — git-interactie
// ---------------------------------------------------------------------------

describe('leesDiffTegenMain', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  it('levert de diff-uitvoer op een branch met merge-base', () => {
    const verwachteDiff = 'diff --git a/foo.ts b/foo.ts\n';
    stelUitvoerderIn((_cmd, args): ProcesUitkomst => {
      if (args.includes('--abbrev-ref')) return { code: 0, stdout: 'slice/516-1\n' };
      if (args.includes('merge-base')) return { code: 0, stdout: 'abc123\n' };
      if (args.includes('diff')) return { code: 0, stdout: verwachteDiff };
      return { code: 0, stdout: '' };
    });
    expect(leesDiffTegenMain('/repo')).toBe(verwachteDiff);
  });

  it('geeft undefined op main', () => {
    stelUitvoerderIn((_cmd, args): ProcesUitkomst => {
      if (args.includes('--abbrev-ref')) return { code: 0, stdout: 'main\n' };
      return { code: 0, stdout: '' };
    });
    expect(leesDiffTegenMain('/repo')).toBeUndefined();
  });

  it('geeft undefined bij een detached HEAD', () => {
    stelUitvoerderIn((_cmd, args): ProcesUitkomst => {
      if (args.includes('--abbrev-ref')) return { code: 0, stdout: 'HEAD\n' };
      return { code: 0, stdout: '' };
    });
    expect(leesDiffTegenMain('/repo')).toBeUndefined();
  });

  it('geeft undefined als merge-base faalt (geen common ancestor)', () => {
    stelUitvoerderIn((_cmd, args): ProcesUitkomst => {
      if (args.includes('--abbrev-ref')) return { code: 0, stdout: 'feature\n' };
      if (args.includes('merge-base')) return { code: 1, stdout: '' };
      return { code: 0, stdout: '' };
    });
    expect(leesDiffTegenMain('/repo')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toetsDiffDekking — de gate in verify
// ---------------------------------------------------------------------------

/**
 * Bouwt een istanbul CoverageMapData voor één bestand. `regels` is een record van
 * regelnummer → hitcount; regels die ontbreken tellen als niet-uitvoerbaar.
 */
function maakCoverageData(absoluutPad: string, regels: Record<number, number>): CoverageMapData {
  const statementMap: Record<string, unknown> = {};
  const s: Record<string, number> = {};
  let idx = 0;
  for (const [regel, hits] of Object.entries(regels)) {
    const key = String(idx++);
    const line = Number(regel);
    statementMap[key] = {
      start: { line, column: 0 },
      end: { line, column: 10 },
    };
    s[key] = hits;
  }
  return {
    [absoluutPad]: {
      path: absoluutPad,
      statementMap,
      fnMap: {},
      branchMap: {},
      s,
      f: {},
      b: {},
    },
  } as unknown as CoverageMapData;
}

function maakConfig(ratchet: 'uit' | 'waarschuw' | 'blokkeer', diffMin = 80): DekkingsConfig {
  return {
    dir: '/tmp/test',
    dekkingsRatchet: ratchet,
    dekkingsTolerantie: 0.5,
    diffDekkingsMinimum: diffMin,
  };
}

describe('toetsDiffDekking', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  /** Stub die git-aanroepen beantwoordt met een diff van src/foo.ts regels 1-3. */
  function stubGitDiff(): void {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -0,0 +1,3 @@',
    ].join('\n');
    stelUitvoerderIn((_cmd, args): ProcesUitkomst => {
      if (args.includes('--abbrev-ref')) return { code: 0, stdout: 'slice/516-1\n' };
      if (args.includes('merge-base')) return { code: 0, stdout: 'abc\n' };
      if (args.includes('diff')) return { code: 0, stdout: diff };
      return { code: 0, stdout: '' };
    });
  }

  it('gooit GebruikersFout als diff-dekking onder drempel zakt bij blokkeer', () => {
    stubGitDiff();
    const absoluut = path.resolve('/repo', 'src/foo.ts');
    // Regel 1 gedekt, regels 2 en 3 ongedekt → 33%
    const data = maakCoverageData(absoluut, { 1: 1, 2: 0, 3: 0 });
    const map = libCoverage.createCoverageMap(data);

    expect(() => {
      toetsDiffDekking('/repo', maakConfig('blokkeer'), map);
    }).toThrow(GebruikersFout);
  });

  it('waarschuwt maar gooit niet bij waarschuw als diff-dekking onder drempel zakt', () => {
    stubGitDiff();
    const absoluut = path.resolve('/repo', 'src/foo.ts');
    const data = maakCoverageData(absoluut, { 1: 1, 2: 0, 3: 0 });
    const map = libCoverage.createCoverageMap(data);

    // Mag niet gooien.
    expect(() => {
      toetsDiffDekking('/repo', maakConfig('waarschuw'), map);
    }).not.toThrow();
  });

  it('gooit niet als diff-dekking boven de drempel zit', () => {
    stubGitDiff();
    const absoluut = path.resolve('/repo', 'src/foo.ts');
    // Alle 3 regels gedekt → 100%
    const data = maakCoverageData(absoluut, { 1: 1, 2: 1, 3: 1 });
    const map = libCoverage.createCoverageMap(data);

    expect(() => {
      toetsDiffDekking('/repo', maakConfig('blokkeer'), map);
    }).not.toThrow();
  });

  it('slaat over op main', () => {
    stelUitvoerderIn((_cmd, args): ProcesUitkomst => {
      if (args.includes('--abbrev-ref')) return { code: 0, stdout: 'main\n' };
      return { code: 0, stdout: '' };
    });
    const map = libCoverage.createCoverageMap({});

    // Op main: geen fout, zelfs bij blokkeer met lege coverage.
    expect(() => {
      toetsDiffDekking('/repo', maakConfig('blokkeer'), map);
    }).not.toThrow();
  });

  it('meldt ongedekte regelnummers per bestand in de foutmelding', () => {
    stubGitDiff();
    const absoluut = path.resolve('/repo', 'src/foo.ts');
    const data = maakCoverageData(absoluut, { 1: 1, 2: 0, 3: 0 });
    const map = libCoverage.createCoverageMap(data);

    try {
      toetsDiffDekking('/repo', maakConfig('blokkeer'), map);
      expect.unreachable('had moeten gooien');
    } catch (e) {
      expect(e).toBeInstanceOf(GebruikersFout);
      const melding = (e as GebruikersFout).message;
      expect(melding).toContain('src/foo.ts');
      expect(melding).toContain('2');
      expect(melding).toContain('3');
      expect(melding).toContain('33.33');
      expect(melding).toContain('80');
    }
  });

  it('respecteert een afwijkende diffDekkingsMinimum', () => {
    stubGitDiff();
    const absoluut = path.resolve('/repo', 'src/foo.ts');
    // 1 van 3 gedekt → 33%; drempel op 30 → groen
    const data = maakCoverageData(absoluut, { 1: 1, 2: 0, 3: 0 });
    const map = libCoverage.createCoverageMap(data);

    expect(() => {
      toetsDiffDekking('/repo', maakConfig('blokkeer', 30), map);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Aggregaat-ratchet is altijd informatief (#516)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// aantalWaarschuwingen / resetWaarschuwingen (#589)
// ---------------------------------------------------------------------------

describe('aantalWaarschuwingen', () => {
  afterEach(() => {
    resetWaarschuwingen();
  });

  it('telt het aantal waarschuwingen en reset zet op nul', () => {
    resetWaarschuwingen();
    expect(aantalWaarschuwingen()).toBe(0);
    waarschuwing('test 1');
    waarschuwing('test 2');
    expect(aantalWaarschuwingen()).toBe(2);
    resetWaarschuwingen();
    expect(aantalWaarschuwingen()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// verify — eindregel (#589)
// ---------------------------------------------------------------------------

describe('verify — eindregel respecteert waarschuwingen', () => {
  afterEach(() => {
    herstelUitvoerder();
    resetWaarschuwingen();
  });

  /** Vangt stdout op en geeft de inhoud terug na de callback. */
  function vangStdout(fn: () => void): string {
    const stukken: string[] = [];
    const origineel = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      stukken.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    };
    try {
      fn();
    } finally {
      process.stdout.write = origineel;
    }
    return stukken.join('');
  }

  /** Maakt een tmp-map met alleen niet-coverage scripts, zodat de volledige poort
   *  geen coverage-merge-waarschuwing produceert. Audit geeft een leeg rapport. */
  function maakSchoneVerifyDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'verify-schoon-'));
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        scripts: {
          'format:check': 'echo ok',
          lint: 'echo ok',
          typecheck: 'echo ok',
          build: 'echo ok',
        },
      }),
    );
    return dir;
  }

  it('eindigt met "Alles groen" als er geen waarschuwingen zijn', () => {
    // Gebruik een dir zonder test-scripts zodat er geen coverage-waarschuwingen komen,
    // en geef de audit schone JSON terug zodat die ook geen waarschuwing genereert.
    const schoneAudit = JSON.stringify({
      metadata: { vulnerabilities: { high: 0, critical: 0 } },
    });
    stelUitvoerderIn((_cmd, args): ProcesUitkomst => {
      if (args.includes('audit')) return { code: 0, stdout: schoneAudit };
      return { code: 0, stdout: '' };
    });
    const uitvoer = vangStdout(() => {
      verify({ cwd: maakSchoneVerifyDir() });
    });
    expect(uitvoer).toContain('Alles groen');
    expect(uitvoer).not.toContain('Klaar met waarschuwingen');
  });

  it('eindigt met een neutrale afsluiter als er een audit-waarschuwing was', () => {
    // Simuleer: alle stappen groen, maar audit meldt een kwetsbaarheid.
    const auditJson = JSON.stringify({
      metadata: { vulnerabilities: { high: 1 } },
    });
    stelUitvoerderIn((_cmd, args): ProcesUitkomst => {
      if (args.includes('audit')) return { code: 1, stdout: auditJson };
      return { code: 0, stdout: '' };
    });
    const uitvoer = vangStdout(() => {
      verify({ cwd: maakSchoneVerifyDir() });
    });
    expect(uitvoer).toContain('Klaar met waarschuwingen');
    expect(uitvoer).not.toContain('Alles groen');
  });

  it('telt --snel "overgeslagen"-meldingen niet als kwaliteitswaarschuwing', () => {
    stelUitvoerderIn((): ProcesUitkomst => ({ code: 0, stdout: '' }));
    const uitvoer = vangStdout(() => {
      verify({ cwd: maakVerifyDir(), snel: true });
    });
    // --snel slaat e2e over met een waarschuwing, maar de eindregel moet "Alles groen" zijn.
    expect(uitvoer).toContain('Alles groen');
    expect(uitvoer).not.toContain('Klaar met waarschuwingen');
  });
});

// ---------------------------------------------------------------------------
// toetsAfhankelijkheden draait --prod (#589)
// ---------------------------------------------------------------------------

describe('toetsAfhankelijkheden draait --prod', () => {
  it('bevat --prod in de pnpm audit-aanroep', () => {
    const bron = readFileSync(
      path.join(import.meta.dirname, '..', 'src', 'commands', 'verify.ts'),
      'utf8',
    );
    // Zoek de audit-aanroep en verifieer dat --prod erin staat.
    expect(bron).toContain("'audit', '--prod', '--json'");
  });
});

describe('verify — aggregaat-ratchet is altijd informatief', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  it('gooit geen GebruikersFout bij een ratchet-regressie met blokkeer', () => {
    // De aggregaat-ratchet is altijd informatief (#516). We verifiëren dat
    // pasRatchetToe nooit een fout gooit door de broncode te inspecteren:
    // de functie mag geen `throw` of `GebruikersFout` bevatten.
    const bron = readFileSync(
      path.join(import.meta.dirname, '..', 'src', 'commands', 'verify.ts'),
      'utf8',
    );
    const start = bron.indexOf('function pasRatchetToe');
    const einde = bron.indexOf('\n}\n', start);
    const functie = bron.slice(start, einde + 2);
    expect(functie).not.toContain('throw');
    expect(functie).not.toContain('GebruikersFout');
  });
});
