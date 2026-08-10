import type { Dekkingscijfers } from './coverage-merge.js';
/**
 * De dekkings-ratchet legt het hoogste dekkingsniveau dat een app ooit haalde vast in een
 * gecommit bestand, en vergelijkt elke `factory verify` daarmee. Zo kan de dekking niet stil
 * wegzakken tot de vaste ondergrens (`dekkingsMinimum`): de lat beweegt met de app mee omhoog
 * en nooit omlaag. Dit bestand bevat de pure logica (lezen, beoordelen, de nieuwe basislijn
 * bepalen); `verify` bedient het en verzorgt de terminaluitvoer.
 */
/** De vier metrics in vaste volgorde, zodat lezen, schrijven en melden gelijk lopen. */
export declare const METRICS: readonly ["lines", "statements", "functions", "branches"];
/** Bestandsnaam van de basislijn, in de app-root en in versiebeheer. */
export declare const BASISLIJN_BESTAND = "dekking-basislijn.json";
/** Eén metric die significant afwijkt van de basislijn (omhoog of omlaag). */
export interface Verschil {
    readonly naam: (typeof METRICS)[number];
    readonly nu: number;
    readonly was: number;
}
export interface RatchetOordeel {
    /** Er was nog geen basislijn: dit is de eerste meting, we leggen 'm vast zonder te oordelen. */
    readonly bootstrap: boolean;
    /** Metrics die verder dan de tolerantie onder de basislijn zakken — de regressies. */
    readonly regressies: readonly Verschil[];
    /** Metrics die verder dan de tolerantie boven de basislijn komen — winst om vast te leggen. */
    readonly verhogingen: readonly Verschil[];
    /** De weg te schrijven basislijn, of undefined als er niets verandert. Verlaagt nooit. */
    readonly nieuweBasislijn?: Dekkingscijfers | undefined;
}
/**
 * Leest de basislijn van schijf, of undefined als die er (nog) niet is of onleesbaar is.
 * Een kapot bestand mag de poort niet laten omvallen: dan behandelen we het als afwezig en
 * legt de eerstvolgende volledige verify een verse basislijn vast.
 */
export declare function leesBasislijn(appDir: string): Dekkingscijfers | undefined;
/** Schrijft de basislijn met vaste sleutelvolgorde en een sluitende nieuwe regel. */
export declare function schrijfBasislijn(appDir: string, cijfers: Dekkingscijfers): void;
/**
 * Beoordeelt de gemeten dekking tegen de basislijn. Zonder basislijn is het een bootstrap: we
 * geven de meting terug als vast te leggen basislijn en oordelen niet. Met basislijn geldt per
 * metric: zakt hij verder dan `tolerantie` onder de vastgelegde waarde, dan is het een
 * regressie; komt hij er verder dan `tolerantie` bovenuit, dan schuift die metric omhoog. De
 * tolerantie vangt de kleine run-op-run-ruis van v8 en houdt de basislijn stabiel. De nieuwe
 * basislijn neemt per metric het maximum van oud en nu, dus hij daalt nooit.
 */
export declare function beoordeelRatchet(nu: Dekkingscijfers, basislijn: Dekkingscijfers | undefined, tolerantie: number): RatchetOordeel;
