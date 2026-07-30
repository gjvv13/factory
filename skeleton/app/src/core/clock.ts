/**
 * Tijd is een expliciete afhankelijkheid, zodat gedrag testbaar blijft.
 * Domeincode gebruikt nooit `new Date()` direct (afgedwongen door ESLint).
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(Date.now()),
};

export function fixedClock(iso: string): Clock {
  const instant = new Date(iso);
  return { now: () => new Date(instant.getTime()) };
}
