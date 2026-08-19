/**
 * Zet de factory-eigen backlog-items uit een tagbereik op **Done** (#185).
 *
 * De vijf apps bereiken Done via `promote prod`, maar de factory draait geen `promote` —
 * ze is gereedschap, geen draaiende app. Haar "productie" is de git-tag die de apps
 * oppikken. De auto-release (`release.yml`, #132) roept dit commando daarom aan zodra de
 * nieuwe tag staat, met de vorige en de nieuwe tag als bereik.
 *
 * Draait alleen in de backlog-repo zelf: elders zou de lokale git-historie tot verkeerde
 * board-mutaties leiden. Een bordfout houdt de release nooit tegen — de board-poort faalt
 * zacht (zie `board.ts`).
 *
 * Bleven er items liggen omdat het board niet te schrijven was, dan gaan hun nummers als
 * workflow-uitvoer `bord_overgeslagen` de deur uit, zodat `release.yml` het kan melden in
 * plaats van het in een groene run te laten staan (#195). Ontbreekt die uitvoer, dan is er
 * niets te melden: geen token zónder items in het bereik blijft stil.
 */
export declare function afronden(vorigeTag: string | undefined, tag: string | undefined): void;
