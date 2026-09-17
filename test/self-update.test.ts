import { afterEach, describe, expect, it } from 'vitest';
import { selfUpdate } from '../src/commands/self-update.js';
import { herstelUitvoerder, stelUitvoerderIn } from '../src/shell.js';
import { maakUitvoerderOpnemer } from './helpers.js';

/**
 * `factory self-update` (#695/#710, besluit D): haalt de nieuwste factory globaal uit
 * de npm-registry. Sinds de git→registry-migratie is dat een gewone `npm i -g
 * <pakket>@latest` — geen git-install, geen build-poort.
 */
describe('factory self-update', () => {
  afterEach(() => {
    herstelUitvoerder();
  });

  it('installeert de nieuwste factory globaal uit de registry', () => {
    const opnemer = maakUitvoerderOpnemer((aanroep) =>
      aanroep.argumenten[0] === 'view' ? { stdout: '9.9.9\n' } : {},
    );
    stelUitvoerderIn(opnemer.uitvoerder);

    selfUpdate();

    expect(opnemer.aanroepen).toContainEqual(
      expect.objectContaining({
        commando: 'npm',
        argumenten: ['install', '-g', '@gjvv13/factory@latest'],
      }),
    );
  });

  it('leest de geïnstalleerde versie terug uit de registry', () => {
    const opnemer = maakUitvoerderOpnemer((aanroep) =>
      aanroep.argumenten[0] === 'view' ? { stdout: '9.9.9\n' } : {},
    );
    stelUitvoerderIn(opnemer.uitvoerder);

    selfUpdate();

    expect(opnemer.aanroepen).toContainEqual(
      expect.objectContaining({
        commando: 'npm',
        argumenten: ['view', '@gjvv13/factory', 'version'],
      }),
    );
  });
});
