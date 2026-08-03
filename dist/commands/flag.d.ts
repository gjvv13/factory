/**
 * Feature flags aan- of uitzetten in een draaiende omgeving, zonder deploy.
 * De beheerroutes zitten op de loopback-interface van de applicatie.
 */
export declare function flag(omgevingArgument: string | undefined, naam: string | undefined, stand: string | undefined): Promise<void>;
