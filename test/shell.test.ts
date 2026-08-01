import { Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bevestig,
  herstelStarter,
  isGezondNaStart,
  stelStarterIn,
  vrijePoort,
  wachtOpGezond,
} from '../src/shell.js';
import type { ProcesHandle } from '../src/shell.js';

/** Een schrijfstroom die alles weggooit, zodat de vraag nergens heen hoeft. */
function leegKanaal(): Writable {
  return new Writable({
    write(_chunk, _codering, klaar) {
      klaar();
    },
  });
}

async function vraag(antwoord: string): Promise<boolean> {
  return bevestig('Doorgaan?', { input: Readable.from([antwoord]), output: leegKanaal() });
}

describe('bevestig', () => {
  it('geeft true bij "ja"', async () => {
    expect(await vraag('ja\n')).toBe(true);
  });

  it('geeft true bij een enkele "j"', async () => {
    expect(await vraag('j\n')).toBe(true);
  });

  it('is hoofdletterongevoelig', async () => {
    expect(await vraag('JA\n')).toBe(true);
  });

  it('geeft false bij "nee"', async () => {
    expect(await vraag('nee\n')).toBe(false);
  });

  it('geeft false bij een leeg antwoord (enter)', async () => {
    expect(await vraag('\n')).toBe(false);
  });
});

describe('vrijePoort', () => {
  it('geeft een bruikbare poort op de loopback terug', async () => {
    const poort = await vrijePoort();
    expect(poort).toBeGreaterThan(0);
    expect(poort).toBeLessThan(65536);
  });
});

describe('isGezondNaStart', () => {
  afterEach(() => {
    herstelStarter();
  });

  /** Zet een nep-starter neer die niet echt spawnt en onthoudt of hij is gestopt. */
  function nepStarter(): { gestopt: () => boolean } {
    let gestopt = false;
    const handle: ProcesHandle = {
      kill: () => {
        gestopt = true;
      },
    };
    stelStarterIn(() => handle);
    return { gestopt: () => gestopt };
  }

  const opstart = { commando: 'node', argumenten: ['dist/main.js'], cwd: '/tmp', env: {} };

  it('geeft true zodra de health-URL gezond antwoordt en stopt het proces', async () => {
    const { gestopt } = nepStarter();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as unknown as Response);

    const gezond = await isGezondNaStart(opstart, 'http://127.0.0.1:1/health', 5);

    expect(gezond).toBe(true);
    expect(gestopt()).toBe(true);
  });

  it('geeft false als het niet gezond wordt binnen de tijd, en stopt het proces', async () => {
    const { gestopt } = nepStarter();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection refused'));

    const gezond = await isGezondNaStart(opstart, 'http://127.0.0.1:1/health', 1);

    expect(gezond).toBe(false);
    expect(gestopt()).toBe(true);
  });
});

describe('wachtOpGezond', () => {
  it('geeft de responstekst terug zodra de URL gezond antwoordt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('gezond'),
    } as unknown as Response);

    expect(await wachtOpGezond('http://127.0.0.1:1/health', 5)).toBe('gezond');
  });

  it('geeft undefined als het niet gezond wordt binnen de tijd', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection refused'));

    expect(await wachtOpGezond('http://127.0.0.1:1/health', 1)).toBeUndefined();
  });
});
