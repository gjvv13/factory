import type { JournalEntry, AppliedMigration } from '../db/migraties.js';

export type MigrationStatus = 'ok' | 'pending' | 'ahead';

export interface MigrationReport {
  readonly status: MigrationStatus;
  readonly applied: readonly string[];
  readonly pending: readonly string[];
  readonly ahead: readonly string[];
}

/**
 * Vergelijkt het journaal (wat er op schijf staat) met de toegepaste migraties
 * (wat de database kent). Puur: geen I/O, alleen lijsten vergelijken.
 *
 * - `applied`: tags die zowel in het journaal als in de database staan.
 * - `pending`: tags in het journaal die de database niet heeft toegepast.
 * - `ahead`: migraties in de database die niet (meer) in het journaal staan.
 * - `status`: `ok` als er niets openstaand en niets vooruit is,
 *   `pending` als er openstaande migraties zijn, `ahead` als de database
 *   migraties kent die niet in het journaal staan (iemand heeft een bestand
 *   verwijderd).
 */
export function migrationReport(
  journal: readonly JournalEntry[],
  applied: readonly AppliedMigration[],
): MigrationReport {
  const journalTags = new Set(journal.map((e) => e.tag));
  // Drizzle slaat de tag als hash op in __drizzle_migrations.
  const appliedHashes = new Set(applied.map((a) => a.hash));

  const matchedTags = journal.filter((e) => appliedHashes.has(e.tag)).map((e) => e.tag);
  const pendingTags = journal.filter((e) => !appliedHashes.has(e.tag)).map((e) => e.tag);
  const aheadHashes = applied.filter((a) => !journalTags.has(a.hash)).map((a) => a.hash);

  let status: MigrationStatus = 'ok';
  if (aheadHashes.length > 0) status = 'ahead';
  if (pendingTags.length > 0) status = 'pending';

  return {
    status,
    applied: matchedTags,
    pending: pendingTags,
    ahead: aheadHashes,
  };
}
