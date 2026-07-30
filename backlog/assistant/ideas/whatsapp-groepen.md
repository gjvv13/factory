---
id: whatsapp-groepen
titel: WhatsApp-groepen met eigen conversaties
status: idee
aangemaakt: 2026-07-30
---

# WhatsApp-groepen met eigen conversaties

## Wat wil ik?

Verschillende WhatsApp-groepen kunnen gebruiken waarin ik verschillende
conversaties voer, elk met hun eigen vervolgacties — zodat een groep een vaste
context bepaalt in plaats van dat elk bericht op zichzelf staat.

## Waarom?

Eén-op-één en losse commando's zijn genoeg om te beginnen, maar het echte gemak
zit in groepen: een groep "boodschappen", een groep "klussen", een groep voor de
administratie. De groep zegt al waar het over gaat, dus de applicatie hoeft dat
niet elke keer opnieuw te vragen en kan er de juiste actie aan koppelen.

## Hoe zie ik het voor me?

```
[groep: Boodschappen]
ik:      melk en brood
factory: Toegevoegd aan de boodschappenlijst.

[groep: Klussen]
ik:      lekkende kraan
factory: Genoteerd als klus.
```

Hetzelfde bericht ("melk en brood") leidt tot een andere actie afhankelijk van
in welke groep het valt.

## Wat weet ik nog niet?

- Bouwt voort op `whatsapp-kanaal` (nu alleen één-op-één; groepen staan daar
  expliciet buiten scope). Dit is waarschijnlijk het grootste vervolgstuk.
- Hoe koppelen we een groep aan een context of vervolgactie — configuratie per
  groep, of leert de applicatie het gaandeweg?
- Moeten we gespreksstatus binnen een groep onthouden (een lopend gesprek), of
  is elk bericht op zichzelf staand binnen de groepscontext?
- Hoe herkent `whatsapp-web.js` een groep versus een één-op-één-chat, en hoe past
  dat op het huidige afzender-/allowlist-model?
- Hangt sterk samen met `meer-gebruikers`: in een groep sturen meerdere mensen.
  Wie mag wat binnen een groep?
- Hoe testen we groepsgedrag zonder echte WhatsApp-groepen?

## Grofweg hoe groot?

Groot — moet opgesplitst worden. Vermoedelijk: eerst een groep herkennen en aan
een vaste context koppelen, daarna acties per groep, daarna eventueel
gespreksstatus binnen een groep.
