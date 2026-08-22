import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bevestig,
  herstelStarter,
  herstelUitvoerder,
  herstelWacht,
  isDnsBlip,
  isGezondNaStart,
  run,
  pakketbeheerder,
  runMetHerhaling,
  schrijfWorkflowUitvoer,
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

describe('schrijfWorkflowUitvoer', () => {
  const oud = process.env.GITHUB_OUTPUT;

  afterEach(() => {
    if (oud === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = oud;
    }
  });

  it('hangt de regel achter het uitvoerbestand van de workflow', () => {
    const bestand = path.join(mkdtempSync(path.join(os.tmpdir(), 'factory-uitvoer-')), 'uitvoer');
    writeFileSync(bestand, 'eerder=1\n');
    process.env.GITHUB_OUTPUT = bestand;

    schrijfWorkflowUitvoer('bord_overgeslagen', '#1, #2');

    // Aanhangen, niet overschrijven: een stap schrijft er vaak meer dan één.
    expect(readFileSync(bestand, 'utf8')).toBe('eerder=1\nbord_overgeslagen=#1, #2\n');
  });

  it('doet niets buiten een workflow', () => {
    delete process.env.GITHUB_OUTPUT;

    // Lokaal is er geen uitvoerbestand; dat mag geen fout zijn, want dezelfde commando's
    // draaien met de hand.
    expect(() => {
      schrijfWorkflowUitvoer('bord_overgeslagen', '#1');
    }).not.toThrow();
  });
});

describe('een afgekapte aanroep', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  it('gooit niet, maar geeft afgekapt terug met de uitvoer tot dat moment', () => {
    // Een time-out is geen kapotte machine: het commando liep, het was niet klaar. Zou
    // `run` hier gooien, dan beëindigt één hangende werker de hele nacht (#206).
    stelUitvoerderIn(() => ({
      code: 124,
      stdout: 'tot hier kwam hij',
      stderr: '',
      afgekapt: true as const,
    }));

    const uitkomst = run('claude', ['-p', 'iets'], { timeoutMs: 1000 });

    expect(uitkomst.afgekapt).toBe(true);
    expect(uitkomst.stdout).toBe('tot hier kwam hij');
  });

  it('geeft de grens door aan de uitvoerder', () => {
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer();
    stelUitvoerderIn(uitvoerder);

    run('claude', ['-p', 'iets'], { timeoutMs: 5_000, toleranter: true });

    expect(aanroepen[0]?.timeoutMs).toBe(5_000);
  });

  it('laat een gewone mislukking gewoon gooien', () => {
    // Zonder afgekapt blijft het oude gedrag staan: een niet-nul code is een fout.
    stelUitvoerderIn(() => ({ code: 1, stdout: '', stderr: 'stuk' }));

    expect(() => run('git', ['push'])).toThrow(/faalde met code 1/);
  });
});

describe('pakketbeheerder', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  it('bepaalt pnpm via de opneembare uitvoerder, zonder een echt subproces (#293)', () => {
    // De kern van #293: geen kale `spawnSync` meer. Een test die dit raakt (release,
    // inleveren, promote) mag geen echt `pnpm --version` starten, anders wordt hij flaky
    // onder machinebelasting.
    const { uitvoerder, aanroepen } = maakUitvoerderOpnemer(() => ({ code: 0 }));
    stelUitvoerderIn(uitvoerder);

    const resultaat = pakketbeheerder();

    expect(aanroepen).toContainEqual(
      expect.objectContaining({ commando: 'pnpm', argumenten: ['--version'] }),
    );
    expect(resultaat).toEqual({ commando: 'pnpm', basisArgumenten: [] });
  });

  it('valt terug op corepack als pnpm niet los te draaien is', () => {
    stelUitvoerderIn(() => ({ code: 1, stdout: '', startfout: 'spawn pnpm ENOENT' }));

    expect(pakketbeheerder()).toEqual({ commando: 'corepack', basisArgumenten: ['pnpm'] });
  });
});
