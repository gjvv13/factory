import { afterEach, describe, expect, it, vi } from 'vitest';
import { meldOps } from '../src/ops-melding.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer } from './helpers.js';

describe('meldOps (#606)', () => {
  let uitvoer: string[];

  afterEach(() => {
    herstelUitvoerder();
    vi.restoreAllMocks();
  });

  function vanStdout(): string[] {
    uitvoer = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((tekst) => {
      uitvoer.push(String(tekst));
      return true;
    });
    return uitvoer;
  }

  it('met url + token → run("curl", …) wordt aangeroepen met de juiste args', () => {
    vanStdout();
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    meldOps('hallo ops-room', 'https://ops.example.com/notify', 'geheim');

    const curl = aanroepen.find((a) => a.commando === 'curl');
    expect(curl).toBeDefined();
    expect(curl?.argumenten).toContain('https://ops.example.com/notify');
    expect(curl?.argumenten.join(' ')).toContain('Bearer geheim');
    const bodyArg = curl?.argumenten[curl.argumenten.indexOf('-d') + 1];
    expect(bodyArg).toContain('hallo ops-room');
  });

  it('zonder url → waarschuwing, geen run-aanroep', () => {
    const uit = vanStdout();
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    meldOps('hallo', undefined);

    expect(aanroepen.some((a) => a.commando === 'curl')).toBe(false);
    expect(uit.join('')).toContain('ops-melding overgeslagen');
    expect(uit.join('')).toContain('DEPLOY_NOTIFY_URL');
  });

  it('met url maar zonder token → geen Authorization-header', () => {
    vanStdout();
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    meldOps('tekst', 'https://ops.example.com/notify');

    const curl = aanroepen.find((a) => a.commando === 'curl');
    expect(curl).toBeDefined();
    expect(curl?.argumenten.join(' ')).not.toContain('Authorization');
    expect(curl?.argumenten).toContain('https://ops.example.com/notify');
  });

  it('met falende curl (exit ≠ 0) → waarschuwing, geen throw', () => {
    const uit = vanStdout();
    const { uitvoerder } = maakUitvoerderOpnemer(({ commando }) =>
      commando === 'curl' ? { code: 1 } : {},
    );
    stelUitvoerderIn(uitvoerder);

    // Gooit niet.
    meldOps('tekst', 'https://ops.example.com/notify', 'token');

    expect(uit.join('')).toContain('ops-melding mislukt');
    expect(uit.join('')).toContain('curl exit 1');
  });
});
