import { Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bevestig,
  herstelStarter,
  herstelUitvoerder,
  herstelWacht,
  isDnsBlip,
  isGezondNaStart,
  runMetHerhaling,
  stelStarterIn,
  stelUitvoerderIn,
  stelWachtIn,
  vrijePoort,
  wachtOpGezond,
} from '../src/shell.js';
import type { ProcesHandle } from '../src/shell.js';
import { maakUitvoerderOpnemer } from './helpers.js';

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

describe('isDnsBlip', () => {
  it('herkent de bekende DNS-storing-signaturen', () => {
    expect(
      isDnsBlip('ssh: Could not resolve hostname github.com: nodename nor servname provided'),
    ).toBe(true);
    expect(isDnsBlip('getaddrinfo ENOTFOUND codeload.github.com')).toBe(true);
    expect(isDnsBlip('request failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org')).toBe(
      true,
    );
    expect(isDnsBlip('Temporary failure in name resolution')).toBe(true);
  });

  it('rekent een échte fout (auth, non-fast-forward) niet als blip', () => {
    expect(isDnsBlip('! [rejected] main -> main (fetch first)')).toBe(false);
    expect(isDnsBlip('Permission denied (publickey).')).toBe(false);
    expect(isDnsBlip('CONFLICT (content): Merge conflict in src/app.ts')).toBe(false);
  });
});

describe('runMetHerhaling', () => {
  const DNS_FOUT = {
    code: 1,
    stderr: 'ssh: Could not resolve hostname github.com: nodename nor servname provided',
  };

  afterEach(() => {
    herstelUitvoerder();
    herstelWacht();
    vi.restoreAllMocks();
  });

  /** Vangt de backoff-slaap af zodat de test niet echt wacht, en telt de pogingen. */
  function nepWacht(): { keer: () => number } {
    let keer = 0;
    stelWachtIn(() => {
      keer += 1;
    });
    return { keer: () => keer };
  }

  it('slaagt in één keer als er niets misgaat', () => {
    const { keer } = nepWacht();
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    const resultaat = runMetHerhaling('git', ['push', 'origin', 'main']);

    expect(resultaat.code).toBe(0);
    expect(aanroepen).toHaveLength(1);
    expect(keer()).toBe(0);
  });

  it('herhaalt bij een DNS-blip en slaagt daarna, zonder te throwen', () => {
    const { keer } = nepWacht();
    // Eerste poging een blip, de tweede slaagt.
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer((_aanroep, index) =>
      index === 0 ? DNS_FOUT : {},
    );
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const resultaat = runMetHerhaling('git', ['push', 'origin', 'main']);

    expect(resultaat.code).toBe(0);
    expect(aanroepen).toHaveLength(2);
    expect(keer()).toBe(1); // precies één keer gewacht, tussen de twee pogingen
  });

  it('geeft na aanhoudende blip de echte fout na het maximum aantal pogingen', () => {
    const { keer } = nepWacht();
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(() => DNS_FOUT);
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => runMetHerhaling('git', ['push', 'origin', 'main'])).toThrow(/faalde met code 1/);
    expect(aanroepen).toHaveLength(3); // default: 3 pogingen
    expect(keer()).toBe(2); // gewacht tussen poging 1→2 en 2→3, niet ná de laatste
  });

  it('herhaalt niet bij een niet-DNS-fout maar throwt meteen', () => {
    const { keer } = nepWacht();
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(() => ({
      code: 1,
      stderr: '! [rejected] main -> main (fetch first)',
    }));
    stelUitvoerderIn(uitvoerder);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => runMetHerhaling('git', ['push', 'origin', 'main'])).toThrow(/faalde met code 1/);
    expect(aanroepen).toHaveLength(1); // geen retry
    expect(keer()).toBe(0);
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
