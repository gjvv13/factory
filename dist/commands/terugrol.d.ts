export interface TerugrolOpties {
    /** Slaat de prod-bevestiging over (voor niet-interactief gebruik). */
    readonly ja?: boolean;
}
/**
 * Rolt een omgeving terug naar de vorige release-tag: de op één na nieuwste tag in de
 * repo. De bedoelde terugweg als een uitrol wél live ging maar stuk bleek (#121) —
 * seconden werk tegenover het vooruit-fixen dat de rooktest anders vergt. Bewust een
 * eigen, kaal commando: het is een gewone `promote` naar de vorige tag, zodat een mens
 * het direct in een terminal kan draaien zonder omweg.
 */
export declare function terugrol(omgevingArgument: string | undefined, opties?: TerugrolOpties): Promise<void>;
