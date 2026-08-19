/**
 * Draait de in `factory.json` beschreven rooktest tegen een omgeving: één echte,
 * read-only aanroep door de kern na een uitrol (#121). Slaagt hij niet, dan faalt dit
 * commando luid — de deploy-job wordt rood (en dat meldt zich via de gefaalde-deploy-
 * melding, #112) — met een expliciet terugrol-voorstel. We rollen bewust **niet**
 * automatisch terug: dat kan verrassender zijn dan het probleem. Zonder een
 * geconfigureerde rooktest is dit een no-op, zodat de deploy-workflow 'm altijd mag
 * aanroepen.
 */
export declare function rooktest(omgevingArgument: string | undefined): Promise<void>;
