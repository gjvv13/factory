import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Db } from './client.js';
import { contacts, featureFlags, messageLog } from './schema.js';

const contactsFixtureSchema = z.array(
  z.object({
    channel: z.string().min(1),
    handle: z.string().min(1),
    displayName: z.string().min(1),
  }),
);

const flagsFixtureSchema = z.array(
  z.object({
    key: z.string().min(1),
    enabled: z.boolean(),
    description: z.string().default(''),
  }),
);

function readFixture<T>(fixturesDir: string, file: string, schema: z.ZodType<T>): T {
  const raw = readFileSync(path.join(fixturesDir, file), 'utf8');
  return schema.parse(JSON.parse(raw));
}

/**
 * Zet de database terug naar de exacte inhoud van de fixtures.
 * Wordt vóór elke testrun aangeroepen, zodat testdata altijd vers is en
 * tests niet van elkaars resultaten afhangen.
 */
export function loadTestData(db: Db, fixturesDir: string, now: Date): void {
  const contactRows = readFixture(fixturesDir, 'contacts.json', contactsFixtureSchema);
  const flagRows = readFixture(fixturesDir, 'feature-flags.json', flagsFixtureSchema);
  const timestamp = now.toISOString();

  db.transaction((tx) => {
    tx.delete(messageLog).run();
    tx.delete(contacts).run();
    tx.delete(featureFlags).run();

    if (contactRows.length > 0) {
      tx.insert(contacts).values(contactRows).run();
    }
    if (flagRows.length > 0) {
      tx.insert(featureFlags)
        .values(
          flagRows.map((row) => ({
            key: row.key,
            enabled: row.enabled,
            description: row.description,
            updatedAt: timestamp,
          })),
        )
        .run();
    }
  });
}
