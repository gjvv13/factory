---
id: console-escaping
titel: Console-pagina escapet remote waarden niet (XSS)
status: idee
aangemaakt: 2026-08-01
---

# Console-pagina escapet remote waarden niet (XSS)

## Wat wil ik?

De beheer-console mag geen HTML uit een gemonitorde applicatie ongeëscaped in
de pagina zetten. `version`, `channel` en `connection.state` worden nu via
`tekst()` in `innerHTML` gezet, en `tekst()` escapet niet.

## Waarom?

`app/src/http/console-page.ts` (regels 91, 100, 101) rendert waarden die
één-op-één uit de `/health`-respons van een andere applicatie komen. In
`admin-client.ts` worden die alleen als `z.string().min(1)` gevalideerd, dus
willekeurige HTML is toegestaan. Een app die als versie `<img src=x
onerror=...>` teruggeeft, voert script uit in het console. Er staat naast
`tekst()` al een `esc()`-functie die wél escapet — die wordt alleen op de
data-attributen en flag-velden toegepast.

Extra pijnlijk: de docstring bovenaan het bestand claimt "Bewust statisch (geen
template-waarden), zodat er niets te injecteren valt." Dat klopt niet en moet
weg — een geruststelling die niet waar is, is erger dan geen.

## Hoe zie ik het voor me?

- Alle remote-gecontroleerde velden (`version`, `channel`, `state`, en alles wat
  uit een andere app komt) door `esc()` in plaats van `tekst()`.
- De misleidende comment verwijderen of corrigeren.
- Een rendertest die `esc()`/`tekst()` afdekt met een payload als
  `<img src=x onerror=...>` en controleert dat er geëscapete tekst uitkomt. Dit
  bestand (183 regels) heeft nu geen enkele test op de render-logica.

## Wat weet ik nog niet?

- Willen we de HTML-string-concatenatie in `rij()`/`flagRij()` op termijn
  vervangen door iets dat standaard escapet, zodat dit gat niet terug kan komen?
- Loopback-only beperkt de blootstelling nu; verandert dat als het console ooit
  breder bereikbaar wordt? Dan wordt dit urgenter.

## Grofweg hoe groot?

Klein (uurtje). De fix is een paar regels; de test erbij maakt het middel-klein.
