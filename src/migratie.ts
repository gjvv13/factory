import { uitvoerVan } from './shell.js';

/**
 * Of er tussen `sinds` en HEAD een nieuw migratiebestand is bijgekomen. Migraties
 * zijn append-only (drizzle schrijft een nieuw genummerd bestand onder `migrations/`),
 * dus we kijken alleen naar toegevoegde bestanden (`--diff-filter=A`).
 */
export function heeftNieuweMigratie(repoDir: string, sinds: string): boolean {
  const uit = uitvoerVan(
    'git',
    ['diff', '--name-only', '--diff-filter=A', sinds, 'HEAD', '--', 'migrations'],
    repoDir,
  );
  return uit !== undefined && uit.trim() !== '';
}

/**
 * Print `ja` als deze release t.o.v. de vorige release-tag een nieuwe migratie bevat,
 * anders `nee`. De deploy-workflow leest dit om te bepalen of prod via de
 * goedkeurings-poort moet. Bewust machine-leesbaar: alléén `ja`/`nee` op stdout, geen
 * opmaak, zodat een shell-substitutie het direct kan gebruiken.
 */
export function toonMigratieStatus(repoDir: string = process.cwd()): void {
  const tags = (uitvoerVan('git', ['tag', '--sort=-v:refname'], repoDir) ?? '')
    .split('\n')
    .filter(Boolean);
  // tags[0] is de zojuist gemaakte release, tags[1] de vorige. Zonder vorige tag is
  // dit de eerste release: dan is er geen "nieuwe" migratie om op te wachten.
  const vorige = tags[1];
  const nieuw = vorige !== undefined && heeftNieuweMigratie(repoDir, vorige);
  process.stdout.write(nieuw ? 'ja\n' : 'nee\n');
}
