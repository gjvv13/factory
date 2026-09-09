/**
 * `factory brief` — de regie-brief over alle apps (#404).
 *
 * Leest het board (één keer, 2 punten/pagina), het runlog, de escalatie-context
 * en de recentste deploy-run per app, en bouwt daar een beslis-gericht overzicht
 * van. Puur stdout; de levering naar de coördinatie-chat is een apart pad (R1).
 */
import { type BacklogItem } from '../board.js';
import { type DeployRunStatus, type EscalatieContext } from '../regie-brief.js';
/**
 * Haalt de recentste deploy-run per app op via `gh run list`.
 *
 * REST (aparte pot), 1 aanroep per app. Bij een fout: waarschuwen en overslaan,
 * de brief mag niet omvallen op een niet-bereikbare app.
 */
export declare function haalDeployRuns(apps: readonly string[], leesRun?: (app: string) => string | undefined): DeployRunStatus[];
export declare function haalEscalatieContext(geescaleerdeItems: readonly BacklogItem[], cwd?: string): EscalatieContext[];
export declare function brief(nu?: Date): void;
