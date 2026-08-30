import { describe, expect, it } from 'vitest';
import { migrationReport } from '../../src/core/migratie-status.js';
import type { AppliedMigration, JournalEntry } from '../../src/db/migraties.js';

describe('migrationReport', () => {
  const journal: readonly JournalEntry[] = [
    { tag: '0000_init', when: 1785410367122 },
    { tag: '0001_add_preferences', when: 1785500000000 },
    { tag: '0002_add_notifications', when: 1785600000000 },
  ];

  it('geeft ok als alle migraties zijn toegepast', () => {
    const applied: readonly AppliedMigration[] = [
      { hash: '0000_init', createdAt: 1785410367122 },
      { hash: '0001_add_preferences', createdAt: 1785500000000 },
      { hash: '0002_add_notifications', createdAt: 1785600000000 },
    ];

    const report = migrationReport(journal, applied);

    expect(report.status).toBe('ok');
    expect(report.applied).toEqual(['0000_init', '0001_add_preferences', '0002_add_notifications']);
    expect(report.pending).toEqual([]);
    expect(report.ahead).toEqual([]);
  });

  it('geeft pending als er migraties in het journaal staan die niet zijn toegepast', () => {
    const applied: readonly AppliedMigration[] = [
      { hash: '0000_init', createdAt: 1785410367122 },
    ];

    const report = migrationReport(journal, applied);

    expect(report.status).toBe('pending');
    expect(report.applied).toEqual(['0000_init']);
    expect(report.pending).toEqual(['0001_add_preferences', '0002_add_notifications']);
    expect(report.ahead).toEqual([]);
  });

  it('geeft ahead als de database migraties kent die niet in het journaal staan', () => {
    const applied: readonly AppliedMigration[] = [
      { hash: '0000_init', createdAt: 1785410367122 },
      { hash: '0001_add_preferences', createdAt: 1785500000000 },
      { hash: '0002_add_notifications', createdAt: 1785600000000 },
      { hash: '0003_verwijderd', createdAt: 1785700000000 },
    ];

    const report = migrationReport(journal, applied);

    expect(report.status).toBe('ahead');
    expect(report.ahead).toEqual(['0003_verwijderd']);
  });

  it('geeft ok bij een leeg journaal en geen toegepaste migraties', () => {
    const report = migrationReport([], []);

    expect(report.status).toBe('ok');
    expect(report.applied).toEqual([]);
    expect(report.pending).toEqual([]);
    expect(report.ahead).toEqual([]);
  });

  it('geeft pending voorrang boven ahead als beide aanwezig zijn', () => {
    const applied: readonly AppliedMigration[] = [
      { hash: '0000_init', createdAt: 1785410367122 },
      { hash: '9999_onbekend', createdAt: 1785900000000 },
    ];

    const report = migrationReport(journal, applied);

    // pending en ahead zijn allebei niet-leeg; pending wint.
    expect(report.status).toBe('pending');
    expect(report.pending).toEqual(['0001_add_preferences', '0002_add_notifications']);
    expect(report.ahead).toEqual(['9999_onbekend']);
  });
});
