/** Eén fastlane-item dat vannacht met auto-merge is ingeleverd. */
export interface FastlaneResultaat {
    /** Het issuenummer op het board. */
    readonly issue: number;
    /** De applicatie waar de PR bij hoort. */
    readonly app: string;
    /** De URL van de geopende PR. */
    readonly prUrl: string;
}
/**
 * Bouwt het berichttekst op voor de ochtendmelding.
 *
 * Exporteert dit apart zodat de unit-test de inhoud kan controleren zonder
 * daadwerkelijk een HTTP-request te doen.
 */
export declare function bouwMelding(items: readonly FastlaneResultaat[]): string;
/**
 * Stuurt de ochtendmelding als er fastlane-items zijn. Fire-and-forget.
 *
 * - Geen items → geen melding, geen waarschuwing (geen ruis).
 * - URL niet gezet → waarschuwing, geen fout.
 * - Request faalt → waarschuwing, geen fout.
 */
export declare function stuurOchtendmelding(items: readonly FastlaneResultaat[], notifyUrl: string | undefined, notifyToken: string | undefined, verzend?: (url: string, body: string, token: string | undefined) => Promise<boolean>): Promise<void>;
