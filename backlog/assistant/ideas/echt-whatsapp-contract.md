---
id: echt-whatsapp-contract
titel: Placeholder-pact vervangen door echt WhatsApp Cloud-contract
status: idee
aangemaakt: 2026-08-01
---

# Placeholder-pact vervangen door echt WhatsApp Cloud-contract

## Wat wil ik?

De contract-test die nu fictie test, vervangen door een test die de échte
uitgaande WhatsApp Cloud-koppeling vastlegt.

## Waarom?

`app/test/contract/http-client.pact.test.ts` en de gegenereerde
`pacts/factory-backend-example-external-service.json` gebruiken nog de
placeholder-namen `factory-backend` (consumer) en `example-external-service`
(provider). De test geeft het zelf toe: "Er is nog geen echte externe
koppeling." Eén van de twee contracten dekt dus template-fictie in plaats van de
echte koppeling, terwijl die wel meelift in `pnpm verify` en groen kleurt — vals
vertrouwen. De echte uitgaande client (`whatsapp-cloud-client.ts`) verdient het
consumer-driven contract.

## Hoe zie ik het voor me?

- De placeholder-test vervangen door een pact op `whatsapp-cloud-client`: welke
  request stuurt de client naar de Cloud API, welke response verwacht hij.
- De oude placeholder-pact en het bijbehorende JSON-bestand opruimen.

## Wat weet ik nog niet?

- Blijft de generieke placeholder-pact nuttig in het skeleton (als voorbeeld
  voor een nieuwe app), en halen we hem alleen in assistant weg? Of hoort dit
  ook in de factory opgeschoond te worden?
- Welke interacties willen we minimaal vastleggen (versturen bericht, foutpaden)?

## Grofweg hoe groot?

Middel (dagdeel).
