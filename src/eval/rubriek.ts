/**
 * De rubriek waarmee de judge een refine-uitwerking scoort (#361, slice 1).
 *
 * Zeven criteria, elk 0–2 punten, letterlijk overgenomen uit de rubriek-tabel in de
 * issue. De rubriek is de enige bron van waarheid: `judge.ts` giet 'm in de
 * judge-prompt (`formatRubriek`) én de parser toetst dat de judge exact deze zeven
 * criteria terugscoort. Zo drift de prompt niet weg van de score-poort.
 *
 * De normalisatie is vast: `(som / max) × 10`, afgerond op één decimaal, met
 * `max = aantal criteria × 2` (14 bij zeven criteria). Dat cijfer op een schaal van
 * 0–10 is wat de basislijn-ratchet vergelijkt — dezelfde vorm als de dekkingspoort.
 */

/** Eén criterium van de rubriek: het nummer, de naam, en wat 0, 1 en 2 betekenen. */
export interface RubriekCriterium {
  /** 1-gebaseerd, in de volgorde van de rubriek-tabel; de judge scoort per nummer. */
  readonly nummer: number;
  readonly naam: string;
  /** Wat een score van 0 betekent (de ondergrens). */
  readonly nul: string;
  /** Wat een score van 1 betekent (het midden). */
  readonly een: string;
  /** Wat een score van 2 betekent (de bovengrens). */
  readonly twee: string;
}

/**
 * De refine-rubriek: zeven criteria uit de issue. De volgorde is vast en de
 * `nummer`-waarden lopen 1–7; `judge.ts` en `basislijn.ts` leunen daarop.
 */
export const REFINE_RUBRIEK: readonly RubriekCriterium[] = [
  {
    nummer: 1,
    naam: 'Templatestructuur',
    nul: 'secties ontbreken',
    een: 'aanwezig, onvolledig',
    twee: 'compleet per refinement.md',
  },
  {
    nummer: 2,
    naam: 'Premissetoets',
    nul: 'geen bewijsplaatsen',
    een: 'deels met verwijzingen',
    twee: 'alles verankerd in code',
  },
  {
    nummer: 3,
    naam: 'Laagindeling',
    nul: 'verkeerde lagen',
    een: 'grotendeels juist',
    twee: 'klopt met coding guidelines',
  },
  {
    nummer: 4,
    naam: 'Slicekwaliteit',
    nul: 'niet zelfstandig inzetbaar',
    een: 'meeste criteria toetsbaar',
    twee: 'alle criteria toetsbaar',
  },
  {
    nummer: 5,
    naam: 'Testspecificatie',
    nul: 'geen tests genoemd',
    een: 'tests zonder dekking/criterium',
    twee: 'per criterium aanwijsbaar',
  },
  {
    nummer: 6,
    naam: 'Functioneel behoud',
    nul: 'secties herschreven',
    een: 'kleine afwijkingen',
    twee: 'letterlijk overgenomen',
  },
  {
    nummer: 7,
    naam: 'Beknoptheid',
    nul: '>250 of <80 regels',
    een: '180–250 of 80–120 regels',
    twee: '120–180 regels',
  },
];

/**
 * De bouw-rubriek: vijf criteria voor een bouw-uitwerking (#361, slice 2). Zelfde vorm
 * als de refine-rubriek — elk 0–2, `nummer` loopt vast 1–5 — maar afgestemd op wat een
 * bouw-run oplevert: het verdict met bewijs per acceptatiecriterium plus de diff uit de
 * worktree. De judge scoort exact deze vijf op hun nummer; `judge.ts` giet ze in de
 * bouw-judge-prompt en de parser dwingt dezelfde vijf af.
 */
export const BOUW_RUBRIEK: readonly RubriekCriterium[] = [
  {
    nummer: 1,
    naam: 'Criteriadekking',
    nul: 'criteria niet gedekt',
    een: 'deels gedekt, bewijs mager',
    twee: 'elk criterium gedekt met bewijs',
  },
  {
    nummer: 2,
    naam: 'Testdekking',
    nul: 'geen tests of raken de criteria niet',
    een: 'tests aanwezig, dekken niet elk criterium',
    twee: 'tests dekken de criteria aantoonbaar',
  },
  {
    nummer: 3,
    naam: 'Laagindeling',
    nul: 'verkeerde lagen',
    een: 'grotendeels juist',
    twee: 'code volgt de coding-guidelines-lagen',
  },
  {
    nummer: 4,
    naam: 'Verify-resultaat',
    nul: 'poort niet gedraaid of rood',
    een: 'poort draait, met waarschuwingen',
    twee: 'poort groen aangetoond',
  },
  {
    nummer: 5,
    naam: 'Geen verzonnen imports',
    nul: 'imports naar niet-bestaande code',
    een: 'twijfelachtige of ongebruikte imports',
    twee: 'alle imports bestaan en worden gebruikt',
  },
];

/** De hoogst haalbare somscore: elk criterium telt maximaal 2 punten. */
export function maxPunten(rubriek: readonly RubriekCriterium[] = REFINE_RUBRIEK): number {
  return rubriek.length * 2;
}

/**
 * Normaliseert een reeks criteriumscores (elk 0–2) naar een cijfer op 0–10, afgerond
 * op één decimaal: `(som / max) × 10`. De lengte moet met de rubriek overeenkomen;
 * wijkt hij af, dan is dat een programmeerfout (de judge-parser bewaakt de invoer al).
 */
export function normaliseerScore(
  scores: readonly number[],
  rubriek: readonly RubriekCriterium[] = REFINE_RUBRIEK,
): number {
  if (scores.length !== rubriek.length) {
    throw new Error(
      `normaliseerScore verwacht ${String(rubriek.length)} scores, kreeg ${String(scores.length)}.`,
    );
  }
  const som = scores.reduce((totaal, score) => totaal + score, 0);
  // Eerst ×10, dan afronden op één decimaal: `Math.round(x × 10) / 10` op de reeds
  // met 10 vermenigvuldigde breuk zou tweemaal schalen.
  return Math.round((som / maxPunten(rubriek)) * 100) / 10;
}

/**
 * Zet de rubriek om naar een leesbare tabel voor in de judge-prompt. Eén bron van
 * waarheid: de judge ziet exact de criteria die de parser daarna afdwingt.
 */
export function formatRubriek(rubriek: readonly RubriekCriterium[] = REFINE_RUBRIEK): string {
  const kop = '| # | Criterium | 0 | 1 | 2 |\n| --- | --- | --- | --- | --- |';
  const regels = rubriek.map(
    (c) => `| ${String(c.nummer)} | ${c.naam} | ${c.nul} | ${c.een} | ${c.twee} |`,
  );
  return [kop, ...regels].join('\n');
}
