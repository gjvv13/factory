export type ConfigStatusValue = 'ok' | 'incomplete';

export interface ConfigReport {
  readonly status: ConfigStatusValue;
  /** Aantal verwachte sleutels. */
  readonly expected: number;
  /** Verwachte sleutels die niet in de omgeving staan. */
  readonly missing: readonly string[];
  /** Verwachte sleutels die in de omgeving staan maar leeg zijn. */
  readonly empty: readonly string[];
  /** Aantal aanwezige sleutels (van de verwachte). */
  readonly present: number;
  /** Totaal aantal omgevingssleutels dat de app ziet. */
  readonly known: number;
}

/**
 * Vergelijkt de verwachte sleutels met de aanwezige omgeving. Puur: geen I/O,
 * geen waarden — alleen namen en aantallen.
 *
 * @param verwacht  De sleutels die de app verwacht (uit `VERWACHTE_SLEUTELS`).
 * @param presentKeys  Alle omgevingssleutels die aanwezig zijn (naam, niet waarde).
 * @param emptyKeys  Subset van presentKeys waarvan de waarde een lege string is.
 */
export function configReport(
  verwacht: readonly string[],
  presentKeys: readonly string[],
  emptyKeys: readonly string[],
): ConfigReport {
  const presentSet = new Set(presentKeys);
  const emptySet = new Set(emptyKeys);

  const missing = verwacht.filter((k) => !presentSet.has(k));
  const empty = verwacht.filter((k) => presentSet.has(k) && emptySet.has(k));

  const present = verwacht.length - missing.length;
  const status: ConfigStatusValue = missing.length === 0 && empty.length === 0 ? 'ok' : 'incomplete';

  return {
    status,
    expected: verwacht.length,
    missing,
    empty,
    present,
    known: presentKeys.length,
  };
}
