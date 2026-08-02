import process from 'node:process';

/**
 * Coverage-optie voor Vitest, alleen actief als de omgevingsvariabele
 * `FACTORY_COVERAGE` gezet is. `factory verify` zet die bij een volledige poort en
 * laat 'm weg bij `--snel`/`--pre-commit`, zodat coverage lokaal snel overslaanbaar
 * blijft. Het rapport (json-summary) belandt in `coverage/<naam>/`, zodat elke
 * testsoort zijn eigen samenvatting houdt en de beheer-tool ze per soort kan vinden.
 *
 * @param {string} naam Naam van de testsoort ('unit', 'contract', 'e2e'); bepaalt de rapportmap.
 * @param {object} [opties]
 * @param {string[]} [opties.include] Welke bron gemeten wordt (default de app-bron).
 */
export function coverageOptie(naam, { include = ['app/src/**/*.ts'] } = {}) {
  if (!process.env.FACTORY_COVERAGE) {
    return {};
  }
  return {
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['json-summary', 'text-summary'],
      reportsDirectory: `coverage/${naam}`,
      include,
    },
  };
}

export default coverageOptie;
