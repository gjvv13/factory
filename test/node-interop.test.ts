import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Vitest transformeert modules zelf en maskeert daarmee ESM/CJS-interopfouten: een
 * verkeerde import (bv. `import * as` op een CJS-pakket zonder benoemde exports) slaagt
 * hier, maar crasht onder echte Node. Deze test draait de gebouwde `dist`-modules die
 * CJS-pakketten importeren (`istanbul-lib-*`, `c8`) in een écht `node`-proces, zodat
 * zo'n interop-regressie CI rood maakt in plaats van pas in een app op te duiken.
 */

const require = createRequire(import.meta.url);
const DIST = path.join(import.meta.dirname, '..', 'dist');
// De tsx-loader zelf-registreert bij `--import`, net als de e2e-server in productie.
const TSX_IMPORT = pathToFileURL(require.resolve('tsx')).href;

// Draait één van de dist-modules in een apart node-proces en geeft het resultaat terug.
const DRIVER = `
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [distDir, appDir, welke] = process.argv.slice(2);
const laad = (m) => import(pathToFileURL(path.join(distDir, m)).href);
if (welke === 'merge') {
  const { schrijfGecombineerdeDekking } = await laad('coverage-merge.js');
  const cijfers = schrijfGecombineerdeDekking(appDir);
  if (typeof cijfers?.lines !== 'number') {
    console.error('merge gaf geen cijfers terug: ' + String(cijfers));
    process.exit(1);
  }
  console.log('OK ' + cijfers.lines);
} else {
  const { schrijfE2eDekking } = await laad('e2e-coverage.js');
  await schrijfE2eDekking(appDir);
  console.log('OK');
}
`;

function maakApp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'factory-interop-'));
  writeFileSync(path.join(dir, 'driver.mjs'), DRIVER);
  return dir;
}

/** Een istanbul-map (coverage-final.json) voor één bestand met een statement per regel. */
function schrijfUnitFinal(appDir: string, hits: readonly number[]): void {
  const bestand = path.join(appDir, 'app', 'src', 'foo.ts');
  const statementMap: Record<string, unknown> = {};
  const s: Record<string, number> = {};
  hits.forEach((hit, i) => {
    statementMap[String(i)] = {
      start: { line: i + 1, column: 0 },
      end: { line: i + 1, column: 5 },
    };
    s[String(i)] = hit;
  });
  const dir = path.join(appDir, 'coverage', 'unit');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'coverage-final.json'),
    JSON.stringify({
      [bestand]: { path: bestand, statementMap, fnMap: {}, branchMap: {}, s, f: {}, b: {} },
    }),
  );
}

function draaiDriver(appDir: string, welke: 'merge' | 'e2e'): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [path.join(appDir, 'driver.mjs'), DIST, appDir, welke], {
    cwd: appDir,
    env: { ...process.env, FACTORY_COVERAGE: '1' },
    encoding: 'utf8',
  });
}

describe('dist-modules onder echte Node (ESM/CJS-interop)', () => {
  it('coverage-merge merget istanbul-maps zonder interop-fout', () => {
    const app = maakApp();
    schrijfUnitFinal(app, [1, 0]); // 1 van 2 regels gedekt → 50%

    const uitkomst = draaiDriver(app, 'merge');

    expect(uitkomst.status, String(uitkomst.stderr)).toBe(0);
    expect(uitkomst.stdout).toContain('OK 50');
    expect(existsSync(path.join(app, 'coverage', 'combined', 'coverage-summary.json'))).toBe(true);
  });

  it('e2e-coverage draait c8 zonder interop-fout', () => {
    const app = maakApp();
    mkdirSync(path.join(app, 'app', 'src'), { recursive: true });
    writeFileSync(
      path.join(app, 'app', 'src', 'probe.ts'),
      `export function classify(n: number): string {\n  if (n > 10) {\n    return 'groot';\n  }\n  return 'klein';\n}\nprocess.stdout.write(classify(3) + '\\n');\n`,
    );
    const rawDir = path.join(app, 'coverage', 'e2e-server', 'raw');
    mkdirSync(rawDir, { recursive: true });
    const probe = spawnSync(process.execPath, ['--import', TSX_IMPORT, 'app/src/probe.ts'], {
      cwd: app,
      env: { ...process.env, NODE_V8_COVERAGE: rawDir },
      encoding: 'utf8',
    });
    expect(probe.status, probe.stderr).toBe(0);

    const uitkomst = draaiDriver(app, 'e2e');

    expect(uitkomst.status, String(uitkomst.stderr)).toBe(0);
    const summary = JSON.parse(
      readFileSync(path.join(app, 'coverage', 'e2e', 'coverage-summary.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(summary).some((f) => f.endsWith('probe.ts'))).toBe(true);
  });
});
