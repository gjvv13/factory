import {
  metBoekhouding,
  type OrkestratorPaden,
  type RunPot,
  type RunRegel,
  type WerkerSoort,
} from './orkestrator-instellingen.js';
import { ok, waarschuwing } from './shell.js';

/** Het minimum dat de lus van een item moet weten. */
export interface ReeksItem {
  readonly issue: number;
  readonly app: string;
  readonly titel: string;
}

export interface ReeksOpzet<T extends ReeksItem, U> {
  readonly paden: OrkestratorPaden;
  readonly nu: Date;
  readonly soort: WerkerSoort;
  readonly pot: RunPot;
  /** Hoeveel items deze reeks maximaal afwerkt. */
  readonly aantal: number;
  /**
   * De items die deze reeks moet doen, in deze volgorde. Afwezig betekent: pak de kop
   * van de wachtrij (en dan bepaalt het board de volgorde).
   *
   * Een nummer dat niet in de wachtrij staat wordt overgeslagen met een melding, en de
   * reeks gaat door met het volgende: één typefout mag een reeks van vier niet kosten.
   */
  readonly lijst?: readonly number[];
  /**
   * Waarom een gevraagd item niet in de wachtrij staat, als de aanroeper dat kan zeggen.
   * Zonder dit staat er alleen dát het niet in de rij staat, en dan ga je zelf zoeken.
   */
  readonly reden?: (issue: number) => string | undefined;
  /**
   * Leest de wachtrij. Wordt per ronde opnieuw aangeroepen: de vorige run heeft het
   * board net veranderd, en doorwerken op de oude lijst pakt hetzelfde item nog eens.
   */
  readonly leesRij: () => readonly T[];
  /** Werkt één item af. Gooit alleen als de machine zelf stuk is. */
  readonly werkAf: (item: T) => U;
  /** Wat er van deze uitkomst in het runlog komt. */
  readonly beschrijf: (uitkomst: U) => RunRegel;
  /** Of dit als geslaagd telt. Twee niet-geslaagde runs op rij stoppen de reeks. */
  readonly gelukt: (uitkomst: U) => boolean;
  /**
   * Hoe deze reeks heet in meldingen: `vannacht` of `deze reeks`. De nacht houdt zo
   * zijn eigen woorden — "overgeslagen voor vannacht" is de melding uit #202 en die
   * moet leesbaar blijven in een log dat om 04:00 volloopt.
   */
  readonly noemer: string;
  /** Regel na elke run; de nacht zet hier zijn `2/4 van vannacht gedaan`. */
  readonly naElkeRun?: (gedaan: number) => void;
}

/** Waarom de reeks ophield. */
export type ReeksEinde = 'aantal' | 'rij-leeg' | 'niets-nieuws' | 'twee-mislukt';

export interface ReeksUitkomst {
  readonly gedaan: number;
  readonly geslaagd: number;
  /** Wat de runs samen kostten, voor zover de werkers dat meldden. */
  readonly kosten: number;
  readonly einde: ReeksEinde;
}

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
export function draaiReeks<T extends ReeksItem, U>(opzet: ReeksOpzet<T, U>): ReeksUitkomst {
  const gedaanIssues = new Set<number>();
  const gemeld = new Set<number>();
  let gedaan = 0;
  let geslaagd = 0;
  let kosten = 0;
  let mislukteOpRij = 0;
  let einde: ReeksEinde = 'aantal';

  while (gedaan < opzet.aantal) {
    const rij = opzet.leesRij();
    if (rij.length === 0) {
      einde = 'rij-leeg';
      break;
    }
    for (const item of rij) {
      if (gedaanIssues.has(item.issue) && !gemeld.has(item.issue)) {
        gemeld.add(item.issue);
        waarschuwing(
          `#${String(item.issue)} staat na zijn run nog in de wachtrij — overgeslagen voor ${opzet.noemer}.`,
        );
      }
    }
    const volgende =
      opzet.lijst === undefined
        ? rij.find((item) => !gedaanIssues.has(item.issue))
        : kiesUitLijst(opzet, rij, gedaanIssues);
    if (volgende === undefined) {
      einde = 'niets-nieuws';
      break;
    }
    gedaanIssues.add(volgende.issue);

    const { uitkomst } = metBoekhouding(
      {
        paden: opzet.paden,
        nu: opzet.nu,
        soort: opzet.soort,
        pot: opzet.pot,
        item: volgende,
      },
      () => opzet.werkAf(volgende),
      opzet.beschrijf,
    );
    gedaan += 1;
    kosten += opzet.beschrijf(uitkomst).kosten ?? 0;
    if (opzet.gelukt(uitkomst)) {
      geslaagd += 1;
      mislukteOpRij = 0;
    } else {
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
function kiesUitLijst<T extends ReeksItem>(
  keuze: {
    readonly lijst?: readonly number[];
    readonly reden?: (issue: number) => string | undefined;
  },
  rij: readonly T[],
  gedaanIssues: Set<number>,
): T | undefined {
  for (const nummer of keuze.lijst ?? []) {
    if (gedaanIssues.has(nummer)) continue;
    const item = rij.find((kandidaat) => kandidaat.issue === nummer);
    if (item !== undefined) return item;
    const reden = keuze.reden?.(nummer);
    waarschuwing(
      `#${String(nummer)} staat niet in de wachtrij${reden === undefined ? '' : `: ${reden}`} — overgeslagen.`,
    );
    // In `gedaanIssues` zetten zodat de melding niet elke ronde terugkomt.
    gedaanIssues.add(nummer);
  }
  return undefined;
}

/** De slotregel van een reeks: wat er gedaan is en wat het kostte. */
export function meldReeks(uitkomst: ReeksUitkomst): void {
  const bedrag = uitkomst.kosten === 0 ? 'onbekend' : `$${uitkomst.kosten.toFixed(2)}`;
  ok(
    `reeks klaar: ${String(uitkomst.gedaan)} gedaan, ${String(uitkomst.geslaagd)} geslaagd, ${bedrag}.`,
  );
}
