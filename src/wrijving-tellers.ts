import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Persistente per-tool weigeringsteller (#543).
 *
 * De teller is monotoon — geen per-dag reset. Sporadische weigeringen (1 per nacht)
 * bereiken na drie nachten alsnog de drempel. Een per-dag-reset zou ze onzichtbaar
 * houden.
 *
 * Het bestand staat in `~/Library/Application Support/factory/wrijving-tellers.json`,
 * naast het orkestrator-staatbestand.
 */

/** Pas na deze drempel groeit de allowlist automatisch (#543, besluit 3). */
export const GROEI_DREMPEL = 3;

/** Een tool die nu de drempel bereikt heeft: label, patroon en de nieuwe telling. */
export interface VerwerkteGroei {
  readonly label: string;
  readonly patroon: string;
  readonly nieuweTelling: number;
}

/**
 * Leest de weigeringstellers uit het JSON-bestand.
 *
 * Een onleesbaar of ontbrekend bestand levert een leeg object — geen crash. Zelfde
 * patroon als `leesStaat` in `orkestrator-instellingen.ts`.
 */
export function leesTellers(pad: string): Record<string, number> {
  if (!existsSync(pad)) {
    return {};
  }
  try {
    const inhoud = readFileSync(pad, 'utf8');
    const parsed: unknown = JSON.parse(inhoud);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    // Valideer dat alle waarden getallen zijn; negeer ongeldige entries.
    const resultaat: Record<string, number> = {};
    for (const [sleutel, waarde] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof waarde === 'number' && Number.isFinite(waarde)) {
        resultaat[sleutel] = waarde;
      }
    }
    return resultaat;
  } catch {
    return {};
  }
}

/**
 * Verhoogt de tellers voor de gegeven labels, schrijft het bestand, en geeft de
 * labels terug die **nu** de drempel bereiken.
 *
 * "Nu de drempel bereiken" betekent: de telling ging van <N naar ≥N in deze update.
 * Een label dat al ≥N was bij binnenkomst is al verwerkt (of niet veilig) en komt
 * niet in de lijst — dat voorkomt dubbele PR's.
 *
 * @param patroonVan - vertaalt een label naar een allowlist-patroon; injecteerbaar
 *   zodat de test geen afhankelijkheid op `veilige-klasse.ts` nodig heeft.
 */
export function werkTellersBij(
  pad: string,
  labels: readonly string[],
  patroonVan: (label: string) => string,
): VerwerkteGroei[] {
  if (labels.length === 0) return [];

  const tellers = leesTellers(pad);
  const groei: VerwerkteGroei[] = [];

  for (const label of labels) {
    const was = tellers[label] ?? 0;
    const wordt = was + 1;
    tellers[label] = wordt;

    // Alleen melden als de drempel nu bereikt wordt (van <N naar ≥N).
    if (was < GROEI_DREMPEL && wordt >= GROEI_DREMPEL) {
      groei.push({ label, patroon: patroonVan(label), nieuweTelling: wordt });
    }
  }

  mkdirSync(path.dirname(pad), { recursive: true });
  writeFileSync(pad, `${JSON.stringify(tellers, null, 2)}\n`);

  return groei;
}
