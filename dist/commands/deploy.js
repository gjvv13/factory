import { issuesUitBereik, zetKolom } from '../board.js';
import { GebruikersFout, ok, uitvoerVan } from '../shell.js';
import { promote } from './promote.js';
import { release } from './release.js';
/**
 * Orchestratie voor de uitrol-pijplijn; dit is wat de deploy-workflow op de
 * self-hosted runner aanroept na een merge naar main.
 *
 * `deploy acc` maakt een nieuwe release-tag van de huidige main (verify + bump +
 * tag + push) en rolt die uit naar acc. `deploy prod` rolt de bestaande nieuwste
 * tag uit naar prod zónder een nieuwe release — dezelfde tag die acc al draaide.
 * De conditionele prod-poort (auto, of wachten op goedkeuring bij een migratie)
 * zit in de workflow, niet hier (slice 3).
 */
export async function deploy(omgevingArgument) {
    if (omgevingArgument !== 'acc' && omgevingArgument !== 'prod') {
        throw new GebruikersFout('Gebruik: factory deploy <acc|prod>');
    }
    if (omgevingArgument === 'acc') {
        // De vorige tag nodig om het bereik te bepalen; leest vóór release() er een nieuwe bijzet.
        const vorigeTag = uitvoerVan('git', ['tag', '--sort=-v:refname'])?.split('\n')[0]?.trim() ?? '';
        // Elke merge is een patch-release; de tag reist mee naar acc.
        const tag = release('patch');
        // Items die in het tagbereik zitten zijn nu door de merge heen en mogen naar
        // Uitrollen — de kolom die zegt "onderweg naar acc en prod". Vóór de merge
        // stonden ze op Wacht op merge; die stap maakt de poort zichtbaar (#437).
        if (vorigeTag !== '') {
            for (const issue of issuesUitBereik(vorigeTag, tag)) {
                if (zetKolom(issue, 'Uitrollen')) {
                    ok(`#${String(issue)} staat op Uitrollen`);
                }
            }
        }
        await promote('acc', undefined);
        return;
    }
    // Prod draait niet-interactief op de runner; de menselijke goedkeuring (bij een
    // migratie) zit in het GitHub-environment vóór deze stap, niet in promote zelf.
    await promote('prod', undefined, { ja: true });
}
//# sourceMappingURL=deploy.js.map