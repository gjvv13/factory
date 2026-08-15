/** Zie coverage.js. Geeft de Vitest coverage-optie of een leeg object. */
export function coverageOptie(
  naam: string,
  opties?: { include?: string[]; exclude?: string[] },
): Record<string, unknown>;

/** De bronpaden die unit en contract meten; de e2e-meting sluit ze uit (#69). */
export const LAAG_INCLUDE: { unit: string[]; contract: string[] };

export default coverageOptie;
