import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  bordItems,
  ESCALATIE_LABEL,
  haalLabelWeg,
  kolomVan,
  plaatsComment,
  zetKolom,
  zetLabel,
  zorgVoorEscalatieLabel,
  type BacklogItem,
  type Kolom,
} from '../board.js';
import {
  leesInstellingen,
  metBoekhouding,
  type RunRegel,
  standaardPaden,
  type OrkestratorPaden,
} from '../orkestrator-instellingen.js';
import { templatesDir } from '../paths.js';
import { draaiReeks, meldReeks } from '../reeks.js';
import { GebruikersFout, kop, ok, run, uitvoerVan, waarschuwing } from '../shell.js';
import { draaiBouwer, draaiReviewer, type BouwUitkomst, type ReviewUitkomst } from '../werker.js';
import {
  escalatieComment,
  vervolgPrompt,
  type AntwoordOpties,
  type Escalatie,
} from './orkestreer.js';
import {
  bronMappenVan,
  bronMomentopname,
  buitenDocumenten,
  ruimBronMapOp,
  versWerkplaats,
  werkplaatsWortel,
} from '../werkplaats.js';
import { inleveren, type InleverenOpties } from './inleveren.js';
import { werkplek } from './werkplek.js';

/**
 * De tweede taaksoort: een werker die bouwt in plaats van refinet (#164, slice #182).
 *
 * Deze slice levert alleen `--dry`: de wachtrij van bouwbare items en het bouwplan voor
 * de kop ervan. Er wordt niets geschreven — geen bordmutatie, geen worktree, geen PR,
 * geen `claude`-run. De rem in deze fase is dat niets dit aanroept behalve ik.
 */

/** Waar de bouw-werker uit put. */
const BOUW_KOLOM: Kolom = 'Klaar voor Bouwen';
/** De kolom die "iemand werkt hieraan" betekent; een item dáár is geclaimd. */
const GECLAIMD_KOLOM: Kolom = 'Bouwen';
/** Alleen kleine klussen. Een epic is geen bouwopdracht, en een slice hoort bij zijn epic. */
const BOUWBARE_SOORTEN = ['type:bug', 'type:task'] as const;
const EIGENAAR = 'gjvv13';
/** Eén model voor alle onbemande werkers — zie het modelkeuze-besluit in #104. */
const MODEL = 'claude-opus-4-6';

/** Een item dat een bouw-werker aankan: het `App`-veld moet gezet zijn. */
export interface Bouwitem extends BacklogItem {
  readonly app: string;
}

/**
 * Waar de bouw-werker zijn worktree neerzet.
 *
 * Niet `factory werkplek`'s pad (`../<repo>-wt/<issue>`, naast de werkkopie), want dat
 * ligt in `~/Documents` en daar komt een onbemande werker niet — TCC houdt hem buiten en
 * er lopen parallelle sessies in. Vandaar dezelfde wortel als de spiegels, met `-wt`
 * erachter zodat een worktree nooit met een spiegel te verwarren is.
 */
export function bouwWerkplek(
  app: string,
  issue: number,
  wortel: string = werkplaatsWortel,
): string {
  return path.join(wortel, `${app}-wt`, String(issue));
}

/** De branch die de werker zou maken; `-1` zoals #128 hem herkent. */
export function bouwBranch(issue: number): string {
  return `slice/${String(issue)}-1`;
}

/**
 * De bouw-wachtrij uit één board-lezing: open items op **Klaar voor Bouwen** die klein
 * genoeg zijn, niet geclaimd en niet geëscaleerd.
 *
 * Een slice onder een epic hoort hier wél in. Tot #232 viel die eruit, met het argument
 * dat een slice in de volgorde van zijn epic gebouwd hoort te worden. Dat spreekt #131
 * tegen: de kolom is de bron van waarheid, en een item staat alleen op Klaar voor Bouwen
 * omdat iemand het daar heeft neergezet. Gemeten op 2026-08-21 hield dat filter #184
 * tegen nadat het juist voor de bouw was vrijgegeven — het overruled de beslissing die
 * het board vastlegt. Een epic zélf valt nog steeds af: `type:epic` staat niet in
 * BOUWBARE_SOORTEN.
 *
 * Alles komt uit dezelfde lezing — labels en de ouder-relatie zitten sinds #182 in de
 * board-query. Een filter dat per item een tweede aanroep doet zou het GraphQL-budget
 * opeten dat #104 juist bewaakt.
 */
export function bouwWachtrij(items: readonly BacklogItem[]): Bouwitem[] {
  const bruikbaar: Bouwitem[] = [];
  for (const item of items) {
    const reden = redenBuitenDeRij(item);
    if (reden !== undefined) {
      if (reden.grond === 'geen-app') {
        // Niet stil overslaan, net als in #153: zonder App weet de werker niet welke
        // code hij moet lezen, en een item dat nooit aan de beurt komt zonder dat
        // iemand het merkt is erger dan een item dat overgeslagen wordt met een melding.
        waarschuwing(`#${String(item.issue)} heeft geen App-veld — overgeslagen.`);
      }
      continue;
    }
    // `redenBuitenDeRij` heeft de App al getoetst; deze regel maakt dat voor de types waar.
    bruikbaar.push({ ...item, app: item.app ?? '' });
  }
  return bruikbaar;
}

/** Waarom een item niet in de bouw-wachtrij staat. */
export interface BuitenDeRij {
  readonly grond: 'kolom' | 'soort' | 'escalatie' | 'geen-app';
  /** Eén zin, bedoeld om achter "#123 staat niet in de bouw-wachtrij: " te zetten. */
  readonly zin: string;
}

/**
 * De uitsluitingsgrond van één item, of `undefined` als het in de rij hoort.
 *
 * Eén functie voor het filter én voor de melding van `--issue`, en niet twee keer
 * dezelfde kennis. De vorige vorm was een reeks kale `continue`-regels: die kon geen
 * reden noemen, en toen het filter in #232 veranderde bleef de documentatie erover
 * achter zonder dat iets rood werd. Wie hier een grond toevoegt, levert de uitleg mee.
 */
export function redenBuitenDeRij(item: BacklogItem): BuitenDeRij | undefined {
  if (item.kolom !== BOUW_KOLOM) {
    return {
      grond: 'kolom',
      zin: `het staat op ${item.kolom}, niet op ${BOUW_KOLOM}`,
    };
  }
  if (!BOUWBARE_SOORTEN.some((soort) => item.labels.includes(soort))) {
    return {
      grond: 'soort',
      zin: `het draagt geen van de labels ${BOUWBARE_SOORTEN.join(' of ')}`,
    };
  }
  if (item.labels.includes(ESCALATIE_LABEL)) {
    return {
      grond: 'escalatie',
      zin: `het draagt het label ${ESCALATIE_LABEL} — haal dat er eerst af`,
    };
  }
  if (item.app === undefined || item.app === '') {
    return { grond: 'geen-app', zin: 'het heeft geen App-veld, dus geen code om te lezen' };
  }
  return undefined;
}

/**
 * Het item waar deze run over gaat: de kop van de rij, of het gevraagde issue.
 *
 * Een gevraagd issue dat niet in de rij staat is een fout mét de reden. `--issue`
 * filtert de rij die de filters al gemaakt hebben; hij bouwt geen tweede rij, dus hij
 * kan een item dat niet mag ook niet laten bouwen.
 */
export function kiesItem(
  wachtrij: readonly Bouwitem[],
  alles: readonly BacklogItem[],
  issue: number | undefined,
  cwd: string,
): Bouwitem | undefined {
  if (issue === undefined) {
    return wachtrij[0];
  }
  const gevraagd = wachtrij.find((item) => item.issue === issue);
  if (gevraagd !== undefined) {
    return gevraagd;
  }
  const inLezing = alles.find((item) => item.issue === issue);
  if (inLezing !== undefined) {
    const reden = redenBuitenDeRij(inLezing);
    throw new GebruikersFout(
      `#${String(issue)} staat niet in de bouw-wachtrij: ${reden?.zin ?? 'onbekende reden'}.`,
    );
  }
  // Niet in de lezing: `bordItems` laat gesloten items en items zonder Status-waarde
  // weg. Eén gerichte opzoeking maakt het verschil zichtbaar in plaats van te gokken.
  const kolom = kolomVan(issue, cwd);
  throw new GebruikersFout(
    kolom === undefined
      ? `#${String(issue)} staat niet in de bouw-wachtrij: hij heeft geen kolom op het ` +
          `board, of hij is gesloten.`
      : `#${String(issue)} staat niet in de bouw-wachtrij: het staat op ${kolom}, ` +
          `niet op ${BOUW_KOLOM}.`,
  );
}

/** Het prefix waarmee een bron-label begint; de rest is de app-naam. */
const BRON_PREFIX = 'bron:';

/**
 * Leest de `bron:<app>`-labels van een item, ontdubbeld (#238).
 *
 * Een label naar de eigen app van het item is een waarschuwing en verder een no-op:
 * die code staat al in de worktree. Levert een lege lijst als er geen bron-labels zijn.
 */
export function bronAppsVan(item: Bouwitem): string[] {
  const gezien = new Set<string>();
  const apps: string[] = [];
  for (const label of item.labels) {
    if (!label.startsWith(BRON_PREFIX)) {
      continue;
    }
    const app = label.slice(BRON_PREFIX.length).trim();
    if (app === '') {
      continue;
    }
    if (app === item.app) {
      waarschuwing(
        `#${String(item.issue)} draagt ${label}, maar ${app} is zijn eigen app — overgeslagen.`,
      );
      continue;
    }
    if (!gezien.has(app)) {
      gezien.add(app);
      apps.push(app);
    }
  }
  return apps;
}

export interface BouwOpties {
  readonly dry?: boolean;
  /** Bouwt één item en stopt. */
  readonly eenmalig?: boolean;
  /** Bouwt een reeks af: een aantal van de kop, of precies deze items (#265). */
  readonly reeks?: ReeksKeuze;
  /**
   * Richt de run op dit issue in plaats van op de kop van de rij (#210). Staat het niet
   * in de wachtrij, dan faalt de run met de reden — de filters blijven gelden.
   */
  readonly issue?: number;
  /** Injecteerbaar voor tests; in productie de echte wortel in `$HOME`. */
  readonly werkplaatsWortel?: string;
  readonly paden?: OrkestratorPaden;
  /**
   * Hoe er ingeleverd wordt. Geen CLI-vlag: `inleveren` draait de volledige poort, en
   * een test hoort prettier, eslint en vitest niet vanuit zichzélf te starten.
   */
  readonly leverIn?: (opties: InleverenOpties) => void;
}

/**
 * Draait de bouw-taaksoort. In deze slice bestaat alleen `--dry`: alles wat er te zien
 * valt vóórdat er iets gebeurt.
 */
export async function orkestreerBouw(opties: BouwOpties = {}): Promise<void> {
  if (opties.dry === true && opties.eenmalig === true) {
    throw new GebruikersFout('--dry en --eenmalig sluiten elkaar uit; kies er één.');
  }
  if (opties.dry !== true && opties.eenmalig !== true && opties.reeks === undefined) {
    // Geen stille default naar bouwen: een commando dat zonder vlag een werker met
    // schrijfrechten start is precies de verrassing die deze epic wil vermijden.
    throw new GebruikersFout(
      'Gebruik: factory orkestreer --soort bouw --dry (tonen), --eenmalig (één item bouwen) of --reeks <n> (een reeks).',
    );
  }
  if (opties.reeks !== undefined && (opties.dry === true || opties.eenmalig === true)) {
    throw new GebruikersFout('--dry, --eenmalig en --reeks sluiten elkaar uit; kies er één.');
  }
  const cwd = process.cwd();
  const items = bordItems(cwd);
  if (items === undefined) {
    throw new GebruikersFout(
      'Kon het board niet lezen; zonder wachtrij is er niets te doen.\n' +
        '  Controleer je gh-auth (`gh auth status`) en de GraphQL-limiet\n' +
        '  (`gh api rate_limit --jq .resources.graphql`).',
    );
  }
  const wortel = opties.werkplaatsWortel ?? werkplaatsWortel;
  const paden = opties.paden ?? standaardPaden();
  const instellingen = leesInstellingen(paden);
  const wachtrij = bouwWachtrij(items);
  const geclaimd = items.filter((item) => item.kolom === GECLAIMD_KOLOM).length;

  kop(`Bouw-wachtrij: ${BOUW_KOLOM}`);
  if (wachtrij.length === 0 && opties.issue === undefined) {
    ok('niets te bouwen');
    return;
  }
  for (const item of wachtrij) {
    const nummer = `#${String(item.issue)}`.padEnd(6);
    // Het epic erbij, als het item er een heeft: sinds #232 mag een slice gewoon
    // gebouwd worden, en dan wil je vóór het geld kost zien dat hij ergens bij hoort.
    const onder = item.ouder === undefined ? '' : ` (onder #${String(item.ouder)})`;
    process.stdout.write(`  ${nummer} ${item.app.padEnd(12)} ${item.titel}${onder}\n`);
  }
  if (geclaimd > 0) {
    // Zichtbaar maken wat er buiten de rij valt: een geclaimd item is niet vergeten
    // maar in behandeling, en dat wil je kunnen zien zonder het board te openen.
    ok(`${String(geclaimd)} item(s) staan op ${GECLAIMD_KOLOM} en zijn dus geclaimd.`);
  }

  const eerste = kiesItem(wachtrij, items, opties.issue, cwd);
  if (eerste === undefined) {
    return;
  }
  const werkplekPad = bouwWerkplek(eerste.app, eerste.issue, wortel);
  if (!buitenDocumenten(werkplekPad)) {
    // Onbereikbaar zolang de wortel in $HOME ligt, maar dit is de aanname waar de hele
    // opzet op rust; als iemand het pad verlegt moet dat luid falen.
    throw new GebruikersFout(`Werkplek ${werkplekPad} ligt binnen ~/Documents; dat mag niet.`);
  }

  if (opties.dry === true) {
    const bronApps = bronAppsVan(eerste);
    const bronWortel = bronMappenVan(werkplekPad);
    const bronRegels = bronApps
      .map((app) => `  bron:     ${app} → ${path.join(bronWortel, app)}`)
      .join('\n');
    process.stdout.write(
      `\nZou nu bouwen: #${String(eerste.issue)} (${eerste.app}) — ${eerste.titel}\n` +
        `  werkplek: ${werkplekPad}\n` +
        `  branch:   ${bouwBranch(eerste.issue)}\n` +
        `  budget:   $${String(instellingen.bouwBudgetPerRun)} bouw + $${String(instellingen.reviewBudgetPerRun)} review\n` +
        (bronRegels === '' ? '' : `${bronRegels}\n`) +
        `Er is niets geschreven — niet naar GitHub, niet naar de werkplaats en niet naar een worktree.\n`,
    );
    return;
  }

  if (opties.reeks !== undefined) {
    const keuze = opties.reeks;
    const lijst = keuze.soort === 'lijst' ? keuze.issues : undefined;
    if (lijst !== undefined) {
      // Een nummer dat niet bestaat is een fout vóór de eerste `claude`-aanroep: anders
      // betaal je drie runs en hoor je pas daarna dat de vierde een typefout was.
      const bekend = new Set(items.map((item) => item.issue));
      const onbekend = lijst.filter((nummer) => !bekend.has(nummer));
      if (onbekend.length > 0) {
        throw new GebruikersFout(
          `Niet op het board: ${onbekend.map((n) => `#${String(n)}`).join(', ')}.`,
        );
      }
    }
    kop(
      keuze.soort === 'aantal'
        ? `Reeks van ${String(keuze.aantal)}`
        : `Reeks: ${keuze.issues.map((n) => `#${String(n)}`).join(', ')}`,
    );
    meldReeks(
      await draaiReeks({
        paden,
        nu: new Date(Date.now()),
        soort: 'bouw',
        pot: 'interactief',
        noemer: 'deze reeks',
        aantal: keuze.soort === 'aantal' ? keuze.aantal : keuze.issues.length,
        ...(lijst === undefined ? {} : { lijst }),
        reden: (issue) => {
          const item = items.find((kandidaat) => kandidaat.issue === issue);
          return item === undefined ? undefined : redenBuitenDeRij(item)?.zin;
        },
        // Per ronde opnieuw lezen: de vorige run heeft een kolom verzet of een
        // escalatie-label gehangen, en op de oude lijst zou hij dat item nog eens pakken.
        leesRij: () => bouwWachtrij(bordItems(cwd) ?? []),
        werkAf: (item) =>
          bouwAf(
            item,
            cwd,
            wortel,
            instellingen.bouwBudgetPerRun,
            instellingen.reviewBudgetPerRun,
            instellingen.werkerEffort,
            opties.leverIn ?? inleveren,
          ),
        beschrijf: beschrijfBouw,
        gelukt: (u) => u.afloop === 'klaar',
      }),
    );
    return;
  }

  // Een bouw-run stond tot #264 nergens: `logRun` werd alleen uit de nacht-lus
  // aangeroepen, en die is refine-only. Juist de duurste soort was dus onzichtbaar.
  await metBoekhouding(
    {
      paden,
      nu: new Date(Date.now()),
      soort: 'bouw',
      // Er is nog geen onbemande bouw-nacht; wie dit start is een mens (#265).
      pot: 'interactief',
      item: eerste,
    },
    () =>
      bouwAf(
        eerste,
        cwd,
        wortel,
        instellingen.bouwBudgetPerRun,
        instellingen.reviewBudgetPerRun,
        instellingen.werkerEffort,
        opties.leverIn ?? inleveren,
      ),
    beschrijfBouw,
  );
}

/**
 * Wat er van een bouw-run in het log komt.
 *
 * Zelfde vorm als bij een refine-run, inclusief de eigen tekst voor een afkapping
 * (#206): "afgekapt (30 min)" is 's ochtends leesbaar, "mislukt" niet.
 */
function beschrijfBouw(uitkomst: BouwUitkomst): RunRegel {
  return {
    uitkomst:
      uitkomst.afgekaptNaMinuten === undefined
        ? uitkomst.afloop
        : `afgekapt (${String(uitkomst.afgekaptNaMinuten)} min)`,
    ...(uitkomst.kosten === undefined ? {} : { kosten: uitkomst.kosten }),
    ...(uitkomst.beurten === undefined ? {} : { beurten: uitkomst.beurten }),
  };
}

/** De prompt voor de bouw-werker: het sjabloon met de feiten die hij niet mag opzoeken. */
export function bouwPrompt(
  item: Bouwitem,
  werkmap: string,
  factoryMap: string,
  bronMappen: readonly string[] = [],
): string {
  const sjabloon = readFileSync(path.join(templatesDir, 'werker-bouw.md'), 'utf8');
  const bronBlok =
    bronMappen.length === 0
      ? ''
      : bronMappen.map((pad) => `- \`${pad}\` — **alleen lezen, wegwerpkopie**`).join('\n');
  const vervang: Record<string, string> = {
    '{{ISSUE}}': String(item.issue),
    '{{TITEL}}': item.titel,
    '{{APP}}': item.app,
    '{{BRANCH}}': bouwBranch(item.issue),
    '{{WERKMAP}}': werkmap,
    '{{FACTORY_MAP}}': factoryMap,
    '{{BRON_MAPPEN}}': bronBlok,
  };
  return Object.entries(vervang).reduce(
    (tekst, [sleutel, waarde]) => tekst.split(sleutel).join(waarde),
    sjabloon,
  );
}

/** De prompt voor de review-werker: het sjabloon met dezelfde feiten als de bouwer. */
export function reviewPrompt(item: Bouwitem, werkmap: string, factoryMap: string): string {
  const sjabloon = readFileSync(path.join(templatesDir, 'werker-review.md'), 'utf8');
  const vervang: Record<string, string> = {
    '{{ISSUE}}': String(item.issue),
    '{{TITEL}}': item.titel,
    '{{APP}}': item.app,
    '{{WERKMAP}}': werkmap,
    '{{FACTORY_MAP}}': factoryMap,
  };
  return Object.entries(vervang).reduce(
    (tekst, [sleutel, waarde]) => tekst.split(sleutel).join(waarde),
    sjabloon,
  );
}

/**
 * Bouwt één item af: claimen, worktree maken, werker draaien, inleveren of escaleren.
 *
 * De claim gaat vóór alles wat geld kost: een tweede werker of een `/bouw`-sessie in de
 * chat kent dit slot niet, en twee werkers op één item leveren twee branches op waarvan
 * er één weg moet.
 */
async function bouwAf(
  item: Bouwitem,
  cwd: string,
  wortel: string,
  budgetUsd: number,
  reviewBudgetUsd: number,
  effort: string,
  leverIn: (opties: InleverenOpties) => void,
): Promise<BouwUitkomst> {
  kop(`#${String(item.issue)} — ${item.titel}`);
  zorgVoorEscalatieLabel(cwd);
  zetKolom(item.issue, GECLAIMD_KOLOM, cwd);

  // Valt de run om, dan hoort het item terug in de rij: geclaimd blijven staan zonder
  // dat er iemand aan werkt is precies hoe een item onvindbaar wordt (de les van #153).
  const terug = (): void => {
    zetKolom(item.issue, BOUW_KOLOM, cwd);
  };

  const bronApps = bronAppsVan(item);
  const werkmap = bouwWerkplek(item.app, item.issue, wortel);
  const bronWortel = bronMappenVan(werkmap);

  let uitkomst: BouwUitkomst;
  // `factoryMap` buiten de try: de review-stap na de try heeft hem nodig.
  // Geen initialisatie: de catch gooit door, dus na de try is hij altijd gezet.
  let factoryMap!: string;
  try {
    const spiegel = versWerkplaats(item.app, EIGENAAR, wortel);
    factoryMap = versWerkplaats('factory', EIGENAAR, wortel);

    // Bron-momentopnames vóór de claude-run: faalt de clone, dan is het een harde fout
    // en kost hij niets. De map is naast de worktree, niet erin: verify in de worktree
    // ziet hem niet, en het ergste wat de werker kan doen is zijn eigen wegwerpkopie
    // verbouwen (#238).
    const bronMappen: string[] = [];
    for (const bronApp of bronApps) {
      bronMappen.push(bronMomentopname(bronApp, bronWortel, EIGENAAR, wortel));
    }

    // Via `factory werkplek` en niet met een eigen `git worktree add`: dan geldt hier
    // dezelfde padconventie en dezelfde branchnaam als voor een menselijke sessie, en
    // `inleveren` ruimt de werkplek achteraf op de manier die hij al kent.
    werkplek(String(item.issue), { cwd: spiegel });

    uitkomst = await draaiBouwer({
      prompt: bouwPrompt(item, werkmap, factoryMap, bronMappen),
      werkmap,
      sessie: randomUUID(),
      extraMappen: [factoryMap, ...bronMappen],
      budgetUsd,
      model: MODEL,
      effort,
    });
  } catch (fout) {
    ruimBronMapOp(bronWortel);
    terug();
    throw fout;
  }
  // Na de run is de bron-map weg, ook als de run escaleerde of faalde — de uitkomst
  // hoort er niet van af te hangen, en een achtergebleven map is rommel die bij de
  // volgende run in de weg kan zitten.
  ruimBronMapOp(bronWortel);

  // Review: alleen als de bouw slaagde, in de worktree die er dan nog staat (#184).
  // Na het inleveren is de worktree weg — de review móét ervoor draaien.
  // Een throw uit de review (startfout, onverwachte uitzondering) mag het inleveren
  // nooit blokkeren — de review is een extra poort, geen voorwaarde (#289).
  let reviewUitkomst: ReviewUitkomst | undefined;
  if (uitkomst.afloop === 'klaar') {
    try {
      reviewUitkomst = await draaiReviewer({
        prompt: reviewPrompt(item, werkmap, factoryMap),
        werkmap,
        sessie: randomUUID(),
        extraMappen: [factoryMap],
        budgetUsd: reviewBudgetUsd,
        model: MODEL,
        effort,
      });
    } catch (fout) {
      const reden = fout instanceof Error ? fout.message : String(fout);
      waarschuwing(`review kon niet draaien: ${reden}`);
      reviewUitkomst = { afloop: 'mislukt', sessie: '', weigeringen: 0, fout: reden };
    }
  }

  verwerkBouw(item, uitkomst, reviewUitkomst, cwd, wortel, leverIn);
  return uitkomst;
}

/** Vertaalt de uitkomst van de bouw-werker naar wat er op GitHub gebeurt. */
function verwerkBouw(
  item: Bouwitem,
  uitkomst: BouwUitkomst,
  reviewUitkomst: ReviewUitkomst | undefined,
  cwd: string,
  wortel: string,
  leverIn: (opties: InleverenOpties) => void,
): void {
  const voetnoot = maakVoetnoot(item, uitkomst, reviewUitkomst, wortel);

  if (uitkomst.afloop === 'mislukt') {
    // Een `is_error: true` bij exit 0 landt hier: geen PR, geen afvink-comment. Terug in
    // de rij met een label, zodat dezelfde fout niet vannacht opnieuw draait.
    blokkeer(item, cwd);
    plaatsComment(
      item.issue,
      `**Bouw-run mislukt.** ${uitkomst.fout ?? 'onbekende fout'}\n\n${voetnoot}`,
      cwd,
    );
    waarschuwing(`#${String(item.issue)} mislukt: ${uitkomst.fout ?? 'onbekende fout'}`);
    return;
  }

  const verdict = uitkomst.verdict;
  const werkmap = bouwWerkplek(item.app, item.issue, wortel);
  if (verdict?.uitkomst === 'escalatie') {
    blokkeer(item, cwd);
    plaatsComment(
      item.issue,
      escalatieComment(
        item.issue,
        verdict.vraag,
        verdict.advies,
        uitkomst,
        werkmap,
        'bouw',
        item.app,
      ),
      cwd,
    );
    ok(`#${String(item.issue)} geëscaleerd — niets ingeleverd.`);
    return;
  }

  if (verdict?.uitkomst !== 'klaar') {
    blokkeer(item, cwd);
    waarschuwing(`#${String(item.issue)} gaf geen bruikbare uitkomst.`);
    return;
  }

  // Inleveren doet de rest: poort draaien, pushen, PR openen, het item naar Uitrollen
  // schuiven (#128) en de werkplek opruimen. Zonder auto-merge, want deze werker mag
  // code voorstellen en niet landen.
  plaatsComment(
    item.issue,
    `**Gebouwd door een onbemande werker.**\n\n${verdict.samenvatting}\n\n` +
      `| Acceptatiecriterium | Bewijs |\n| --- | --- |\n` +
      verdict.criteria.map((regel) => `| ${regel.criterium} | ${regel.bewijs} |`).join('\n') +
      `\n\nDe PR staat open **zonder auto-merge**; mergen is jouw beslissing.\n\n${voetnoot}`,
    cwd,
  );

  // Inleveren. Mislukt dat, dan gaan de bevindingen naar het issue (#184).
  const reviewComment = maakReviewComment(reviewUitkomst);
  try {
    // Mét titel: zonder `--titel` raadt `gh --fill` er een uit de branchnaam, en dan heet
    // de PR "slice/87 1" — zoals bij de eerste bouw-run gebeurde.
    leverIn({
      cwd: werkmap,
      geenAutomerge: true,
      titel: `#${String(item.issue)} — ${item.titel}`,
    });
  } catch (fout) {
    // Inleveren mislukt: de review-bevindingen gaan naar het issue, want een PR bestaat
    // niet. Gooi daarna alsnog door — de bouw-run hoort rood te worden.
    if (reviewComment !== undefined) {
      plaatsComment(item.issue, reviewComment, cwd);
    }
    throw fout;
  }

  // Na een geslaagd inleveren: bevindingen als PR-comment via `gh api` (#184).
  if (reviewComment !== undefined) {
    if (!plaatsPrComment(item, reviewComment)) {
      // Kon de PR niet vinden of de comment niet plaatsen; val terug op het issue.
      waarschuwing(`Kon review-comment niet op de PR plaatsen; het staat op het issue.`);
      plaatsComment(item.issue, reviewComment, cwd);
    }
  }

  ok(`#${String(item.issue)} gebouwd en ingeleverd zonder auto-merge.`);
}

/** Zet een item stil: terug in de bouw-wachtrij, met het label dat het overslaat. */
function blokkeer(item: Bouwitem, cwd: string): void {
  zetKolom(item.issue, BOUW_KOLOM, cwd);
  zetLabel(item.issue, ESCALATIE_LABEL, cwd);
}

/**
 * De voetnoot onder een bouw-comment: kosten en beurten van zowel de bouw als de review
 * (#184), zodat de totaalkosten in één oogopslag te zien zijn.
 */
function maakVoetnoot(
  item: Bouwitem,
  uitkomst: BouwUitkomst,
  reviewUitkomst: ReviewUitkomst | undefined,
  wortel: string,
): string {
  const delen: (string | undefined)[] = [
    uitkomst.kosten === undefined ? undefined : `$${uitkomst.kosten.toFixed(2)}`,
    uitkomst.beurten === undefined ? undefined : `${String(uitkomst.beurten)} beurten`,
    uitkomst.weigeringen > 0
      ? `${String(uitkomst.weigeringen)}× geweigerd${uitkomst.geweigerd === undefined ? '' : ` (${uitkomst.geweigerd.join(', ')})`}`
      : undefined,
  ];
  if (reviewUitkomst !== undefined) {
    if (reviewUitkomst.kosten !== undefined) {
      delen.push(`review $${reviewUitkomst.kosten.toFixed(2)}`);
    }
    if (reviewUitkomst.beurten !== undefined) {
      delen.push(`${String(reviewUitkomst.beurten)} review-beurten`);
    }
  }
  const sessies =
    reviewUitkomst === undefined
      ? `sessie=${uitkomst.sessie}`
      : `sessie=${uitkomst.sessie} review-sessie=${reviewUitkomst.sessie}`;
  return (
    `<sub>${delen.filter((deel) => deel !== undefined).join(' · ')}</sub>\n` +
    `<!-- orkestrator: ${sessies} werkmap=${bouwWerkplek(item.app, item.issue, wortel)} -->`
  );
}

/**
 * Het review-comment als markdown, of `undefined` als er geen review gedraaid heeft.
 *
 * Drie vormen: bevindingen (een tabel), nul bevindingen (een expliciete melding), of
 * een gefaalde run (de reden). Stilte is geen uitkomst — ook nul bevindingen staat er.
 */
function maakReviewComment(reviewUitkomst: ReviewUitkomst | undefined): string | undefined {
  if (reviewUitkomst === undefined) {
    return undefined;
  }
  if (reviewUitkomst.afloop === 'mislukt') {
    return `**Code-review niet gelukt.** ${reviewUitkomst.fout ?? 'onbekende fout'}`;
  }
  const verdict = reviewUitkomst.verdict;
  if (verdict === undefined) {
    return '**Code-review niet gelukt.** Geen bruikbaar verdict.';
  }
  if (verdict.bevindingen.length === 0) {
    return `**Code-review door een onbemande reviewer.**\n\nGeen bevindingen.\n\n**Oordeel:** ${verdict.oordeel}`;
  }
  const tabel =
    `| Bestand | Regel | Ernst | Bevinding |\n| --- | --- | --- | --- |\n` +
    verdict.bevindingen
      .map(
        (b) =>
          `| ${b.bestand} | ${b.regel === undefined ? '—' : String(b.regel)} | ${b.ernst} | ${b.bevinding} |`,
      )
      .join('\n');
  return `**Code-review door een onbemande reviewer.**\n\n${tabel}\n\n**Oordeel:** ${verdict.oordeel}`;
}

/**
 * Plaatst een comment op de PR die bij dit item hoort, via `gh api` (#184).
 *
 * Zoekt de PR op aan de hand van de branchnaam (`slice/<issue>-1`) in de app-repo.
 * Geeft `true` terug als het lukt, `false` als de PR niet gevonden of het comment
 * niet geplaatst kan worden — de aanroeper valt dan terug op het issue.
 */
function plaatsPrComment(item: Bouwitem, tekst: string): boolean {
  const branch = bouwBranch(item.issue);
  const repo = `${EIGENAAR}/${item.app}`;
  const nummer = uitvoerVan('gh', [
    'pr',
    'view',
    branch,
    '--repo',
    repo,
    '--json',
    'number',
    '--jq',
    '.number',
  ]);
  if (nummer === undefined || nummer === '') {
    return false;
  }
  const uitkomst = run(
    'gh',
    ['api', `repos/${repo}/issues/${nummer}/comments`, '-f', `body=${tekst}`],
    { capture: true, toleranter: true },
  );
  return uitkomst.code === 0;
}

// --- antwoord: een bouw-escalatie beantwoorden --------------------------------

/**
 * Verwerkt het antwoord op een bouw-escalatie: hervat de sessie met `draaiBouwer` en
 * draait het bouw-afrondingspad (review + inleveren). De logica zit hier en niet in
 * `orkestreer.ts` omdat zij het schema, de permissions en de afronding deelt met
 * `bouwAf` — `werkAntwoordAf` delegeert hier naartoe op `soort === 'bouw'`.
 */
export async function werkBouwAntwoordAf(
  issue: number,
  tekst: string,
  escalatie: Escalatie,
  opties: AntwoordOpties,
  cwd: string,
): Promise<void> {
  kop(`Bouw-antwoord op #${String(issue)}`);

  const app = escalatie.app;
  if (app === undefined) {
    throw new GebruikersFout(
      `De escalatie-comment op #${String(issue)} bevat geen app-veld; hervatten kan niet.\n` +
        '  Dit is een comment uit een oudere versie. Begin een verse run:\n' +
        `    factory orkestreer --soort bouw --issue ${String(issue)} --eenmalig`,
    );
  }

  const wortel = opties.werkplaatsWortel ?? werkplaatsWortel;
  const werkmap = bouwWerkplek(app, issue, wortel);
  const factoryMap = versWerkplaats('factory', EIGENAAR, wortel);

  const opdracht =
    opties.opnieuw === true
      ? verseBouwOpdracht(issue, app, tekst, escalatie, cwd, wortel)
      : {
          prompt: vervolgPrompt(escalatie, tekst),
          werkmap: escalatie.werkmap,
          sessie: escalatie.sessie,
          hervat: true,
        };

  const instellingen = leesInstellingen(opties.paden ?? standaardPaden());
  const uitkomst = await draaiBouwer({
    ...opdracht,
    budgetUsd: instellingen.bouwBudgetPerRun,
    model: MODEL,
    effort: instellingen.werkerEffort,
  });

  if (uitkomst.sessieWeg === true) {
    throw new GebruikersFout(
      `De sessie ${escalatie.sessie} bestaat niet meer, dus hervatten kan niet.\n` +
        `  Begin een verse run met je antwoord erbij:\n` +
        `    factory orkestreer antwoord ${String(issue)} "${tekst}" --opnieuw\n` +
        '  Dat kost meer (geen cache) en het werk tot de escalatie is weg, maar het loopt door.',
    );
  }

  if (uitkomst.afloop === 'mislukt') {
    plaatsComment(
      issue,
      `**Bouw-antwoord verwerkt, maar de run mislukte.** ${uitkomst.fout ?? 'onbekende fout'}\n\n` +
        `<sub>${uitkomst.kosten === undefined ? '' : `$${uitkomst.kosten.toFixed(2)} · `}` +
        `${uitkomst.beurten === undefined ? '' : `${String(uitkomst.beurten)} beurten`}</sub>\n` +
        `<!-- orkestrator: soort=bouw app=${app} sessie=${uitkomst.sessie} werkmap=${werkmap} -->`,
      cwd,
    );
    throw new GebruikersFout(`De run mislukte: ${uitkomst.fout ?? 'onbekende fout'}`);
  }

  const verdict = uitkomst.verdict;
  if (verdict?.uitkomst === 'escalatie') {
    // Nog een vraag. Het escalatie-label blijft staan; er is gewoon een nieuwe ronde nodig.
    plaatsComment(
      issue,
      escalatieComment(issue, verdict.vraag, verdict.advies, uitkomst, werkmap, 'bouw', app),
      cwd,
    );
    ok(`#${String(issue)} escaleert opnieuw`);
    return;
  }

  if (verdict?.uitkomst !== 'klaar') {
    throw new GebruikersFout(`#${String(issue)} gaf geen bruikbare uitkomst.`);
  }

  // Review: alleen als de bouw slaagde, in de worktree die er dan nog staat (#184).
  let reviewUitkomst: ReviewUitkomst | undefined;
  try {
    reviewUitkomst = await draaiReviewer({
      prompt: reviewPrompt(
        { issue, app, titel: '', labels: [], kolom: GECLAIMD_KOLOM, aangemaakt: '' },
        werkmap,
        factoryMap,
      ),
      werkmap,
      sessie: randomUUID(),
      extraMappen: [factoryMap],
      budgetUsd: instellingen.reviewBudgetPerRun,
      model: MODEL,
      effort: instellingen.werkerEffort,
    });
  } catch (fout) {
    const reden = fout instanceof Error ? fout.message : String(fout);
    waarschuwing(`review kon niet draaien: ${reden}`);
    reviewUitkomst = { afloop: 'mislukt', sessie: '', weigeringen: 0, fout: reden };
  }

  // Het item ophalen voor de titel (PR-titel bij inleveren) en de volledige Bouwitem.
  const item = bordItems(cwd)?.find((kandidaat) => kandidaat.issue === issue);
  const titel = item?.titel ?? `#${String(issue)}`;
  const bouwitem: Bouwitem = {
    issue,
    app,
    titel,
    labels: item?.labels ?? [],
    kolom: GECLAIMD_KOLOM,
    aangemaakt: item?.aangemaakt ?? '',
  };

  // Het escalatie-label weghalen: het item is niet meer vastgelopen.
  haalLabelWeg(issue, ESCALATIE_LABEL, cwd);

  verwerkBouw(bouwitem, uitkomst, reviewUitkomst, cwd, wortel, inleveren);
}

/**
 * Bouwt een verse bouw-opdracht op voor `--opnieuw`: de sessie is weg, dus de volledige
 * prompt moet er opnieuw in, mét het antwoord op de eerdere vraag.
 */
function verseBouwOpdracht(
  issue: number,
  app: string,
  tekst: string,
  escalatie: Escalatie,
  cwd: string,
  wortel: string,
): { prompt: string; werkmap: string; sessie: string } {
  const item = bordItems(cwd)?.find((kandidaat) => kandidaat.issue === issue);
  if (item?.app === undefined) {
    throw new GebruikersFout(
      `Kon #${String(issue)} niet op het board vinden (of het heeft geen App-veld);\n` +
        '  zonder die gegevens is er geen opdracht om verse mee te beginnen.',
    );
  }
  const werkmap = bouwWerkplek(app, issue, wortel);
  const factoryMap = versWerkplaats('factory', EIGENAAR, wortel);
  return {
    prompt:
      `${bouwPrompt({ ...item, app: item.app }, werkmap, factoryMap)}\n\n` +
      `## Eerder gevraagd\n\nEen eerdere poging stelde deze vraag:\n\n> ${escalatie.vraag}\n\n` +
      `Het antwoord is:\n\n> ${tekst}\n\nWerk daarmee verder.`,
    werkmap,
    sessie: randomUUID(),
  };
}

/** Wat `--reeks` kan zijn: een aantal van de kop, of precies deze items. */
export type ReeksKeuze =
  | { readonly soort: 'aantal'; readonly aantal: number }
  | { readonly soort: 'lijst'; readonly issues: readonly number[] };

/**
 * Leest `--reeks`: een aantal (`--reeks 4`) of een lijst (`--reeks 126,186,263`).
 *
 * Twee vormen op één vlag, en niet een aparte vlag voor de lijst: de vraag is dezelfde
 * ("werk deze reeks af"), alleen het antwoord op *welke* items verschilt. `--issue`
 * blijft wat het was — één item voor `--eenmalig` of `--dry` — zodat elke vlag één
 * betekenis houdt.
 *
 * Een bovengrens van 20 op het aantal: dit start werkers die geld kosten, en een
 * typefout van één nul is dan duur. Wie meer wil doet het twee keer.
 */
export function leesReeks(waarde: string | undefined): ReeksKeuze | undefined {
  if (waarde === undefined) return undefined;
  if (waarde.includes(',')) {
    const issues = waarde.split(',').map((deel) => {
      const nummer = Number(deel.trim());
      if (!Number.isInteger(nummer) || nummer < 1) {
        throw new GebruikersFout(`--reeks wil issuenummers, niet "${deel.trim()}".`);
      }
      return nummer;
    });
    const ontdubbeld = [...new Set(issues)];
    if (ontdubbeld.length !== issues.length) {
      // Niet stil ontdubbelen: dan denk je vier items te doen en zijn het er drie.
      waarschuwing('dubbele nummers in --reeks; elk item draait één keer.');
    }
    if (ontdubbeld.length > 20) {
      throw new GebruikersFout('--reeks doet er maximaal 20 in één keer.');
    }
    return { soort: 'lijst', issues: ontdubbeld };
  }
  const aantal = Number(waarde);
  if (!Number.isInteger(aantal) || aantal < 1 || aantal > 20) {
    throw new GebruikersFout(`--reeks wil een geheel getal van 1 tot 20, niet "${waarde}".`);
  }
  return { soort: 'aantal', aantal };
}

/**
 * Leest `--issue`: een positief geheel getal, of niets.
 *
 * Bewust een fout vóór de board-lezing. `--issue abc` zou anders een lezing kosten om
 * daarna niets te vinden, en de melding zou over de wachtrij gaan in plaats van over
 * de typefout.
 */
export function leesIssue(waarde: string | undefined): number | undefined {
  if (waarde === undefined) {
    return undefined;
  }
  const nummer = Number(waarde);
  if (!Number.isInteger(nummer) || nummer < 1) {
    throw new GebruikersFout(`--issue verwacht een issuenummer, geen '${waarde}'.`);
  }
  return nummer;
}

export function leesSoort(waarde: string | undefined): 'refine' | 'bouw' {
  if (waarde === undefined || waarde === 'refine') {
    return 'refine';
  }
  if (waarde === 'bouw') {
    return 'bouw';
  }
  throw new GebruikersFout(`Onbekende --soort '${waarde}'. Kies: refine (default) of bouw.`);
}
