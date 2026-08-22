import { GebruikersFout } from './shell.js';

/**
 * Welke vlaggen een commando kent. Alles wat er niet in staat is een fout: een
 * genegeerde vlag laat een aanroep slagen die niet deed wat er stond.
 */
export interface VlagSpec {
  /** Vlaggen zonder waarde, bijvoorbeeld `--snel`. */
  readonly schakelaars?: readonly string[];
  /** Vlaggen mét waarde, bijvoorbeeld `--repo`. */
  readonly waarden?: readonly string[];
}

export interface Argumenten {
  readonly schakelaars: ReadonlySet<string>;
  readonly waarden: ReadonlyMap<string, string>;
  readonly positioneel: readonly string[];
}

/**
 * Leest de argumenten van één commando volgens zijn spec.
 *
 * Een vlag met waarde mag in beide vormen: `--repo=owner/naam` én
 * `--repo owner/naam`. Dat de spatie-vorm eerder stil wegviel was de kern van een
 * storing: `factory integreer --repo gjvv13/backlog` meldde "wachtrij is leeg"
 * omdat de waarde nooit aankwam. Onbekende vlaggen en een ontbrekende waarde
 * stoppen daarom hard, in plaats van door te gaan met een halve aanroep.
 */
export function leesArgumenten(rest: readonly string[], spec: VlagSpec = {}): Argumenten {
  const schakelaarNamen = new Set(spec.schakelaars ?? []);
  const waardeNamen = new Set(spec.waarden ?? []);

  const schakelaars = new Set<string>();
  const waarden = new Map<string, string>();
  const positioneel: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const argument = rest[i] ?? '';
    if (!argument.startsWith('--')) {
      positioneel.push(argument);
      continue;
    }

    const isPaar = argument.includes('=');
    const naam = isPaar ? argument.slice(0, argument.indexOf('=')) : argument;

    if (waardeNamen.has(naam)) {
      const waarde = isPaar ? argument.slice(naam.length + 1) : rest[i + 1];
      if (waarde === undefined || waarde === '' || (!isPaar && waarde.startsWith('--'))) {
        throw new GebruikersFout(`De vlag ${naam} verwacht een waarde: ${naam}=<waarde>.`);
      }
      waarden.set(naam, waarde);
      if (!isPaar) i += 1; // de waarde is geen positioneel argument
      continue;
    }

    if (schakelaarNamen.has(naam) && !isPaar) {
      schakelaars.add(naam);
      continue;
    }

    const bekend = [...schakelaarNamen, ...waardeNamen].sort().join(', ');
    throw new GebruikersFout(
      bekend === ''
        ? `Onbekende vlag ${naam}; dit commando kent er geen. Zie: factory help`
        : `Onbekende vlag ${naam}. Dit commando kent: ${bekend}. Zie: factory help`,
    );
  }

  return { schakelaars, waarden, positioneel };
}
