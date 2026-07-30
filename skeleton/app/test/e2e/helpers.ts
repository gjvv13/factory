import { inject } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db/client.js';
import { loadTestData } from '../../src/db/testdata.js';

export const baseUrl = (): string => inject('baseUrl');

/**
 * Leest de testdata opnieuw in de database van de draaiende instantie.
 * Wordt vóór elke test aangeroepen: elke test begint met dezelfde verse set.
 */
export function resetTestData(): void {
  const databaseFile = inject('databaseFile');
  const config = loadConfig({ FACTORY_ENV: 'test', DATABASE_FILE: databaseFile });
  const handle = openDatabase(databaseFile);
  try {
    loadTestData(handle.db, config.fixturesDir, new Date());
  } finally {
    handle.close();
  }
}

export async function sendMessage(from: string, text: string): Promise<string[]> {
  const response = await fetch(`${baseUrl()}/channels/http/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, text }),
  });
  if (!response.ok) {
    throw new Error(`Bericht sturen mislukte met status ${String(response.status)}`);
  }
  const payload = (await response.json()) as { replies: { text: string }[] };
  return payload.replies.map((reply) => reply.text);
}

export async function setFlag(key: string, enabled: boolean): Promise<void> {
  const response = await fetch(`${baseUrl()}/admin/flags/${key}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(`Flag zetten mislukte met status ${String(response.status)}`);
  }
}
