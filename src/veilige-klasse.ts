/**
 * De positieve, gesloten lijst van Bash-patronen die veilig zijn om automatisch toe
 * te voegen aan de bouw-allowlist (#543).
 *
 * Alleen verba die **geen enkel gevaarlijk neveneffect** hebben, ook niet met vijandige
 * argumenten. Uitbreiding is een bewuste codewijziging met review, niet een instelling
 * die ongemerkt kan veranderen — dat is de poort uit functioneel besluit 2.
 *
 * **Bewust niet in de lijst:** `rm` (kan buiten de worktree wissen — het patroon kan
 * geen padbeperking uitdrukken), `git -C` (kan gecombineerd worden met `push`),
 * `chmod`/`chown` (rechtenwijziging), `curl`/`wget` (netwerk), alles met `gh`/`git push`.
 *
 * **Ook bewust níét (verwijderd na #751):** verba die met vijandige argumenten alsnog
 * willekeurige commando's draaien of buiten de worktree schrijven — die zouden via de
 * auto-groei (#543) een sluiproute openen naar precies de klassen die "nooit" mogen
 * groeien (netwerk/`git push`/`gh`):
 * - `env` (`env git push`, `env curl …`, `env gh …`), `awk` (`awk 'BEGIN{system(...)}'`),
 *   `sed` (GNU `s///e` voert uit), `find` (`-exec <cmd>`), `xargs` (`xargs sh -c …`) —
 *   allemaal willekeurige exec;
 * - `tee` — schrijft naar een willekeurig bestand buiten de worktree.
 */
export const VEILIGE_KLASSE: readonly string[] = [
  'Bash(diff:*)',
  'Bash(sort:*)',
  'Bash(uniq:*)',
  'Bash(cut:*)',
  'Bash(tr:*)',
  'Bash(stat:*)',
  'Bash(file:*)',
  'Bash(basename:*)',
  'Bash(dirname:*)',
  'Bash(realpath:*)',
  'Bash(readlink:*)',
  'Bash(pwd:*)',
  'Bash(date:*)',
  'Bash(jq:*)',
  'Bash(printenv:*)',
  'Bash(test:*)',
  'Bash([:*)',
  'Bash(true:*)',
  'Bash(false:*)',
];

/**
 * Vertaalt een weigeringslabel (zoals `weigeringLabel()` in `werker.ts` ze levert)
 * naar het allowlist-patroon: `diff` → `Bash(diff:*)`.
 *
 * Labels die al een `Bash(`-prefix hebben (of geen Bash-verba zijn) komen ongewijzigd
 * terug — de aanroeper filtert die via `isVeilig`.
 */
export function labelNaarPatroon(label: string): string {
  // Een label als "git push" wordt "Bash(git push:*)"; een kaal woord als "diff"
  // wordt "Bash(diff:*)". Niet-Bash-labels (bijv. "Write") worden ook omgezet,
  // maar die zijn nooit veilig en vallen bij `isVeilig` af.
  return `Bash(${label}:*)`;
}

/** De set van verba waarvoor een patroon in `VEILIGE_KLASSE` staat. */
const veiligeVerba = new Set(
  VEILIGE_KLASSE.map((patroon) => {
    const match = /^Bash\(([^:]+):/.exec(patroon);
    return match?.[1];
  }).filter((v): v is string => v !== undefined),
);

/**
 * Geeft `true` als het weigeringslabel overeenkomt met een patroon in de veilige klasse.
 *
 * Een veilig label is een enkel werkwoord (bijv. `diff`, `jq`) waarvan het
 * corresponderende `Bash(<verb>:*)`-patroon in de lijst staat. Samengestelde labels
 * (`git push`, `gh issue edit`) zijn per definitie niet veilig: geen enkel `git`- of
 * `gh`-subcommando staat in de klasse.
 */
export function isVeilig(label: string): boolean {
  return veiligeVerba.has(label);
}
