import path from 'node:path';
import { MatchersV3, PactV3 } from '@pact-foundation/pact';
import { afterAll, describe, expect, it } from 'vitest';
import { createHttpClient, HttpRequestError } from '../../src/clients/http-client.js';

/**
 * Contract tests voor uitgaande verbindingen.
 *
 * Er is nog geen echte externe koppeling, dus dit contract legt het gedrag van
 * onze HTTP-client vast tegen een Pact-mockprovider: welke requests we sturen en
 * hoe we op antwoorden reageren. Zodra er een echte externe dienst bijkomt,
 * wordt `provider` hieronder die dienst en verandert er niets aan de opzet.
 */
const provider = new PactV3({
  consumer: 'factory-backend',
  provider: 'example-external-service',
  dir: path.resolve('pacts'),
  logLevel: 'warn',
});

describe('contract met een externe JSON-dienst', () => {
  afterAll(() => {
    // Pact schrijft het contract naar pacts/ zodra alle interacties zijn geverifieerd.
  });

  it('haalt een resource op en levert getypeerde JSON', async () => {
    provider
      .given('resource 42 bestaat')
      .uponReceiving('een verzoek om resource 42')
      .withRequest({
        method: 'GET',
        path: '/resources/42',
        headers: { accept: 'application/json' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          id: MatchersV3.integer(42),
          name: MatchersV3.string('Voorbeeld'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const client = createHttpClient({ baseUrl: mockServer.url });
      const resource = await client.getJson<{ id: number; name: string }>('/resources/42');

      expect(resource.id).toBe(42);
      expect(resource.name).toBe('Voorbeeld');
    });
  });

  it('maakt van een 404 een HttpRequestError met de status erin', async () => {
    provider
      .given('resource 999 bestaat niet')
      .uponReceiving('een verzoek om een niet-bestaande resource')
      .withRequest({
        method: 'GET',
        path: '/resources/999',
        headers: { accept: 'application/json' },
      })
      .willRespondWith({
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: { error: MatchersV3.string('niet gevonden') },
      });

    await provider.executeTest(async (mockServer) => {
      const client = createHttpClient({ baseUrl: mockServer.url });

      await expect(client.getJson('/resources/999')).rejects.toThrow(HttpRequestError);
    });
  });

  it('stuurt meegegeven standaardheaders mee', async () => {
    provider
      .given('de dienst vereist een api-key')
      .uponReceiving('een verzoek met api-key')
      .withRequest({
        method: 'GET',
        path: '/resources/1',
        headers: { accept: 'application/json', 'x-api-key': 'geheim' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { id: MatchersV3.integer(1), name: MatchersV3.string('Een') },
      });

    await provider.executeTest(async (mockServer) => {
      const client = createHttpClient({
        baseUrl: mockServer.url,
        defaultHeaders: { 'x-api-key': 'geheim' },
      });

      await expect(client.getJson('/resources/1')).resolves.toMatchObject({ id: 1 });
    });
  });
});
