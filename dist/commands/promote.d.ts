/**
 * Zet een release-tag neer op acc of prod en herstart die omgeving.
 * De omgevingen zijn losse clones die altijd op een tag staan, nooit op een
 * branch, zodat werk in de repo een draaiende omgeving niet raakt.
 */
export interface PromoteOpties {
    /** Slaat de bevestigingsvraag voor prod over; nodig om niet-interactief (CI) te promoveren. */
    readonly ja?: boolean;
}
export declare function promote(omgevingArgument: string | undefined, tagArgument: string | undefined, opties?: PromoteOpties): Promise<void>;
/** De versie uit een /health-JSON-body, of undefined als die er niet (geldig) in staat. */
export declare function versieUitHealth(body: string): string | undefined;
