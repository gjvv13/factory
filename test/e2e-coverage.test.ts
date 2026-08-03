import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { e2eCoverageEnv, schrijfE2eDekking } from '../src/e2e-coverage.js';

const require = createRequire(import.meta.url);
// De tsx-loader zelf-registreert bij `--import`, net als de e2e-server in productie.
const TSX_IMPORT = pathToFileURL(require.resolve('tsx')).href;

// classify(3) neemt de 'klein'-tak, dus de 'groot'-tak blijft ongedekt: het cijfer
// hoort onder 100% te liggen. De import van seed voert dat bestand uit, zodat we
// kunnen bewijzen dat de exclude het er alsnog uit houdt.
const PROBE_TS = `import { seed } from './db/seed.js';
export function classify(n: number): string {
  if (n > 10) {
    return 'groot';
  }
  return 'klein';
}
process.stdout.write(classify(3) + String(seed) + '\\n');
`;

/** Bouwt een minimale app-map met een uitvoerbare probe onder app/src. */
function maakApp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'factory-e2ecov-'));
  mkdirSync(path.join(dir, 'app', 'src', 'db'), { recursive: true });
  writeFileSync(path.join(dir, 'app', 'src', 'probe.ts'), PROBE_TS);
  writeFileSync(path.join(dir, 'app', 'src', 'db', 'seed.ts'), 'export const seed = 1;\n');
  return dir;
}

function summaryVan(appDir: string): Record<string, { lines: { pct: number } }> {
  const bestand = path.join(appDir, 'coverage', 'e2e', 'coverage-summary.json');
  return JSON.parse(readFileSync(bestand, 'utf8')) as Record<string, { lines: { pct: number } }>;
}

describe('e2e-coverage', () => {
  const origineel = process.env.FACTORY_COVERAGE;
  afterEach(() => {
    if (origineel === undefined) {
      delete process.env.FACTORY_COVERAGE;
    } else {
      process.env.FACTORY_COVERAGE = origineel;
    }
  });

  it('e2eCoverageEnv geeft niets zonder een coverage-poort', () => {
    delete process.env.FACTORY_COVERAGE;

    expect(e2eCoverageEnv(maakApp())).toEqual({});
  });

  it('e2eCoverageEnv wijst NODE_V8_COVERAGE naar een verse coverage/e2e-server/raw', () => {
    process.env.FACTORY_COVERAGE = '1';
    const app = maakApp();

    const env = e2eCoverageEnv(app);

    expect(env.NODE_V8_COVERAGE).toBe(path.join(app, 'coverage', 'e2e-server', 'raw'));
    expect(existsSync(env.NODE_V8_COVERAGE!)).toBe(true);
  });

  it('schrijft geen rapport als er geen raw-coverage is', async () => {
    process.env.FACTORY_COVERAGE = '1';
    const app = maakApp();

    await schrijfE2eDekking(app);

    expect(existsSync(path.join(app, 'coverage', 'e2e', 'coverage-summary.json'))).toBe(false);
  });

  it('zet de server-coverage om naar coverage/e2e, gescoped op app/src minus de exclude', async () => {
    process.env.FACTORY_COVERAGE = '1';
    const app = maakApp();
    const oorspronkelijk = process.cwd();
    process.chdir(app);
    try {
      const env = { ...process.env, ...e2eCoverageEnv(app) };
      const uitkomst = spawnSync(process.execPath, ['--import', TSX_IMPORT, 'app/src/probe.ts'], {
        cwd: app,
        env,
        encoding: 'utf8',
      });
      expect(uitkomst.status).toBe(0);

      await schrijfE2eDekking(app);

      const summary = summaryVan(app);
      const bestanden = Object.keys(summary);
      const probe = bestanden.find((f) => f.endsWith('probe.ts'));
      // De echte server-executie telt mee...
      expect(probe).toBeDefined();
      // ...en de ongedekte 'groot'-tak drukt het onder 100%.
      expect(summary[probe!]!.lines.pct).toBeGreaterThan(0);
      expect(summary[probe!]!.lines.pct).toBeLessThan(100);
      // seed.ts draaide wel, maar staat in de standaard-exclude; node_modules valt buiten include.
      expect(bestanden.some((f) => f.includes('seed'))).toBe(false);
      expect(bestanden.some((f) => f.includes('node_modules'))).toBe(false);
    } finally {
      process.chdir(oorspronkelijk);
    }
  });
});
