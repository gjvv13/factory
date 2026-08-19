import { isBacklogRepo, zetItemsUitBereikOpDone } from '../board.js';
import { GebruikersFout, kop } from '../shell.js';
/**
 * Zet de factory-eigen backlog-items uit een tagbereik op **Done** (#185).
 *
 * De vijf apps bereiken Done via `promote prod`, maar de factory draait geen `promote` —
 * ze is gereedschap, geen draaiende app. Haar "productie" is de git-tag die de apps
 * oppikken. De auto-release (`release.yml`, #132) roept dit commando daarom aan zodra de
 * nieuwe tag staat, met de vorige en de nieuwe tag als bereik.
 *
 * Draait alleen in de backlog-repo zelf: elders zou de lokale git-historie tot verkeerde
 * board-mutaties leiden. Een bordfout houdt de release nooit tegen — de board-poort faalt
 * zacht (zie `board.ts`).
 */
export function afronden(vorigeTag, tag) {
    if (vorigeTag === undefined || tag === undefined) {
        throw new GebruikersFout('Gebruik: factory afronden <vorigeTag> <tag>');
    }
    if (!isBacklogRepo()) {
        throw new GebruikersFout('`factory afronden` werkt alleen in de backlog-repo (gjvv13/factory); ' +
            'een app bereikt Done via `factory promote prod`.');
    }
    kop(`Factory-items uit ${vorigeTag}..${tag} afronden`);
    zetItemsUitBereikOpDone(vorigeTag, tag, `Factory-release \`${tag}\` draait.`, `Alle slices draaien in factory-release \`${tag}\`.`);
}
//# sourceMappingURL=afronden.js.map