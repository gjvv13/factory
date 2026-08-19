import { vereisAppConfig, vereisOmgeving } from '../app-config.js';
import { GebruikersFout, kop, uitvoerVan } from '../shell.js';
import { promote } from './promote.js';
/**
 * Rolt een omgeving terug naar de vorige release-tag: de op één na nieuwste tag in de
 * repo. De bedoelde terugweg als een uitrol wél live ging maar stuk bleek (#121) —
 * seconden werk tegenover het vooruit-fixen dat de rooktest anders vergt. Bewust een
 * eigen, kaal commando: het is een gewone `promote` naar de vorige tag, zodat een mens
 * het direct in een terminal kan draaien zonder omweg.
 */
export async function terugrol(omgevingArgument, opties = {}) {
    const omgeving = vereisOmgeving(omgevingArgument);
    const config = vereisAppConfig();
    const tags = (uitvoerVan('git', ['tag', '--sort=-v:refname'], config.appDir) ?? '')
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);
    const vorige = tags[1];
    if (vorige === undefined) {
        throw new GebruikersFout('Geen vorige tag om naar terug te rollen — er is maar één (of geen) release.');
    }
    kop(`Terugrollen van ${omgeving} naar de vorige tag ${vorige}`);
    await promote(omgeving, vorige, opties.ja === true ? { ja: true } : {});
}
//# sourceMappingURL=terugrol.js.map