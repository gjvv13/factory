/**
 * Unit-tests voor de ochtendmelding (#401): de meldingstekst, het verzendgedrag
 * (0/1/meerdere items, geen URL), en het request-formaat naar het notify-endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bouwMelding, stuurOchtendmelding, type FastlaneResultaat } from '../src/ochtendmelding.js';

describe('bouwMelding', () => {
  it('bouwt een melding op voor één item', () => {
    const items: FastlaneResultaat[] = [
      { issue: 91, app: 'assistant', prUrl: 'https://github.com/gjvv13/assistant/pull/42' },
    ];
    const tekst = bouwMelding(items);

    expect(tekst).toContain('#91');
    expect(tekst).toContain('assistant');
    expect(tekst).toContain('https://github.com/gjvv13/assistant/pull/42');
    expect(tekst).toContain('🚀 Fastlane');
  });

  it('bouwt een melding op voor meerdere items', () => {
    const items: FastlaneResultaat[] = [
      { issue: 91, app: 'assistant', prUrl: 'https://github.com/gjvv13/assistant/pull/42' },
      { issue: 301, app: 'factory', prUrl: 'https://github.com/gjvv13/factory/pull/99' },
    ];
    const tekst = bouwMelding(items);

    expect(tekst).toContain('2 items');
    expect(tekst).toContain('#91');
    expect(tekst).toContain('#301');
    expect(tekst).toContain('assistant');
    expect(tekst).toContain('factory');
  });
});

describe('stuurOchtendmelding', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stuurt geen melding als er geen items zijn', async () => {
    const verzend = vi.fn().mockResolvedValue(true);

    await stuurOchtendmelding([], 'https://example.com/notify', 'token', verzend);

    expect(verzend).not.toHaveBeenCalled();
  });

  it('waarschuwt als de URL niet gezet is', async () => {
    const uitvoer: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    const verzend = vi.fn().mockResolvedValue(true);

    await stuurOchtendmelding(
      [{ issue: 91, app: 'assistant', prUrl: 'https://example.com/pull/1' }],
      undefined,
      undefined,
      verzend,
    );

    expect(verzend).not.toHaveBeenCalled();
    expect(uitvoer.join('')).toContain('DEPLOY_NOTIFY_URL is niet gezet');
  });

  it('stuurt een melding via de verzend-functie als er items zijn', async () => {
    const verzend = vi.fn().mockResolvedValue(true);
    const items: FastlaneResultaat[] = [
      { issue: 91, app: 'assistant', prUrl: 'https://example.com/pull/1' },
    ];

    await stuurOchtendmelding(items, 'https://example.com/notify', 'geheim', verzend);

    expect(verzend).toHaveBeenCalledOnce();
    expect(verzend).toHaveBeenCalledWith(
      'https://example.com/notify',
      expect.stringContaining('#91'),
      'geheim',
    );
  });

  it('waarschuwt als de verzending mislukt', async () => {
    const uitvoer: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    const verzend = vi.fn().mockResolvedValue(false);

    await stuurOchtendmelding(
      [{ issue: 91, app: 'assistant', prUrl: 'https://example.com/pull/1' }],
      'https://example.com/notify',
      'geheim',
      verzend,
    );

    expect(uitvoer.join('')).toContain('kon niet worden verstuurd');
  });
});

describe('contract: request-formaat naar het notify-endpoint', () => {
  it('stuurt JSON met tekst-veld en bearer-token', async () => {
    let ontvangen: { url: string; body: string; token: string | undefined } | undefined;
    const verzend = vi.fn((url: string, body: string, token: string | undefined) => {
      ontvangen = { url, body, token };
      return Promise.resolve(true);
    });

    await stuurOchtendmelding(
      [
        { issue: 91, app: 'assistant', prUrl: 'https://github.com/gjvv13/assistant/pull/42' },
        { issue: 301, app: 'factory', prUrl: 'https://github.com/gjvv13/factory/pull/99' },
      ],
      'https://assistant.example.com/channels/http/inbound',
      'test-token-123',
      verzend,
    );

    expect(ontvangen).toBeDefined();
    expect(ontvangen!.url).toBe('https://assistant.example.com/channels/http/inbound');
    expect(ontvangen!.token).toBe('test-token-123');
    // De body bevat per item issue, app en PR-URL.
    expect(ontvangen!.body).toContain('#91');
    expect(ontvangen!.body).toContain('assistant');
    expect(ontvangen!.body).toContain('https://github.com/gjvv13/assistant/pull/42');
    expect(ontvangen!.body).toContain('#301');
    expect(ontvangen!.body).toContain('factory');
    expect(ontvangen!.body).toContain('https://github.com/gjvv13/factory/pull/99');
  });
});
