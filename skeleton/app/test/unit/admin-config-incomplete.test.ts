import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/test-app.js';
import { buildServer } from '../../src/http/server.js';

describe('GET /admin/config — incomplete via de skeleton-config (#106)', () => {
  let harness: TestApp | undefined;

  afterEach(() => {
    harness?.close();
    harness = undefined;
  });

  it('een ontbrekende verwachte sleutel maakt status "incomplete"', async () => {
    // Declareer één verwachte sleutel die niet in de test-omgeving staat. Zo
    // loopt het missing-pad door de échte config-bedrading — loadConfig →
    // config.verwachteSleutels → /admin/config — en niet alleen via een los
    // env-object in de unit-test van configReport. Zonder dit kan een nieuwe app
    // live gaan met een /admin/config dat altijd groen is (#106).
    harness = await createTestApp(undefined, { verwachteSleutels: ['ONTBREKENDE_SLEUTEL_XYZ'] });
    const server = buildServer(harness.app);
    try {
      const response = await server.inject({ method: 'GET', url: '/admin/config' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        status: string;
        expected: number;
        missing: string[];
        empty: string[];
      };
      expect(body.status).toBe('incomplete');
      expect(body.expected).toBe(1);
      expect(body.missing).toContain('ONTBREKENDE_SLEUTEL_XYZ');
      expect(body.empty).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
