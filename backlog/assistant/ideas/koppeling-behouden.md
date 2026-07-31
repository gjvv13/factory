---
id: koppeling-behouden
titel: Voorkomen dat de WhatsApp-koppeling verloopt
status: idee
aangemaakt: 2026-07-30
---

# Voorkomen dat de WhatsApp-koppeling verloopt

## Wat wil ik?

Niet steeds opnieuw de QR hoeven scannen. De WhatsApp-koppeling moet blijven
werken, of me op tijd waarschuwen als hij dreigt te verlopen.

## Waarom?

`whatsapp-web.js` koppelt als gekoppeld apparaat aan het assistent-account. Komt
het assistent-toestel (de eSIM) te lang niet online, dan logt WhatsApp het
gekoppelde apparaat uit en is opnieuw scannen nodig. Slice 2 vangt korte
verbroken verbindingen op met herverbinden en een heartbeat, maar een verlopen
koppeling kan geen enkele reconnect herstellen — dat vraagt een mens met een
telefoon. Als dat op een slecht moment gebeurt, is de assistent stil zonder dat
ik het weet.

## Hoe zie ik het voor me?

```
(prod herkent dat de koppeling is verlopen)
factory: [melding] De WhatsApp-koppeling is verlopen — scan opnieuw om weer
         berichten te ontvangen.
```

Liever nog een waarschuwing vóór het zover is dan pas erna.

## Wat weet ik nog niet?

- **Wat kan de app echt sturen?** Verbonden blijven houdt het gekoppelde apparaat
  actief, maar de primaire registratie ligt bij het toestel. Hoe lang mag het
  toestel offline zijn voordat WhatsApp uitlogt, en valt daar iets aan te doen
  vanuit de app, of is het puur "houd het toestel af en toe online"?
- **Tijdig waarschuwen:** hoe merk ik dat de koppeling verlopen is of bijna is —
  aan de `needs-qr`/`disconnected`-status? En via welk kanaal krijg ik dan een
  melding: mail, een pushbericht, of prominent in het [[health-overzicht]] van de
  beheer-tool?
- **Structurele oplossing:** de officiële WhatsApp Cloud API kent geen gekoppeld
  apparaat en dus geen QR die verloopt. De adapter-opzet is er klaar voor (zie de
  refinement van [[whatsapp-kanaal]]). Is dit het moment om die overstap serieus
  te wegen, of eerst leunen op waarschuwen?
- **Herstel vergemakkelijken:** als opnieuw scannen tóch nodig is, kan dat dan zo
  soepel mogelijk (een verse QR op een vaste plek, bijvoorbeeld via de
  beheer-tool) in plaats van in de logs graven?

## Grofweg hoe groot?

Onbekend tot middel: waarschuwen is klein, maar de echte vraag (hoe voorkom je het
verlopen, of stap je over naar de Cloud API) kan groot uitpakken. Eerst uitzoeken
wat er speelt hoort bij de refinement.
