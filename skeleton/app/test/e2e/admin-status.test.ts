import { describe, expect, it } from 'vitest';
import { baseUrl } from './helpers.js';

describe('GET /admin/migrations (end to end)', () => {
  it('geeft status, applied, pending en ahead terug', async () => {
    const response = await fetch(`${baseUrl()}/admin/migrations`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      applied: string[];
      pending: string[];
      ahead: string[];
    };

    expect(body.status).toBe('ok');
    // Het skeleton heeft één migratie (0000_init), en die is bij het opstarten
    // toegepast — anders zou de app niet gezond worden.
    expect(body.applied).toContain('0000_init');
    expect(body.pending).toEqual([]);
    expect(body.ahead).toEqual([]);
  });
});

describe('GET /admin/config (end to end)', () => {
  it('geeft status, expected, missing, empty, present en known terug', async () => {
    const response = await fetch(`${baseUrl()}/admin/config`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      expected: number;
      missing: string[];
      empty: string[];
      present: number;
      known: number;
    };

    // Het skeleton heeft VERWACHTE_SLEUTELS = [], dus alles is ok.
    expect(body.status).toBe('ok');
    expect(body.expected).toBe(0);
    expect(body.missing).toEqual([]);
    expect(body.empty).toEqual([]);
    expect(typeof body.present).toBe('number');
    expect(typeof body.known).toBe('number');
  });

  it('bevat nooit een waarde in het antwoord', async () => {
    const response = await fetch(`${baseUrl()}/admin/config`);
    const body = (await response.json()) as Record<string, unknown>;

    // Controleer dat geen enkel veld een omgevingswaarde lekt: missing en empty
    // bevatten alleen sleutelnamen, de rest zijn getallen of de statusstring.
    const json = JSON.stringify(body);
    // Waarden als 'silent', '127.0.0.1', een poortnummer — die mogen niet
    // voorkomen als waarde in het config-antwoord. De velden zijn: status (string),
    // expected/present/known (number), missing/empty (string[]).
    for (const value of Object.values(body)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          expect(typeof item).toBe('string');
        }
      } else {
        expect(['string', 'number'].includes(typeof value)).toBe(true);
      }
    }
    // Geen DATABASE_FILE-waarde in de JSON (niet als sleutelnaam want het is niet
    // in VERWACHTE_SLEUTELS, en zeker niet als waarde).
    expect(json).not.toContain('.sqlite');
  });
});

describe('GET+PUT /admin/log-level (end to end)', () => {
  it('geeft het huidige niveau en de beschikbare niveaus terug', async () => {
    const response = await fetch(`${baseUrl()}/admin/log-level`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { level: string; levels: string[] };

    expect(body).toHaveProperty('level');
    expect(body).toHaveProperty('levels');
    expect(body.levels).toContain('info');
    expect(body.levels).toContain('debug');
    expect(body.levels).toContain('warn');
  });

  it('zet het logniveau om en leest het terug', async () => {
    // Huidig niveau ophalen.
    const before = await fetch(`${baseUrl()}/admin/log-level`);
    const beforeBody = (await before.json()) as { level: string };
    const original = beforeBody.level;

    // Zet naar debug.
    const putResponse = await fetch(`${baseUrl()}/admin/log-level`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'debug' }),
    });
    expect(putResponse.status).toBe(200);
    const putBody = (await putResponse.json()) as { level: string };
    expect(putBody.level).toBe('debug');

    // Lees terug: het niveau is bijgewerkt.
    const after = await fetch(`${baseUrl()}/admin/log-level`);
    const afterBody = (await after.json()) as { level: string };
    expect(afterBody.level).toBe('debug');

    // Herstel het originele niveau zodat andere tests niet beïnvloed worden.
    await fetch(`${baseUrl()}/admin/log-level`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: original }),
    });
  });

  it('weigert een ongeldig niveau met 400', async () => {
    const response = await fetch(`${baseUrl()}/admin/log-level`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'onzin' }),
    });
    expect(response.status).toBe(400);
  });
});
