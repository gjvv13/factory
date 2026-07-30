import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Feature flags: per omgeving in de eigen database, aan/uit zonder deploy. */
export const featureFlags = sqliteTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  description: text('description').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
});

/** Bekende gesprekspartners per kanaal; wordt in tests uit fixtures geladen. */
export const contacts = sqliteTable(
  'contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    channel: text('channel').notNull(),
    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
  },
  (table) => [uniqueIndex('contacts_channel_handle_idx').on(table.channel, table.handle)],
);

/** Volledig verkeerslogboek, in en uit, voor observability en debugging. */
export const messageLog = sqliteTable('message_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channel: text('channel').notNull(),
  direction: text('direction', { enum: ['in', 'out'] }).notNull(),
  participant: text('participant').notNull(),
  text: text('text').notNull(),
  createdAt: text('created_at').notNull(),
});
