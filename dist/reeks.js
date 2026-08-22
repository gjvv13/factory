import { metBoekhouding, } from './orkestrator-instellingen.js';
import { GebruikersFout, ok, waarschuwing } from './shell.js';
/**
 * Werkt een reeks items af: de lus achter zowel `--nacht` als `--reeks <n>`.
 *
 * Dit was `draaiNacht`, en daarom kon `--soort bouw` alleen één item tegelijk (#265).
 * Een tweede lus ernaast zou betekenen dat de vangnetten uit elkaar lopen — het
 * dagmaximum, het dubbel-draaien-filter, "een escalatie kost één item en niet de
 * nacht" (#202) en de tijdslimiet per run (#206) zitten hier allemaal in.
 *
 * Twee dingen die een lezer zou willen aanvechten:
 *
 * **Het board wordt per ronde opnieuw gelezen.** Dat is een lezing per item en dus niet
 * gratis. Maar de vorige run heeft het board net veranderd: zijn item staat op een
 * andere kolom of draagt een escalatie-label. Doorwerken op de oude lijst zou hetzelfde
 * item een tweede keer oppakken, en dat is twee keer betalen voor één uitwerking.
 *
 * **Twee mislukte runs op rij stoppen de reeks; één niet.** Eén escalatie is gewoon
 * werk. Twee achter elkaar betekent dat de machine zelf stuk is, en dan is doorgaan
 * geld weggooien. Dit is een noodstop, niet het lus-filter: dat blijft een *filter*,
 * zodat een item dat na zijn run nog in de rij staat wordt overgeslagen in plaats van
 * de hele reeks te kosten.
 */
export async function draaiReeks(opzet) {
    const gedaanIssues = new Set();
    const gemeld = new Set();
    let gedaan = 0;
    let geslaagd = 0;
    let kosten = 0;
    let mislukteOpRij = 0;
    let einde = 'aantal';
    while (gedaan < opzet.aantal) {
        const rij = opzet.leesRij();
        if (rij.length === 0) {
            einde = 'rij-leeg';
            break;
        }
        for (const item of rij) {
            if (gedaanIssues.has(item.issue) && !gemeld.has(item.issue)) {
                gemeld.add(item.issue);
                waarschuwing(`#${String(item.issue)} staat na zijn run nog in de wachtrij — overgeslagen voor ${opzet.noemer}.`);
            }
        }
        const volgende = opzet.lijst === undefined
            ? rij.find((item) => !gedaanIssues.has(item.issue))
            : kiesUitLijst(opzet, rij, gedaanIssues);
        if (volgende === undefined) {
            einde = 'niets-nieuws';
            break;
        }
        gedaanIssues.add(volgende.issue);
        // Een `GebruikersFout` uit één run is "dit item kon niet landen" — bijvoorbeeld een
        // `inleveren` die op main botst (#282). Dat is voor de reeks een mislukte run, geen
        // reden om te stoppen: geboekt, gelogd met de reden (dat doet `metBoekhouding` bij
        // een throw), en door naar het volgende. Een andere fout is "de machine is stuk" en
        // die gooit wél door — elke volgende run loopt er net zo goed op stuk. De noodstop
        // bij twee mislukkingen op rij hieronder is het vangnet voor "alles strandt".
        let geslaagdeRun = false;
        gedaan += 1;
        try {
            const { uitkomst } = await metBoekhouding({
                paden: opzet.paden,
                nu: opzet.nu,
                soort: opzet.soort,
                pot: opzet.pot,
                item: volgende,
            }, () => opzet.werkAf(volgende), opzet.beschrijf);
            kosten += opzet.beschrijf(uitkomst).kosten ?? 0;
            geslaagdeRun = opzet.gelukt(uitkomst);
        }
        catch (fout) {
            if (!(fout instanceof GebruikersFout)) {
                throw fout;
            }
            waarschuwing(`#${String(volgende.issue)} kon niet landen: ${fout.message.split('\n')[0] ?? ''}`);
        }
        if (geslaagdeRun) {
            geslaagd += 1;
            mislukteOpRij = 0;
        }
        else {
            mislukteOpRij += 1;
        }
        opzet.naElkeRun?.(gedaan);
        if (mislukteOpRij >= 2) {
            // Niet stil stoppen: dit is een andere uitkomst dan "de rij is leeg", en het
            // verschil bepaalt of je 's ochtends naar de machine of naar de items kijkt.
            waarschuwing('twee runs op rij mislukt — de reeks stopt hier.');
            einde = 'twee-mislukt';
            break;
        }
    }
    return { gedaan, geslaagd, kosten, einde };
}
/**
 * Het volgende item uit een gevraagde lijst, in de opgegeven volgorde.
 *
 * Nummers die niet in de wachtrij staan worden één keer gemeld en dan overgeslagen: een
 * typefout in één nummer mag een reeks van vier niet afbreken, en stil overslaan zou
 * betekenen dat je denkt dat het gebouwd is.
 */
function kiesUitLijst(keuze, rij, gedaanIssues) {
    for (const nummer of keuze.lijst ?? []) {
        if (gedaanIssues.has(nummer))
            continue;
        const item = rij.find((kandidaat) => kandidaat.issue === nummer);
        if (item !== undefined)
            return item;
        const reden = keuze.reden?.(nummer);
        waarschuwing(`#${String(nummer)} staat niet in de wachtrij${reden === undefined ? '' : `: ${reden}`} — overgeslagen.`);
        // In `gedaanIssues` zetten zodat de melding niet elke ronde terugkomt.
        gedaanIssues.add(nummer);
    }
    return undefined;
}
/** De slotregel van een reeks: wat er gedaan is en wat het kostte. */
export function meldReeks(uitkomst) {
    const bedrag = uitkomst.kosten === 0 ? 'onbekend' : `$${uitkomst.kosten.toFixed(2)}`;
    ok(`reeks klaar: ${String(uitkomst.gedaan)} gedaan, ${String(uitkomst.geslaagd)} geslaagd, ${bedrag}.`);
}
//# sourceMappingURL=reeks.js.map