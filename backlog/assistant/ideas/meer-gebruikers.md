---
id: meer-gebruikers
titel: Meerdere gebruikers
status: idee
aangemaakt: 2026-07-30
---

# Meerdere gebruikers

## Wat wil ik?

Naast mezelf ook anderen (mijn vrouw en dochter) de applicatie via WhatsApp
laten gebruiken, elk met hun eigen herkenning en eigen context.

## Waarom?

In het begin ben ik de enige gebruiker, maar de applicatie is pas echt van het
huishouden als de anderen er ook bij kunnen. Nu is er één gemachtigd nummer en
een allowlist die alleen "mag wel / mag niet" kent — dat schaalt niet naar
mensen met eigen gegevens en eigen rechten.

## Hoe zie ik het voor me?

```
vrouw:   hallo
factory: Hallo <naam van vrouw>!

dochter: hallo
factory: Hallo <naam van dochter>!
```

Iedereen praat met dezelfde applicatie, maar de applicatie weet wie er stuurt en
kan daar het antwoord en de actie op aanpassen.

## Wat weet ik nog niet?

- Bouwt voort op `whatsapp-kanaal`. De allowlist kan technisch al meerdere
  nummers; het nieuwe is "wie is wie" en "wie mag wát".
- Hebben we rollen of rechten nodig, of is herkenning bij naam voorlopig genoeg?
- Krijgt iedere gebruiker eigen context (eigen lijstjes, eigen historie), of
  delen ze een gezamenlijke ruimte? Waarschijnlijk een mix, per functie.
- Hoe verhoudt dit zich tot de scheiding tussen de allowlist (mag sturen) en de
  contacts-tabel (ken ik bij naam) uit `whatsapp-kanaal`?
- Hangt dit samen met `whatsapp-groepen`, of staat het daar los van?

## Grofweg hoe groot?

Middel tot groot — moet waarschijnlijk opgesplitst worden. Eerst herkenning per
persoon, daarna eventueel rollen en gescheiden context.
