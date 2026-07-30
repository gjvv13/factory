import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { contacts } from '../db/schema.js';

export interface Contact {
  readonly id: number;
  readonly channel: string;
  readonly handle: string;
  readonly displayName: string;
}

export interface ContactRepository {
  findByHandle(channel: string, handle: string): Contact | undefined;
}

export function createContactRepository(db: Db): ContactRepository {
  return {
    findByHandle: (channel, handle) =>
      db
        .select()
        .from(contacts)
        .where(and(eq(contacts.channel, channel), eq(contacts.handle, handle)))
        .get(),
  };
}
