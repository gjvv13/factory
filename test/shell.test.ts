import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { bevestig } from '../src/shell.js';

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
