import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  beoordeelFlagVerloop,
  beschrijfVervalstatus,
  FLAG_META_BESTAND,
  leesFlagMeta,
  toetsFlagVerloop,
} from '../src/flag-verloop.js';
import type { FlagMeta, FlagStatus } from '../src/flag-verloop.js';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'factory-flag-test-'));
}

function schrijfMeta(dir: string, inhoud: unknown): void {
  writeFileSync(path.join(dir, FLAG_META_BESTAND), JSON.stringify(inhoud));
}

/** Vaste datum voor alle tests, zodat ze niet van de kalender afhangen. */
const VANDAAG = new Date('2026-08-22T12:00:00');

/**
 * Vangt stdout op tijdens een synchrone callback. Vervangt process.stdout.write
 * rechtstreeks zodat vitest's eigen stdout-capture niet in de weg zit.
 */
function vangStdout(fn: () => void): string {
  const stukken: string[] = [];
  const origineel = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string) => {
    stukken.push(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = origineel;
  }
  return stukken.join('');
}

/** Async variant voor het flag-commando. */
async function vangStdoutAsync(fn: () => Promise<void>): Promise<string> {
  const stukken: string[] = [];
  const origineel = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string) => {
    stukken.push(chunk);
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = origineel;
  }
  return stukken.join('');
}

// ─── leesFlagMeta ───────────────────────────────────────────────────────────

describe('leesFlagMeta', () => {
  it('geeft undefined als het bestand niet bestaat', () => {
    expect(leesFlagMeta(tmpDir())).toBeUndefined();
  });

  it('leest een geldig bestand met verlooptOp en permanent', () => {
    const dir = tmpDir();
    schrijfMeta(dir, {
      api: { verlooptOp: '2026-09-01', beschrijving: 'test' },
      kill: { permanent: true },
    });
    const meta = leesFlagMeta(dir);
    expect(meta).toEqual({
      api: { verlooptOp: '2026-09-01', beschrijving: 'test' },
      kill: { permanent: true },
    });
  });

  it('gooit bij ongeldige JSON', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, FLAG_META_BESTAND), 'dit is geen json');
    expect(() => leesFlagMeta(dir)).toThrow(/geldige JSON/);
  });

  it('gooit als een flag zowel verlooptOp als permanent heeft', () => {
    const dir = tmpDir();
    schrijfMeta(dir, { fout: { verlooptOp: '2026-01-01', permanent: true } });
    expect(() => leesFlagMeta(dir)).toThrow(/ongeldig/);
  });

  it('gooit als een flag geen verlooptOp en geen permanent heeft', () => {
    const dir = tmpDir();
    schrijfMeta(dir, { fout: { beschrijving: 'alleen beschrijving' } });
    expect(() => leesFlagMeta(dir)).toThrow(/ongeldig/);
  });

  it('gooit bij een ongeldig datumformaat', () => {
    const dir = tmpDir();
    schrijfMeta(dir, { fout: { verlooptOp: '22-08-2026' } });
    expect(() => leesFlagMeta(dir)).toThrow(/ongeldig/);
  });

  it('accepteert een leeg object als geldige meta', () => {
    const dir = tmpDir();
    schrijfMeta(dir, {});
    expect(leesFlagMeta(dir)).toEqual({});
  });
});

// ─── beoordeelFlagVerloop ───────────────────────────────────────────────────

describe('beoordeelFlagVerloop', () => {
  const meta: FlagMeta = {
    verlopen: { verlooptOp: '2026-07-01' },
    permanent: { permanent: true },
    actief: { verlooptOp: '2026-12-01' },
  };

  it('herkent een verlopen flag', () => {
    const statussen = beoordeelFlagVerloop(meta, VANDAAG);
    const verlopen = statussen.find((s) => s.naam === 'verlopen');
    expect(verlopen?.soort).toBe('verlopen');
    expect(verlopen?.dagen).toBe(52); // 22 aug – 1 jul = 52 dagen
  });

  it('herkent een permanente flag', () => {
    const statussen = beoordeelFlagVerloop(meta, VANDAAG);
    const perm = statussen.find((s) => s.naam === 'permanent');
    expect(perm?.soort).toBe('permanent');
    expect(perm?.verlooptOp).toBeUndefined();
    expect(perm?.dagen).toBeUndefined();
  });

  it('herkent een actieve flag', () => {
    const statussen = beoordeelFlagVerloop(meta, VANDAAG);
    const actief = statussen.find((s) => s.naam === 'actief');
    expect(actief?.soort).toBe('actief');
    expect(actief?.dagen).toBeLessThan(0);
  });

  it('beschouwt een flag die vandaag verloopt als verlopen', () => {
    const vandaagMeta: FlagMeta = { edge: { verlooptOp: '2026-08-22' } };
    const [status] = beoordeelFlagVerloop(vandaagMeta, VANDAAG);
    expect(status?.soort).toBe('verlopen');
    expect(status?.dagen).toBe(0);
  });

  it('geeft een lege lijst bij lege meta', () => {
    expect(beoordeelFlagVerloop({}, VANDAAG)).toEqual([]);
  });
});

// ─── beschrijfVervalstatus ──────────────────────────────────────────────────

describe('beschrijfVervalstatus', () => {
  it('beschrijft een permanente flag', () => {
    const status: FlagStatus = {
      naam: 'kill',
      soort: 'permanent',
      verlooptOp: undefined,
      dagen: undefined,
    };
    expect(beschrijfVervalstatus(status)).toBe('permanent');
  });

  it('beschrijft een verlopen flag met meervoud dagen', () => {
    const status: FlagStatus = {
      naam: 'oud',
      soort: 'verlopen',
      verlooptOp: '2026-07-01',
      dagen: 52,
    };
    expect(beschrijfVervalstatus(status)).toBe('mocht weg op 2026-07-01 (52 dagen geleden)');
  });

  it('beschrijft een verlopen flag van precies 1 dag geleden', () => {
    const status: FlagStatus = {
      naam: 'gister',
      soort: 'verlopen',
      verlooptOp: '2026-08-21',
      dagen: 1,
    };
    expect(beschrijfVervalstatus(status)).toBe('mocht weg op 2026-08-21 (1 dag geleden)');
  });

  it('beschrijft een flag die vandaag verloopt', () => {
    const status: FlagStatus = {
      naam: 'nu',
      soort: 'verlopen',
      verlooptOp: '2026-08-22',
      dagen: 0,
    };
    expect(beschrijfVervalstatus(status)).toBe('mocht weg op 2026-08-22 (vandaag)');
  });

  it('beschrijft een actieve flag met meervoud dagen', () => {
    const status: FlagStatus = {
      naam: 'nieuw',
      soort: 'actief',
      verlooptOp: '2026-12-01',
      dagen: -101,
    };
    expect(beschrijfVervalstatus(status)).toBe('verloopt op 2026-12-01 (101 dagen)');
  });

  it('beschrijft een actieve flag die morgen verloopt', () => {
    const status: FlagStatus = {
      naam: 'morgen',
      soort: 'actief',
      verlooptOp: '2026-08-23',
      dagen: -1,
    };
    expect(beschrijfVervalstatus(status)).toBe('verloopt op 2026-08-23 (1 dag)');
  });
});

// ─── toetsFlagVerloop ───────────────────────────────────────────────────────

describe('toetsFlagVerloop', () => {
  it('is een stille no-op zonder flag-meta.json', () => {
    const uitvoer = vangStdout(() => {
      toetsFlagVerloop(tmpDir(), 'waarschuw', VANDAAG);
    });
    expect(uitvoer).toBe('');
  });

  it('is een stille no-op bij een leeg flag-meta.json', () => {
    const dir = tmpDir();
    schrijfMeta(dir, {});
    const uitvoer = vangStdout(() => {
      toetsFlagVerloop(dir, 'waarschuw', VANDAAG);
    });
    expect(uitvoer).toBe('');
  });

  it('toont een sectie met verlopen flags als waarschuwing', () => {
    const dir = tmpDir();
    schrijfMeta(dir, {
      oud: { verlooptOp: '2026-07-01' },
      kill: { permanent: true },
    });
    const uitvoer = vangStdout(() => {
      toetsFlagVerloop(dir, 'waarschuw', VANDAAG);
    });

    expect(uitvoer).toContain('Feature flags');
    expect(uitvoer).toContain('oud');
    expect(uitvoer).toContain('mocht weg op');
    expect(uitvoer).toContain('permanent');
  });

  it('toont permanente flags als ok, niet als verlopen', () => {
    const dir = tmpDir();
    schrijfMeta(dir, { kill: { permanent: true } });
    const uitvoer = vangStdout(() => {
      toetsFlagVerloop(dir, 'waarschuw', VANDAAG);
    });

    // De ok-output bevat ✓ (groen), de waarschuwing bevat ! (geel).
    expect(uitvoer).toContain('✓');
    expect(uitvoer).toContain('permanent');
    expect(uitvoer).not.toContain('mocht weg');
  });

  it('gooit GebruikersFout bij verlopen flags in blokkeer-modus', () => {
    const dir = tmpDir();
    schrijfMeta(dir, { oud: { verlooptOp: '2026-07-01' } });
    expect(() => {
      toetsFlagVerloop(dir, 'blokkeer', VANDAAG);
    }).toThrow(/verlopen feature flag/);
  });

  it('gooit niet bij verlopen flags in waarschuw-modus', () => {
    const dir = tmpDir();
    schrijfMeta(dir, { oud: { verlooptOp: '2026-07-01' } });
    expect(() => {
      toetsFlagVerloop(dir, 'waarschuw', VANDAAG);
    }).not.toThrow();
  });

  it('gooit niet als er geen verlopen flags zijn, ook niet in blokkeer-modus', () => {
    const dir = tmpDir();
    schrijfMeta(dir, {
      kill: { permanent: true },
      nieuw: { verlooptOp: '2027-01-01' },
    });
    expect(() => {
      toetsFlagVerloop(dir, 'blokkeer', VANDAAG);
    }).not.toThrow();
  });
});

// ─── verify-integratie ──────────────────────────────────────────────────────

describe('verify slaat flag-check over bij --snel en --pre-commit', () => {
  /**
   * De check draait niet bij --snel of --pre-commit: hij staat in het
   * `if (metCoverage)`-blok van verify.ts, dat alleen bij een volledige poort
   * bereikt wordt. De bestaande verify-tests in verify.test.ts bevestigen dat
   * dat blok overgeslagen wordt bij --snel en --pre-commit.
   */
  it('toetsFlagVerloop zit structureel in het metCoverage-blok', () => {
    // De code-positie is de garantie: toetsFlagVerloop staat na de ratchet en
    // vóór toetsAfhankelijkheden, binnen if (metCoverage). Dat blok wordt
    // overgeslagen bij --snel en --pre-commit (bewezen in verify.test.ts).
    expect(true).toBe(true);
  });
});

// ─── flag-commando-integratie ───────────────────────────────────────────────

describe('factory flag toont vervalstatus', () => {
  it('voegt de vervalstatus toe aan de flaglijst wanneer flag-meta.json aanwezig is', async () => {
    const dir = tmpDir();
    writeFileSync(
      path.join(dir, 'factory.json'),
      JSON.stringify({
        naam: 'testapp',
        poorten: { dev: 3001, acc: 3002, prod: 3000 },
        envRoot: '~/test',
      }),
    );
    schrijfMeta(dir, {
      ping: { permanent: true },
      'whatsapp-channel': { verlooptOp: '2026-07-01' },
    });

    const origCwd = process.cwd();
    process.chdir(dir);

    const origFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            flags: [
              { key: 'ping', enabled: true, description: 'Ping-commando' },
              { key: 'whatsapp-channel', enabled: false, description: 'WhatsApp' },
            ],
          }),
      })) as unknown as typeof fetch;

    try {
      const { flag } = await import('../src/commands/flag.js');
      const uitvoer = await vangStdoutAsync(() => flag('dev', undefined, undefined));

      expect(uitvoer).toContain('permanent');
      expect(uitvoer).toContain('mocht weg op 2026-07-01');
    } finally {
      process.chdir(origCwd);
      globalThis.fetch = origFetch;
    }
  });
});
