import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { factoryPakketDir } from '../paths.js';

/**
 * De eval-basislijn: per gouden-set-item de laatst geaccepteerde criteriumscores en
 * het genormaliseerde totaal, met een tijdstempel (#361, slice 1).
 *
 * Dit is dezelfde ratchet-vorm als de dekkingspoort (`src/dekking-basislijn.ts`): de
 * lat beweegt met de scores mee omhoog en nooit vanzelf omlaag. Een score die verder
 * dan de tolerantie onder de basislijn zakt is een regressie; een score die er verder
 * bovenuit komt schuift de lat omhoog. Zonder basislijn voor een item is het een
 * bootstrap: we leggen de meting vast en oordelen niet.
 *
 * De tolerantie (default 0,5 punt) vangt de ruis van een niet-deterministische
 * LLM-judge, precies zoals de dekkings-tolerantie de run-op-run-ruis van v8 vangt.
 */

/** Standaardtolerantie tegen judge-ruis, in punten op de 0–10-schaal (besluit #2). */
export const EVAL_TOLERANTIE = 0.5;

/** Het standaardpad van de basislijn, in de factory-repo zelf (in versiebeheer). */
export const EVAL_BASISLIJN_PAD = path.join(factoryPakketDir, 'eval', 'basislijn.json');

const itemBasislijnSchema = z.object({
  /** Het genormaliseerde totaal op 0–10 waar de ratchet tegen vergelijkt. */
  totaal: z.number().min(0).max(10),
  /** De ruwe criteriumscores (elk 0–2), zodat een latere run kan tonen wat verschoof. */
  criteria: z.array(z.number().int().min(0).max(2)),
  /** Wanneer deze basislijn is vastgelegd; puur voor de mens die het bestand leest. */
  tijdstempel: z.string().min(1),
});

export type ItemBasislijn = z.infer<typeof itemBasislijnSchema>;

/** De basislijn: een map van issue-nummer (als string) naar de vastgelegde scores. */
const basislijnSchema = z.record(z.string(), itemBasislijnSchema);

export type EvalBasislijn = z.infer<typeof basislijnSchema>;

/**
 * Leest de basislijn van schijf. Een ontbrekend of kapot bestand telt als afwezig —
 * een lege basislijn — precies zoals de dekkings-ratchet: dan bootstrapt de
 * eerstvolgende run elk item in plaats van dat de poort omvalt op één beschadigde byte.
 */
export function leesBasislijn(pad: string = EVAL_BASISLIJN_PAD): EvalBasislijn {
  if (!existsSync(pad)) {
    return {};
  }
  try {
    const parsed = basislijnSchema.safeParse(JSON.parse(readFileSync(pad, 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Schrijft de basislijn met de items op issue-nummer gesorteerd (numeriek) en een
 * sluitende nieuwe regel, zodat de diff stabiel blijft over runs heen — dezelfde stijl
 * als `schrijfBasislijn` in de dekkingspoort.
 */
export function schrijfBasislijn(pad: string, basislijn: EvalBasislijn): void {
  const geordend: EvalBasislijn = {};
  for (const sleutel of Object.keys(basislijn).sort((a, b) => Number(a) - Number(b))) {
    const entry = basislijn[sleutel];
    if (entry !== undefined) {
      geordend[sleutel] = entry;
    }
  }
  writeFileSync(pad, `${JSON.stringify(geordend, null, 2)}\n`);
}

/** Het oordeel over één gouden-set-item, tegen zijn basislijn. */
export interface ItemOordeel {
  /** Er was nog geen basislijn voor dit item: eerste meting, geen oordeel. */
  readonly bootstrap: boolean;
  /** Het totaal zakte verder dan de tolerantie onder de basislijn. */
  readonly regressie: boolean;
  /** Het totaal kwam verder dan de tolerantie boven de basislijn: de lat schuift omhoog. */
  readonly winst: boolean;
  /** Het genormaliseerde totaal van nu. */
  readonly nu: number;
  /** Het basislijn-totaal, of undefined bij een bootstrap. */
  readonly was: number | undefined;
}

/**
 * Beoordeelt het totaal van nu tegen de basislijn, met dezelfde logica als
 * `beoordeelRatchet` in de dekkingspoort: bootstrap zonder basislijn, regressie onder
 * `was - tolerantie`, winst boven `was + tolerantie`, en anders geen beweging.
 */
export function beoordeelItem(
  nu: number,
  was: number | undefined,
  tolerantie: number = EVAL_TOLERANTIE,
): ItemOordeel {
  if (was === undefined) {
    return { bootstrap: true, regressie: false, winst: false, nu, was: undefined };
  }
  return {
    bootstrap: false,
    regressie: nu < was - tolerantie,
    winst: nu > was + tolerantie,
    nu,
    was,
  };
}
