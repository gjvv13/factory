import process from 'node:process';

/**
 * Bestanden die geen enkele testsoort zinvol dekt en die dus geen signaal geven:
 * de bootstrap (`main.ts`) en de losstaande db-scripts. Ze staan altijd in de
 * `exclude`, zodat ze het per-soort- én het gemergede cijfer niet vertekenen.
 */
const STANDAARD_EXCLUDE = ['app/src/main.ts', 'app/src/db/migrate.ts', 'app/src/db/seed.ts'];

/**
 * Coverage-optie voor Vitest, alleen actief als de omgevingsvariabele
 * `FACTORY_COVERAGE` gezet is. `factory verify` zet die bij een volledige poort en
 * laat 'm weg bij `--snel`/`--pre-commit`, zodat coverage lokaal snel overslaanbaar
 * blijft. Het rapport (json-summary) belandt in `coverage/<naam>/`, zodat elke
 * testsoort zijn eigen samenvatting houdt en de beheer-tool ze per soort kan vinden.
 *
 * De `include` richt de meting per testsoort op zijn eigen laag (unit → domeinlogica,
 * contract → clients, e2e → de hele app), zodat elk percentage betekenisvol is binnen
 * zijn baan. De `exclude` voegt zich bij de vaste {@link STANDAARD_EXCLUDE}.
 *
 * @param {string} naam Naam van de testsoort ('unit', 'contract', 'e2e'); bepaalt de rapportmap.
 * @param {object} [opties]
 * @param {string[]} [opties.include] Welke bron gemeten wordt (default de hele app-bron).
 * @param {string[]} [opties.exclude] Paden bovenop de standaard-uitsluitingen.
 */
export function coverageOptie(naam, { include = ['app/src/**/*.ts'], exclude = [] } = {}) {
  if (!process.env.FACTORY_COVERAGE) {
    return {};
  }
  return {
    coverage: {
      enabled: true,
      provider: 'v8',
      // json-summary voor het per-soort-cijfer, text-summary voor de terminal, en json
      // (coverage-final.json) als istanbul-map die de merge samenvoegt.
      reporter: ['json-summary', 'text-summary', 'json'],
      reportsDirectory: `coverage/${naam}`,
      include,
      exclude: [...STANDAARD_EXCLUDE, ...exclude],
    },
  };
}

export default coverageOptie;
