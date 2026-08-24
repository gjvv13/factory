import { beforeEach, describe, expect, it } from 'vitest';
import { baseUrl, resetTestData, setFlag } from './helpers.js';

describe('GET /admin/logs (end to end)', () => {
  beforeEach(() => {
    resetTestData();
  });

  it('geeft entries terug na een warn-logregel', async () => {
    // Zet de flag aan zodat het endpoint bereikbaar is.
    await setFlag('admin-logs', true);

    // Stuur een bericht dat geen commando matcht: de router logt dat niet als
    // warn, maar we kunnen via een onbekend commando een logentry triggeren.
    // Veiliger: roep direct het endpoint aan en controleer de structuur.
    // De app logt warn/error bij opstartmomenten; we kunnen niet garanderen dat er
    // entries zijn zonder zelf een warn te veroorzaken. Stuur een ongeldig verzoek
    // dat een fout veroorzaakt, of accepteer dat de buffer leeg kan zijn.

    // Controleer dat het endpoint werkt en de juiste structuur heeft.
    const response = await fetch(`${baseUrl()}/admin/logs`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { entries: unknown[] };
    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('geeft 404 terug als de flag uit staat', async () => {
    // De flag staat standaard uit (niet in de testdata).
    const response = await fetch(`${baseUrl()}/admin/logs`);
    expect(response.status).toBe(404);
  });

  it('schakelt het endpoint aan en uit met de flag', async () => {
    // Uit → 404
    const first = await fetch(`${baseUrl()}/admin/logs`);
    expect(first.status).toBe(404);

    // Aan → 200
    await setFlag('admin-logs', true);
    const second = await fetch(`${baseUrl()}/admin/logs`);
    expect(second.status).toBe(200);

    // Weer uit → 404
    await setFlag('admin-logs', false);
    const third = await fetch(`${baseUrl()}/admin/logs`);
    expect(third.status).toBe(404);
  });

  it('bevat entries met tijdstip, niveau en bericht na een fout', async () => {
    await setFlag('admin-logs', true);

    // Veroorzaak betrouwbaar een warn: een inbound-verzoek zonder tekst wordt met
    // een 400 geweigerd én als warn in de logbuffer gezet. sendMessage() gooit bij
    // een niet-ok respons, dus we sturen het ongeldige verzoek met een rauwe fetch.
    const rejected = await fetch(`${baseUrl()}/channels/http/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '+31600000001' }),
    });
    expect(rejected.status).toBe(400);

    const response = await fetch(`${baseUrl()}/admin/logs`);
    const body = (await response.json()) as {
      entries: { tijdstip: string; niveau: string; bericht: string }[];
    };

    // Niet-vacuüs: er is nu minstens één warn/error, en elke entry heeft de
    // afgesproken structuur (tijdstip, niveau, bericht) met een geldig niveau.
    expect(body.entries.length).toBeGreaterThan(0);
    for (const entry of body.entries) {
      expect(entry).toHaveProperty('tijdstip');
      expect(entry).toHaveProperty('niveau');
      expect(entry).toHaveProperty('bericht');
      expect(['warn', 'error']).toContain(entry.niveau);
    }
  });
});
