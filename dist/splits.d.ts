/** Eén slice-sectie uit de issue-body. */
export interface Slice {
    /** Het volgnummer uit de `### Slice <n> — <naam>`-kop. */
    readonly nummer: number;
    /** De naam na het streepje. */
    readonly naam: string;
    /** De volledige inhoud van de sectie (zonder de kopregel zelf). */
    readonly body: string;
}
/**
 * Parset de issue-body en retourneert de gevonden slice-secties. Een lege lijst
 * betekent dat er nul of één slice is, of dat het formaat afwijkt.
 *
 * Geëxporteerd voor unit-tests: de parser is puur en heeft geen side-effects.
 */
export declare function parseSlices(body: string): Slice[];
/**
 * Vervangt de slice-secties in de originele body door een verwijzingsblok.
 * Behoudt alles vóór de eerste slice-kop en alles ná de laatste slice-sectie
 * (Risico's, Besluiten, enz.).
 *
 * Geëxporteerd voor unit-tests.
 */
export declare function herschrijfBody(origineel: string, kinderen: readonly {
    issue: number;
    naam: string;
}[]): string;
/**
 * Leest het App-veld van een issue via het board. Gebruikt een gerichte query die
 * 1–2 GraphQL-punten kost, niet `item-list` (102 punten).
 */
export declare const APP_QUERY = "query($eigenaar:String!,$repo:String!,$nummer:Int!){\n  repository(owner:$eigenaar,name:$repo){ issue(number:$nummer){\n    projectItems(first:10){ nodes { project { number }\n      app: fieldValueByName(name:\"App\"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } }\n}";
/** Parset het GraphQL-antwoord tot de App-waarde. Geëxporteerd voor contract-tests. */
export declare function parseAppAntwoord(ruw: string): string | undefined;
export declare function splits(issueNummer: string | undefined): void;
