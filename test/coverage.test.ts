import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coverageOptie } from '../configs/coverage.js';
import { contractTestConfig } from '../configs/vitest-contract.js';
import { e2eTestConfig } from '../configs/vitest-e2e.js';
import { unitTestConfig } from '../configs/vitest-unit.js';

/** De vorm die we uit de brede Vitest-coverage-union nodig hebben in de test. */
interface CoverageVorm {
  reportsDirectory?: string;
  include?: string[];
  exclude?: string[];
}

const STANDAARD_EXCLUDE = ['app/src/main.ts', 'app/src/db/migrate.ts', 'app/src/db/seed.ts'];

/** Haalt de coverage-optie uit een preset-config, langs het brede uniontype heen. */
function coverageVan(config: { test?: { coverage?: unknown } }): CoverageVorm | undefined {
  return config.test?.coverage as CoverageVorm | undefined;
}

/** Zet FACTORY_COVERAGE terug op de oorspronkelijke waarde na elke test. */
function herstelCoverageEnv(): void {
  const origineel = process.env.FACTORY_COVERAGE;
  afterEach(() => {
    if (origineel === undefined) {
      delete process.env.FACTORY_COVERAGE;
    } else {
      process.env.FACTORY_COVERAGE = origineel;
    }
  });
}

describe('coverageOptie', () => {
  herstelCoverageEnv();

  it('geeft een leeg object zonder FACTORY_COVERAGE, zodat coverage lokaal overslaanbaar blijft', () => {
    delete process.env.FACTORY_COVERAGE;

    expect(coverageOptie('unit')).toEqual({});
  });

  it('meet naar coverage/<naam> en zet de standaard-exclude er altijd in', () => {
    process.env.FACTORY_COVERAGE = '1';

    const optie = coverageOptie('contract') as { coverage: CoverageVorm };

    expect(optie.coverage.reportsDirectory).toBe('coverage/contract');
    expect(optie.coverage.exclude).toEqual(STANDAARD_EXCLUDE);
  });

  it('respecteert een meegegeven include en zet extra exclude achter de standaard', () => {
    process.env.FACTORY_COVERAGE = '1';

    const optie = coverageOptie('unit', {
      include: ['app/src/core/**/*.ts'],
      exclude: ['app/src/core/logger.ts'],
    }) as { coverage: CoverageVorm };

    expect(optie.coverage.include).toEqual(['app/src/core/**/*.ts']);
    expect(optie.coverage.exclude).toEqual([...STANDAARD_EXCLUDE, 'app/src/core/logger.ts']);
  });
});

describe('de vitest-presets richten de meting op hun eigen laag', () => {
  herstelCoverageEnv();

  beforeEach(() => {
    process.env.FACTORY_COVERAGE = '1';
  });

  it('unit meet de domeinlogica: core, feature flags en de config', () => {
    expect(coverageVan(unitTestConfig())?.include).toEqual([
      'app/src/core/**/*.ts',
      'app/src/flags/**/*.ts',
      'app/src/config.ts',
    ]);
  });

  it('contract meet de clients', () => {
    expect(coverageVan(contractTestConfig())?.include).toEqual(['app/src/clients/**/*.ts']);
  });

  it('e2e meet de hele app-bron', () => {
    expect(coverageVan(e2eTestConfig())?.include).toEqual(['app/src/**/*.ts']);
  });

  it('elke preset erft de standaard-exclude', () => {
    for (const config of [unitTestConfig(), contractTestConfig(), e2eTestConfig()]) {
      expect(coverageVan(config)?.exclude).toEqual(STANDAARD_EXCLUDE);
    }
  });
});
