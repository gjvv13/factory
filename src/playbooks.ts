/**
 * Registry van bekende faalklassen in de deploy-pijplijn.
 *
 * Elke faalklasse heeft een id, naam en beschrijving. De remediaties zelf zitten in
 * hun eigen integratiepunten (workflow-stappen, promote, env status); dit bestand
 * documenteert ze als data zodat slice 4 (gediagnosticeerde melding) ze kan opzoeken.
 */

export interface Faalklasse {
  readonly id: string;
  readonly naam: string;
  readonly beschrijving: string;
}

export const BEKENDE_FAALKLASSEN: readonly Faalklasse[] = [
  {
    id: 'node-drift',
    naam: 'Node-toolchain-drift',
    beschrijving:
      'De runner draait een andere node-major dan .nvmrc vraagt. Remediatie: nvm install in de workflow-stap.',
  },
  {
    id: 'lockfile-drift',
    naam: 'Lockfile-drift',
    beschrijving:
      'pnpm install faalt met ERR_PNPM_OUTDATED_LOCKFILE of ERR_PNPM_FROZEN_LOCKFILE. Remediatie: install zonder --frozen-lockfile met een waarschuwing.',
  },
  {
    id: 'env-stale',
    naam: 'Env-bestanden nieuwer dan het proces',
    beschrijving:
      'Een env-bestand is gewijzigd na de laatste pm2-start. Remediatie: waarschuwing in factory env status met advies om factory env reload te draaien.',
  },
] as const;

/**
 * Herkent een lockfile-drift-fout in de uitvoer van `pnpm install --frozen-lockfile`.
 *
 * De twee bekende foutsignaturen:
 * - `ERR_PNPM_OUTDATED_LOCKFILE` — de lockfile past niet bij package.json
 * - `ERR_PNPM_FROZEN_LOCKFILE`   — `--frozen-lockfile` was gezet en de lockfile moet bijgewerkt worden
 */
export function isLockfileDrift(tekst: string): boolean {
  return tekst.includes('ERR_PNPM_OUTDATED_LOCKFILE') || tekst.includes('ERR_PNPM_FROZEN_LOCKFILE');
}
