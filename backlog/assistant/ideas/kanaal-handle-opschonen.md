---
id: kanaal-handle-opschonen
titel: Legacy @c.us-allowlist en oud-kanaal-restanten opruimen
status: idee
aangemaakt: 2026-08-01
---

# Legacy @c.us-allowlist en oud-kanaal-restanten opruimen

## Wat wil ik?

De resten van het oude WhatsApp-Web-kanaal opruimen, zodat de configuratie
klopt bij de Cloud API die we nu gebruiken.

## Waarom?

De allowlist staat in `@c.us`-vorm (bijv. `316...@c.us`) — het formaat van het
oude whatsapp-web.js-kanaal. De Cloud API stuurt kale nummers; het matcht nu
alleen doordat `normalizeWhatsAppHandle` (`app/src/core/authorizations.ts`) het
achtervoegsel afknipt. Comments verwijzen nog naar "vroeger de browser-sessie"
en "het oude kanaal" (`app/src/core/whatsapp-inbound.ts`). Dit is verwarrend
legacy dat meelift: makkelijk om een nummer per ongeluk fout te configureren.

## Hoe zie ik het voor me?

- Allowlist naar het kale Cloud-formaat brengen.
- Bepalen of `normalizeWhatsAppHandle` nog nodig is of weg kan.
- De comments over het oude kanaal verwijderen of actualiseren.

## Wat weet ik nog niet?

- Willen we `normalizeWhatsAppHandle` behouden als vangnet voor beide vormen, of
  bewust alleen het Cloud-formaat accepteren?
- Zijn er nog andere plekken die het oude formaat aannemen?

## Grofweg hoe groot?

Klein (uurtje).
