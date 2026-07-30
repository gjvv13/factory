---
id: whatsapp-kanaal
titel: WhatsApp als kanaal
status: idee
aangemaakt: 2026-07-30
---

# WhatsApp als kanaal

## Wat wil ik?

De applicatie bedienen door een WhatsApp-bericht te sturen naar mijn eigen
nummer, in plaats van via curl of de terminal.

## Waarom?

WhatsApp is de interface die ik altijd bij me heb. Zolang ik commando's alleen
via HTTP kan sturen, gebruik ik de Factory niet echt. Een eigen interface kan
later, maar dan als extra kanaal — niet als vervanging.

## Hoe zie ik het voor me?

```
ik:      ping
factory: pong

ik:      hallo
factory: Hallo <mijn naam>!
```

## Wat weet ik nog niet?

- Hoe de koppeling met `whatsapp-web.js` precies verloopt: één keer een QR-code
  scannen, en dan? Wat gebeurt er als de sessie verloopt of de Mac herstart?
- Waar bewaren we de sessie zodat ik niet elke keer opnieuw hoef te scannen,
  en hoe houden we die buiten git?
- Alleen prod praat met WhatsApp (één nummer per sessie). Hoe test ik het
  kanaal dan op dev en acc? Vermoedelijk met een fake-adapter plus e2e-tests
  op de laag eronder.
- Wie mag commando's sturen? Reageren op onbekende nummers wil ik niet.
- Chromium/puppeteer komt als afhankelijkheid mee. Hoe zwaar is dat, en start
  het betrouwbaar onder pm2?

## Grofweg hoe groot?

Middel tot groot — moet opgesplitst worden. Vermoedelijk: eerst koppelen en
ontvangen, dan afzenderfilter, dan robuust herverbinden.

## Randvoorwaarden

- Achter feature flag `whatsapp-channel` (staat al in de fixtures, uit).
- `whatsapp-web.js` is onofficieel: er is een klein risico dat mijn nummer
  geblokkeerd wordt. Bewust geaccepteerd. De adapter-opzet moet overstappen
  naar de officiële Cloud API klein houden.
