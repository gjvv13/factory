import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { e2eCoverageEnv, schrijfE2eDekking } from '../../src/e2e-coverage.js';
import { schrijfGecombineerdeDekking } from '../../src/coverage-merge.js';

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

// Een probe die één bestand per laag uitvoert: core, clients, http én de losse probe.
// Nu de laag-uitsluiting weg is (#473) horen alle vier in de e2e-meting te verschijnen.
const PROBE_LAGEN_TS = `import { dom } from './core/dom.js';
import { net } from './clients/net.js';
import { route } from './http/route.js';
process.stdout.write(String(dom + net + route) + '\\n');
`;

function maakAppMetLagen(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'factory-e2ecov-lagen-'));
  for (const sub of ['core', 'clients', 'http']) {
    mkdirSync(path.join(dir, 'app', 'src', sub), { recursive: true });
  }
  writeFileSync(path.join(dir, 'app', 'src', 'core', 'dom.ts'), 'export const dom = 1;\n');
  writeFileSync(path.join(dir, 'app', 'src', 'clients', 'net.ts'), 'export const net = 2;\n');
  writeFileSync(path.join(dir, 'app', 'src', 'http', 'route.ts'), 'export const route = 3;\n');
  writeFileSync(path.join(dir, 'app', 'src', 'probe.ts'), PROBE_LAGEN_TS);
  return dir;
}

function summaryVan(appDir: string): Record<string, { lines: { pct: number } }> {
  const bestand = path.join(appDir, 'coverage', 'e2e', 'coverage-summary.json');
  return JSON.parse(readFileSync(bestand, 'utf8')) as Record<string, { lines: { pct: number } }>;
}

/** Draait de probe als apart Node-proces met v8-coverage en schrijft het e2e-rapport. */
async function draaiEnSchrijf(app: string): Promise<void> {
  const env = { ...process.env, ...e2eCoverageEnv(app) };
  const uitkomst = spawnSync(process.execPath, ['--import', TSX_IMPORT, 'app/src/probe.ts'], {
    cwd: app,
    env,
    encoding: 'utf8',
  });
  expect(uitkomst.status).toBe(0);
  await schrijfE2eDekking(app);
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

  it('meet alle lagen — inclusief core en clients — in de e2e-meting (#473)', async () => {
    process.env.FACTORY_COVERAGE = '1';
    const app = maakAppMetLagen();
    const oorspronkelijk = process.cwd();
    process.chdir(app);
    try {
      await draaiEnSchrijf(app);
      const bestanden = Object.keys(summaryVan(app));

      // core/ en clients/ worden nu wél gemeten door de e2e-meting.
      expect(bestanden.some((f) => f.includes(`${path.sep}core${path.sep}`))).toBe(true);
      expect(bestanden.some((f) => f.includes(`${path.sep}clients${path.sep}`))).toBe(true);
      // http/ en de losse probe zijn altijd e2e-eigen → ook gemeten.
      expect(bestanden.some((f) => f.endsWith('route.ts'))).toBe(true);
      expect(bestanden.some((f) => f.endsWith('probe.ts'))).toBe(true);
    } finally {
      process.chdir(oorspronkelijk);
    }
  });

  it('een e2e-only-bestand verschijnt in combined met >0% dekking (#473)', async () => {
    process.env.FACTORY_COVERAGE = '1';
    const app = maakAppMetLagen();
    const oorspronkelijk = process.cwd();
    process.chdir(app);
    try {
      // Geen unit/contract-dekking: alleen het e2e-rapport schrijven.
      await draaiEnSchrijf(app);

      // clients/net.ts is alleen door de e2e-server uitgevoerd, niet door unit of contract.
      // In de gecombineerde merge moet het verschijnen met >0% dekking.
      const resultaat = schrijfGecombineerdeDekking(app);
      expect(resultaat).toBeDefined();

      const combinedSummary = JSON.parse(
        readFileSync(path.join(app, 'coverage', 'combined', 'coverage-summary.json'), 'utf8'),
      ) as Record<string, { lines: { pct: number } }>;
      const clientBestanden = Object.entries(combinedSummary).filter(([f]) =>
        f.includes(`${path.sep}clients${path.sep}`),
      );
      expect(clientBestanden.length).toBeGreaterThan(0);
      for (const [, waarde] of clientBestanden) {
        expect(waarde.lines.pct).toBeGreaterThan(0);
      }
    } finally {
      process.chdir(oorspronkelijk);
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
      await draaiEnSchrijf(app);

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
