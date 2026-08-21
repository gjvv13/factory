import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

/**
 * Elke test draait met een eigen, tijdelijke home.
 *
 * Zonder dit schrijft de suite in de echte home van wie hem draait. Dat gebeurde ook:
 * na #264 boekt en logt élk startpad, en op 2026-08-21 stonden er 369 testregels in
 * `~/Library/Logs/nl.factory.orkestreer.log` en `93` in een dagteller met maximum 4 —
 * waarna een nachtrun op diezelfde dag niets meer zou doen (#278).
 *
 * Hier en niet in elke test: 34 tests deden het fout, en de volgende die iemand
 * schrijft zou het weer kunnen. `os.homedir()` gebruikt `$HOME` als die gezet is, dus
 * één regel hier dekt alles wat via `standaardPaden()` loopt. De echte home bewaren we
 * in een variabele, zodat `standaardPaden` kan herkennen dat deze opzet stuk is.
 */
const ECHTE_HOME = os.homedir();
// Op modulehoogte en niet in een `beforeAll`: setup-bestanden draaien vóór de imports
// van een testbestand, en sommige modules rekenen hun paden bij het laden uit
// (`werkplaatsWortel`). Een hook zou dan te laat zijn.
const tijdelijk = mkdtempSync(path.join(os.tmpdir(), 'factory-test-home-'));
process.env['FACTORY_ECHTE_HOME'] = ECHTE_HOME;
process.env['HOME'] = tijdelijk;

afterAll(() => {
  process.env['HOME'] = ECHTE_HOME;
  rmSync(tijdelijk, { recursive: true, force: true });
});
