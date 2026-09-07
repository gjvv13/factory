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
 */
export const VEILIGE_KLASSE = [
    'Bash(diff:*)',
    'Bash(sort:*)',
    'Bash(uniq:*)',
    'Bash(cut:*)',
    'Bash(tr:*)',
    'Bash(tee:*)',
    'Bash(awk:*)',
    'Bash(sed:*)',
    'Bash(find:*)',
    'Bash(stat:*)',
    'Bash(file:*)',
    'Bash(basename:*)',
    'Bash(dirname:*)',
    'Bash(realpath:*)',
    'Bash(readlink:*)',
    'Bash(pwd:*)',
    'Bash(date:*)',
    'Bash(jq:*)',
    'Bash(env:*)',
    'Bash(printenv:*)',
    'Bash(test:*)',
    'Bash([:*)',
    'Bash(true:*)',
    'Bash(false:*)',
    'Bash(xargs:*)',
];
/**
 * Vertaalt een weigeringslabel (zoals `weigeringLabel()` in `werker.ts` ze levert)
 * naar het allowlist-patroon: `diff` → `Bash(diff:*)`.
 *
 * Labels die al een `Bash(`-prefix hebben (of geen Bash-verba zijn) komen ongewijzigd
 * terug — de aanroeper filtert die via `isVeilig`.
 */
export function labelNaarPatroon(label) {
    // Een label als "git push" wordt "Bash(git push:*)"; een kaal woord als "diff"
    // wordt "Bash(diff:*)". Niet-Bash-labels (bijv. "Write") worden ook omgezet,
    // maar die zijn nooit veilig en vallen bij `isVeilig` af.
    return `Bash(${label}:*)`;
}
/** De set van verba waarvoor een patroon in `VEILIGE_KLASSE` staat. */
const veiligeVerba = new Set(VEILIGE_KLASSE.map((patroon) => {
    const match = /^Bash\(([^:]+):/.exec(patroon);
    return match?.[1];
}).filter((v) => v !== undefined));
/**
 * Geeft `true` als het weigeringslabel overeenkomt met een patroon in de veilige klasse.
 *
 * Een veilig label is een enkel werkwoord (bijv. `diff`, `jq`) waarvan het
 * corresponderende `Bash(<verb>:*)`-patroon in de lijst staat. Samengestelde labels
 * (`git push`, `gh issue edit`) zijn per definitie niet veilig: geen enkel `git`- of
 * `gh`-subcommando staat in de klasse.
 */
export function isVeilig(label) {
    return veiligeVerba.has(label);
}
//# sourceMappingURL=veilige-klasse.js.map