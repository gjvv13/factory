import { kop, ok, run } from '../shell.js';

/** Het gepubliceerde pakket op de npm-registry. */
const PAKKET = '@gjvv13/factory';

/**
 * `factory self-update` — installeert de nieuwste factory globaal uit de npm-registry
 * (#695/#710, besluit D).
 *
 * Sinds de git→registry-migratie komt de factory als registry-tarball: een globale
 * install is een gewone `npm i -g <pakket>@latest`, zonder git-install, `prepare` of
 * build-poort (#665/#707). Dit dient lokale dev en de mini-tooling die cross-app werkt;
 * de apps zelf dragen de factory als devDependency en draaien `pnpm exec factory`, en de
 * mini ververst zijn globale bin al bij elke release (`release.yml` `globale-bin`).
 */
export function selfUpdate(): void {
  kop(`De nieuwste ${PAKKET} globaal installeren`);
  run('npm', ['install', '-g', `${PAKKET}@latest`]);
  // Tonen wat er nu staat, zodat een mislukte upgrade opvalt (npm faalt anders stil op
  // een oude versie). `@latest` = de nieuwste registry-versie, dus dat is wat er landde.
  const { stdout } = run('npm', ['view', PAKKET, 'version'], { capture: true });
  ok(`factory bijgewerkt naar ${stdout.trim()} (globaal)`);
}
