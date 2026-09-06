/**
 * Env-toevoeging voor het e2e-serverproces: zet `NODE_V8_COVERAGE` zodat Node de ruwe
 * v8-coverage wegschrijft. Alleen bij een coverage-poort (`FACTORY_COVERAGE`), zodat een
 * gewone e2e-run niets extra's doet. Spreid dit ná `...process.env` in de child-env.
 */
export declare function e2eCoverageEnv(rootDir: string): Record<string, string>;
/**
 * Zet de ruwe v8-coverage van de server om naar `coverage/e2e/` (json-summary + json)
 * met c8, gescoped op `app/src/**` minus de standaard-exclude. Roep dit aan in de
 * e2e-teardown, ná het afsluiten van de server — anders zijn de raw-bestanden er nog
 * niet (Node schrijft ze pas bij het exit van het proces).
 *
 * Geen coverage-poort of geen raw-map: stil niets doen. c8 matcht de include/exclude
 * ten opzichte van `process.cwd()`, dus dit hoort vanuit de applicatiemap te draaien —
 * precies waar de e2e-`global-setup` al staat.
 */
export declare function schrijfE2eDekking(rootDir: string): Promise<void>;
