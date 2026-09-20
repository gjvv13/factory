import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Toetst de **verpakking**, niet de bronmap — en dat is de enige plek waar de fout van
 * #91 te zien was.
 *
 * `skeleton/.gitignore` stond netjes in de repo, maar npm's pack-laag laat dat bestand een
 * pakket niet overleven: in een geïnstalleerde factory was het verdwenen (pnpm) of
 * hernoemd naar `.npmignore` (npm). Omdat `factory nieuw` het skeleton uit het *draaiende
 * pakket* leest, kreeg elke nieuwe app dus geen `.gitignore` — terwijl elke test op de
 * bronmap groen stond. Daarom draait deze test het echte `npm pack` en kijkt naar de
 * bestandslijst die eruit komt.
 */

const REPO = path.join(import.meta.dirname, '..', '..');

interface PakketBestand {
  readonly path: string;
}
interface PakketUitvoer {
  readonly files: readonly PakketBestand[];
}

function gepakteBestanden(): string[] {
  const uitkomst = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  expect(uitkomst.status, uitkomst.stderr).toBe(0);
  const gelezen = JSON.parse(uitkomst.stdout) as readonly PakketUitvoer[];
  return (gelezen[0]?.files ?? []).map((bestand) => bestand.path);
}

describe('het gepakte factory-pakket', () => {
  // npm pack is niet gratis: één keer pakken, drie vragen erover stellen.
  const bestanden = gepakteBestanden();

  it('bevat het skeleton-ignore-bestand zonder punt, zodat het het inpakken overleeft', () => {
    expect(bestanden).toContain('skeleton/gitignore');
  });

  it('bevat geen skeleton/.gitignore of skeleton/.npmignore', () => {
    // Beide zijn het spoor van de oude fout: de eerste sneuvelt onderweg, de tweede is
    // wat npm ervan maakt — en een `.npmignore` in een app zou daar stilletjes bestanden
    // uit publicaties houden.
    expect(bestanden).not.toContain('skeleton/.gitignore');
    expect(bestanden).not.toContain('skeleton/.npmignore');
  });

  it('laat de andere skeleton-dotfiles ongemoeid', () => {
    // Het is geen algemeen dotfile-probleem: alleen ignore-bestanden krijgen die
    // behandeling. Deze verwachting valt om als een volgende npm-versie breder ingrijpt.
    expect(bestanden).toContain('skeleton/.prettierignore');
    expect(bestanden).toContain('skeleton/.nvmrc');
  });

  it('draagt de agent-definities mee, zodat de werker vanuit een install niet crasht (#749)', () => {
    // `leesAgentGrenzen` leest `agents/<naam>.md` uit de pakketmap bij élke werker-run.
    // Ontbreken ze in de tarball, dan crasht de orkestrator vanuit de global/app-install
    // op ENOENT (#548-regressie, gevonden in #616). De hele set moet mee.
    for (const agent of ['bouwer', 'reviewer', 'refiner', 'accepteerder']) {
      expect(bestanden, `agents/${agent}.md ontbreekt in de gepakte tarball`).toContain(
        `agents/${agent}.md`,
      );
    }
  });
});
