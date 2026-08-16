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
export declare function leesArgumenten(rest: readonly string[], spec?: VlagSpec): Argumenten;
