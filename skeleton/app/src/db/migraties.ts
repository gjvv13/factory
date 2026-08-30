import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './client.js';

/** Eén regel uit drizzle's `meta/_journal.json`. */
export interface JournalEntry {
  readonly tag: string;
  readonly when: number;
}

/** Eén rij uit drizzle's `__drizzle_migrations`-tabel. */
export interface AppliedMigration {
  readonly hash: string;
  readonly createdAt: number;
}

const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string(), when: z.number() })),
});

const appliedRowSchema = z.object({
  hash: z.string(),
  created_at: z.number(),
});

/**
 * Leest het migratie-journaal van schijf (de bestanden die drizzle-kit genereert).
 * Geeft een lege lijst als het journaal niet bestaat — dat is een geldige toestand
 * voor een app zonder migraties.
 */
export function readJournal(migrationsDir: string): readonly JournalEntry[] {
  const journalPath = path.join(migrationsDir, 'meta', '_journal.json');
  let raw: string;
  try {
    raw = readFileSync(journalPath, 'utf8');
  } catch {
    return [];
  }
  const parsed = journalSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return [];
  return parsed.data.entries.map((e) => ({ tag: e.tag, when: e.when }));
}

/**
 * Leest de toegepaste migraties uit de database (drizzle's eigen boekhouding).
 * Geeft een lege lijst als de tabel niet bestaat — dat is het geval vóór de
 * eerste migrate-aanroep.
 */
export function readApplied(db: Db): readonly AppliedMigration[] {
  try {
    const rows = db.all(sql`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at`);
    return rows
      .map((row) => appliedRowSchema.safeParse(row))
      .filter((r) => r.success)
      .map((r) => ({ hash: r.data.hash, createdAt: r.data.created_at }));
  } catch {
    // Tabel bestaat niet — geen migraties toegepast.
    return [];
  }
}
