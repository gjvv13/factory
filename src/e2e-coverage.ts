import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Report } from 'c8';

/**
 * Coverage van de e2e-server komt niet uit vitest: die meet het testproces, terwijl
 * de applicatie als apart proces draait — daardoor telde e2e tot nu toe ~0%. In plaats
 * daarvan schrijft Node de ruwe v8-coverage van de server naar `NODE_V8_COVERAGE`, en
 * zet c8 die (met de tsx-sourcemaps, die het testproces niet kan uitlezen) om naar een
 * istanbul-rapport op de vaste plek `coverage/e2e/`. Zo telt de echte server-executie
 * mee, én levert dit meteen de istanbul-map die de merge (aparte slice) nodig heeft.
 *
 * Hierdoor is `coverage/e2e/` server-afgeleid in plaats van testproces-afgeleid; de
 * e2e-preset zet daarom geen vitest-coverage meer (zie `configs/vitest-e2e.js`).
 */

/** Ruwe v8-coverage van de server; tussenproduct dat c8 inleest. */
const RAW_SUBPAD = path.join('coverage', 'e2e-server', 'raw');
/** Waar het per-soort e2e-rapport belandt (leest de beheer-tool; voedt de merge). */
const E2E_SUBPAD = path.join('coverage', 'e2e');

/**
 * Bestanden die geen enkele testsoort zinvol dekt — dezelfde lijst als de `exclude`
 * in `configs/coverage.js`. Hier apart omdat dit TypeScript in het pakket is en die
 * config los JavaScript; het is dezelfde korte, bewuste opsomming.
 */
const STANDAARD_EXCLUDE = ['app/src/main.ts', 'app/src/db/migrate.ts', 'app/src/db/seed.ts'];

function coverageAan(): boolean {
  return Boolean(process.env.FACTORY_COVERAGE);
}

/**
 * Env-toevoeging voor het e2e-serverproces: zet `NODE_V8_COVERAGE` zodat Node de ruwe
 * v8-coverage wegschrijft. Alleen bij een coverage-poort (`FACTORY_COVERAGE`), zodat een
 * gewone e2e-run niets extra's doet. Spreid dit ná `...process.env` in de child-env.
 */
export function e2eCoverageEnv(rootDir: string): Record<string, string> {
  if (!coverageAan()) {
    return {};
  }
  const rawDir = path.join(rootDir, RAW_SUBPAD);
  // Vers beginnen: oude raw-bestanden van een vorige run zouden dubbel tellen.
  rmSync(rawDir, { recursive: true, force: true });
  mkdirSync(rawDir, { recursive: true });
  return { NODE_V8_COVERAGE: rawDir };
}

/**
 * Zet de ruwe v8-coverage van de server om naar `coverage/e2e/` (json-summary + json)
 * met c8, gescoped op `app/src/**` minus de standaard-exclude. Roep dit aan in de
 * e2e-teardown, ná het afsluiten van de server — anders zijn de raw-bestanden er nog
 * niet (Node schrijft ze pas bij het exit van het proces).
 *
 * Geen coverage-poort of geen raw-map: stil niets doen. c8 matcht de include/exclude
 * ten opzichte van `process.cwd()`, dus dit hoort vanuit de applicatiemap te draaien —
 * precies waar de e2e-`global-setup` al staat.
 */
export async function schrijfE2eDekking(rootDir: string): Promise<void> {
  if (!coverageAan()) {
    return;
  }
  const rawDir = path.join(rootDir, RAW_SUBPAD);
  if (!existsSync(rawDir) || readdirSync(rawDir).length === 0) {
    return;
  }
  const report = new Report({
    tempDirectory: rawDir,
    reportsDirectory: path.join(rootDir, E2E_SUBPAD),
    reporter: ['json-summary', 'json'],
    include: ['app/src/**'],
    exclude: STANDAARD_EXCLUDE,
    excludeNodeModules: true,
    all: false,
    resolve: '',
  });
  await report.run();
}
