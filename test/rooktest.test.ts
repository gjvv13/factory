import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { rooktest } from '../src/commands/rooktest.js';

/** Temp-app met een factory.json; `extra` vult bijv. het rooktest-blok aan. */
function maakApp(extra: Record<string, unknown> = {}): string {
  const werkruimte = mkdtempSync(path.join(os.tmpdir(), 'factory-rooktest-'));
  const appDir = path.join(werkruimte, 'proefapp');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    path.join(appDir, 'factory.json'),
    JSON.stringify({
      naam: 'proefapp',
      poorten: { dev: 3001, acc: 3002, prod: 3000 },
      envRoot: path.join(werkruimte, 'envs'),
      ...extra,
    }),
  );
  return appDir;
}

function antwoord(status: number, tekst = ''): Response {
  return { status, text: () => Promise.resolve(tekst) } as unknown as Response;
}

describe('rooktest', () => {
  let oorspronkelijkeCwd: string;
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    oorspronkelijkeCwd = process.cwd();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    // De retry-sleeps (en de abort-time-out) niet echt laten wachten in de test.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
  });

  afterEach(() => {
    process.chdir(oorspronkelijkeCwd);
    vi.restoreAllMocks();
  });

  it('is een no-op zonder rooktest in factory.json', async () => {
    process.chdir(maakApp());

    await expect(rooktest('prod')).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('slaagt als de kern de verwachte status teruggeeft', async () => {
    process.chdir(maakApp({ rooktest: { pad: '/channels/http/inbound' } }));
    fetchSpy.mockResolvedValue(antwoord(200, '{"replies":["ok"]}'));

    await expect(rooktest('prod')).resolves.toBeUndefined();
    // Draait op de prod-poort met het geconfigureerde pad.
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/channels/http/inbound',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('faalt luid met een terugrol-voorstel bij een verkeerde status', async () => {
    process.chdir(maakApp({ rooktest: { pad: '/channels/http/inbound' } }));
    fetchSpy.mockResolvedValue(antwoord(500));

    await expect(rooktest('prod')).rejects.toThrow(/factory terugrol prod/);
  });

  it('faalt als de aanroep zelf niet aankomt', async () => {
    process.chdir(maakApp({ rooktest: { pad: '/channels/http/inbound' } }));
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(rooktest('acc')).rejects.toThrow(/Rooktest acc faalde/);
  });

  it('faalt als het antwoord de verwachte inhoud niet bevat', async () => {
    process.chdir(maakApp({ rooktest: { pad: '/channels/http/inbound', bevat: 'boodschappen' } }));
    fetchSpy.mockResolvedValue(antwoord(200, '{"replies":[]}'));

    await expect(rooktest('prod')).rejects.toThrow(/bevat 'boodschappen' niet/);
  });
});
