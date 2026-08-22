export declare const DEKKING_CONFIG_BESTAND = "dekking.json";
/**
 * Dekkingsconfiguratie losgemaakt van de volledige app-config: bevat alleen de
 * velden die de ratchet en de drempel nodig hebben, plus de map waar de basislijn
 * thuishoort. Zowel `factory.json` als `dekking.json` levert dit op.
 */
export interface DekkingsConfig {
    /** Map waar `dekking-basislijn.json` wordt gelezen en geschreven. */
    readonly dir: string;
    readonly dekkingsMinimum?: number | undefined;
    readonly dekkingsRatchet: 'uit' | 'waarschuw' | 'blokkeer';
    readonly dekkingsTolerantie: number;
}
/**
 * Leest de dekkingsconfiguratie uit de repo. Zoekt eerst `factory.json` (de volledige
 * app-config; extraheert de dekkingsvelden), dan `dekking.json` in de repo-root. Zonder
 * beide: `undefined` — er is geen dekkingsconfiguratie en de ratchet draait niet.
 */
export declare function leesDekkingsConfig(repoDir: string): DekkingsConfig | undefined;
