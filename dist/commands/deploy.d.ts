/**
 * Orchestratie voor de uitrol-pijplijn; dit is wat de deploy-workflow op de
 * self-hosted runner aanroept na een merge naar main.
 *
 * `deploy acc` maakt een nieuwe release-tag van de huidige main (verify + bump +
 * tag + push) en rolt die uit naar acc. `deploy prod` rolt de bestaande nieuwste
 * tag uit naar prod zónder een nieuwe release — dezelfde tag die acc al draaide.
 * De conditionele prod-poort (auto, of wachten op goedkeuring bij een migratie)
 * zit in de workflow, niet hier (slice 3).
 */
export declare function deploy(omgevingArgument: string | undefined): Promise<void>;
