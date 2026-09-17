import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Consumer-rooktest tegen een breuk in de **consume-strategie** (#711, epic #695).
 *
 * Sinds de git→registry-migratie halen de apps de factory als **registry-tarball** binnen:
 * die draagt de gebouwde `dist` via het `files`-veld en draait géén `prepare` bij de
 * consument (#714/#707). Breekt dat pad — de `bin` wijst nergens heen, of `dist` valt uit
 * `files` — dan installeert elke app een kapotte factory pas ná de release. Deze test
 * bootst de consument na: `npm pack` (exact wat de registry ontvangt), het pakket uitpakken,
 * en de gebundelde `dist/cli.js` in een echt node-proces draaien. Zo maakt zo'n breuk de
 * factory-poort rood — dus de merge-queue op `main`, dus de release — in plaats van pas een
 * app te slopen. Node-idioom als [node-interop] en [pakket]: het gepakte artefact draaien,
 * niet de bronmap.
 *
 * De runtime-deps komen via een symlink naar de eigen `node_modules` (de bin importeert
 * `zod`/`c8`/`istanbul-*` statisch), zodat de test hermetisch blijft: geen netwerk-install.
 */

const REPO = path.join(import.meta.dirname, '..', '..');

interface PakUitvoer {
  readonly filename: string;
}

describe('de gepakte factory draait als consument uit de tarball', () => {
  let tmp = '';
  let pakketDir = '';
  let verwachteVersie = '';

  beforeAll(() => {
    verwachteVersie = String(
      (JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { version?: unknown })
        .version,
    );
    tmp = mkdtempSync(path.join(os.tmpdir(), 'factory-consumer-'));

    // Echte pack: bouwt dist via `prepare` en levert exact de tarball die npm publiceert.
    const pak = spawnSync('npm', ['pack', '--pack-destination', tmp, '--json'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(pak.status, pak.stderr).toBe(0);
    const tgz = (JSON.parse(pak.stdout) as readonly PakUitvoer[])[0]?.filename;
    expect(tgz, 'npm pack gaf geen bestandsnaam terug').toBeTruthy();

    const uitpakken = spawnSync('tar', ['-xzf', path.join(tmp, String(tgz)), '-C', tmp], {
      encoding: 'utf8',
    });
    expect(uitpakken.status, uitpakken.stderr).toBe(0);

    // npm pakt altijd uit onder `package/`.
    pakketDir = path.join(tmp, 'package');
    // Deps zonder netwerk: de eigen node_modules erin hangen (ESM negeert NODE_PATH).
    symlinkSync(path.join(REPO, 'node_modules'), path.join(pakketDir, 'node_modules'), 'dir');
  });

  afterAll(() => {
    if (tmp !== '') {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  function binPad(): string {
    const pj = JSON.parse(readFileSync(path.join(pakketDir, 'package.json'), 'utf8')) as {
      bin?: { factory?: unknown };
    };
    const bin = pj.bin?.factory;
    expect(typeof bin === 'string' && bin.length > 0, 'package.json mist bin.factory').toBe(true);
    return String(bin);
  }

  it('bundelt de dist waar de bin naar wijst', () => {
    const doel = path.join(pakketDir, binPad());
    expect(existsSync(doel), `het bin-doel ${binPad()} zit niet in het pakket`).toBe(true);
  });

  it('draait `factory --version` uit de tarball en meldt de pakketversie', () => {
    // De cli-bootstrap draait `main()` niet als `VITEST` gezet is (test-conventie); vitest
    // erft die var naar het kindproces, dus strip 'm — een echte consument heeft 'm nooit.
    const env = { ...process.env };
    delete env['VITEST'];
    const run = spawnSync(process.execPath, [path.join(pakketDir, binPad()), '--version'], {
      encoding: 'utf8',
      env,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe(verwachteVersie);
  });
});
