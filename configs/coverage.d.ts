/** Zie coverage.js. Geeft de Vitest coverage-optie of een leeg object. */
export function coverageOptie(
  naam: string,
  opties?: { include?: string[] },
): Record<string, unknown>;

export default coverageOptie;
