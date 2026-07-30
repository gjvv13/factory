import { beforeEach, describe, expect, it } from 'vitest';
import { baseUrl, resetTestData, sendMessage, setFlag } from './helpers.js';

describe('gesprek via het HTTP-kanaal (end to end)', () => {
  beforeEach(() => {
    resetTestData();
  });

  it('meldt zich gezond met versie en omgeving', async () => {
    const response = await fetch(`${baseUrl()}/health`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', environment: 'test', channel: 'http' });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('antwoordt op ping met pong', async () => {
    await expect(sendMessage('+31600000001', 'ping')).resolves.toEqual(['pong']);
  });

  it('begroet een bekend contact uit de testdata bij naam', async () => {
    await expect(sendMessage('+31600000001', 'hallo')).resolves.toEqual([
      'Hallo Testgebruiker Een!',
    ]);
  });

  it('kent ping niet meer nadat de flag uit wordt gezet, zonder herstart', async () => {
    await expect(sendMessage('+31600000001', 'ping')).resolves.toEqual(['pong']);

    await setFlag('ping', false);
    const afterOff = await sendMessage('+31600000001', 'ping');
    expect(afterOff[0]).toContain('ken ik niet');

    await setFlag('ping', true);
    await expect(sendMessage('+31600000001', 'ping')).resolves.toEqual(['pong']);
  });

  it('begint elke test met verse testdata', async () => {
    // Deze test zet de flag uit en zet hem niet terug; de volgende test moet
    // hem toch weer aan zien staan doordat de testdata opnieuw wordt ingelezen.
    await setFlag('ping', false);
    const messages = await fetch(`${baseUrl()}/admin/messages?limit=5`);
    expect(messages.status).toBe(200);
  });

  it('heeft door de verse testdata weer een werkende ping', async () => {
    await expect(sendMessage('+31600000001', 'ping')).resolves.toEqual(['pong']);
  });

  it('logt inkomend en uitgaand verkeer', async () => {
    await sendMessage('+31600000002', 'versie');

    const response = await fetch(`${baseUrl()}/admin/messages?limit=10`);
    const body = (await response.json()) as {
      messages: { direction: string; participant: string; text: string }[];
    };

    expect(body.messages.filter((entry) => entry.participant === '+31600000002')).toHaveLength(2);
    expect(body.messages.map((entry) => entry.direction)).toContain('out');
  });

  it('weigert een bericht zonder tekst met een 400', async () => {
    const response = await fetch(`${baseUrl()}/channels/http/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '+31600000001' }),
    });

    expect(response.status).toBe(400);
  });

  it('geeft een duidelijke 404 op een onbekende route', async () => {
    const response = await fetch(`${baseUrl()}/bestaat-niet`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toContain('Onbekende route');
  });

  it('laat de flags via de beheerroute zien', async () => {
    const response = await fetch(`${baseUrl()}/admin/flags`);
    const body = (await response.json()) as { flags: { key: string }[] };

    expect(body.flags.map((flag) => flag.key)).toEqual(['ping', 'whatsapp-channel']);
  });
});
