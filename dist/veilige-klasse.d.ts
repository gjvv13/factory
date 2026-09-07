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
export declare const VEILIGE_KLASSE: readonly string[];
/**
 * Vertaalt een weigeringslabel (zoals `weigeringLabel()` in `werker.ts` ze levert)
 * naar het allowlist-patroon: `diff` → `Bash(diff:*)`.
 *
 * Labels die al een `Bash(`-prefix hebben (of geen Bash-verba zijn) komen ongewijzigd
 * terug — de aanroeper filtert die via `isVeilig`.
 */
export declare function labelNaarPatroon(label: string): string;
/**
 * Geeft `true` als het weigeringslabel overeenkomt met een patroon in de veilige klasse.
 *
 * Een veilig label is een enkel werkwoord (bijv. `diff`, `jq`) waarvan het
 * corresponderende `Bash(<verb>:*)`-patroon in de lijst staat. Samengestelde labels
 * (`git push`, `gh issue edit`) zijn per definitie niet veilig: geen enkel `git`- of
 * `gh`-subcommando staat in de klasse.
 */
export declare function isVeilig(label: string): boolean;
