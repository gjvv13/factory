# Factory als registry-devDependency i.p.v. git-dep

## Context

Elke applicatie droeg de factory als **pnpm-git-dependency**
(`"@gjvv13/factory": "git+https://github.com/gjvv13/factory.git#v<tag>"`) en hield die
met `bump-factory.yml` bij. Sinds `dist/` uit git ging (#558, gebouwd via een
`prepare`-script) bleek dat een bron van storingen: pnpm's **build-poort** blokkeert de
git-dep-`prepare` (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`), en de naam-gebaseerde
workarounds daarvoor werken bewezen niet in pnpm 11.18 (`onlyBuiltDependencies`/
`allowBuilds` op naam falen; alleen een exacte commit-sha-URL of
`dangerouslyAllowAllBuilds` werken — het eerste is onhoudbaar, het tweede een
security-regressie). #665 hield die worst-analyse vast.

De canary (#707) toonde bovendien aan dat het uitwijkpad óók dood is: een schone
`npm install git+…` van deze **pnpm-workspace** crasht in npm's arborist
(`Cannot read properties of null (reading 'edgesOut')`), ongeacht `prepare`, gecommitte
`dist` of `pnpm-workspace.yaml`. Beide native git-install-paden (pnpm én npm) zijn dus
onbruikbaar. Factory is nochtans **puur gereedschap**: een devDependency zonder enkele
runtime-import, die nooit naar prod gaat.

## Beslissing

De factory wordt bij elke release **gepubliceerd naar de publieke npm-registry**
(`@gjvv13/factory` op npmjs.org, `npm publish --access public`, #714), en elke app
consumeert haar als gewone **registry-devDependency**: `"@gjvv13/factory": "^<versie>"`.

Een registry-tarball draagt de gebouwde `dist` via het `files`-veld en draait bij de
consument **geen `prepare`** → geen pnpm-build-poort (#665) en geen arborist-crash. De
dep blíjft in `package.json` (helemaal weghalen breekt de gedeelde presets
`@gjvv13/factory/prettier|eslint|tsconfig.base.json|vitest-*`, die via node-resolutie
geïmporteerd worden), en `pnpm exec factory` blijft werken omdat de bin in
`node_modules/.bin` staat. Per app vervalt de `onlyBuiltDependencies`-workaround en komt
`minimumReleaseAge: 0` in `pnpm-workspace.yaml` (anders muteert pnpm 11.18 dat bestand bij
install → vuile tree → `factory release`/`promote` breken op de git-clean-check). De
overige build-curatie (`better-sqlite3`, `esbuild`, `@matrix-org/*`, `@scarf/scarf: false`)
blijft ongemoeid.

`bump-factory.yml` blijft bestaan maar werd **model-bewust** (#708): een git-dep bumpt naar
de nieuwste git-tag, een registry-dep naar de nieuwste `npm view`-versie — dependabot
alléén volstaat niet, want dat draait geen `factory sync` (workflows/skills/hooks moeten
bij elke release mee). Installeren vergt **nul auth** (publiek pakket); publiceren vergt
één `NPM_TOKEN` op één plek (de release-workflow). Een consumer-rooktest (#711) borgt het
consume-pad: pakt de factory en draait de gebundelde bin, zodat een kapotte `bin` of
ontbrekende `dist` de poort — en dus de release — rood maakt.

## Alternatieven

- **Globale factory-CLI in de apps** (`npm i -g`, factory-dep helemaal weg): de canary
  bewees dat de gedeelde presets dan niet meer resolven en de app-configs breken. Bovendien
  crasht de globale git-install net zo hard in arborist. Verworpen.
- **`dist` committen** (git-dep behouden, `prepare` weg): empirisch dood — npm's
  git-dep-preparatie-install crasht sowieso, ongeacht `prepare`/`dist`. Verworpen.
- **GitHub Packages i.p.v. npmjs**: vraagt een install-token op élke consume-plek (CI,
  mini, dev), terwijl npmjs voor een publiek pakket nul install-auth vraagt. Verworpen.
- **`dangerouslyAllowAllBuilds` / exacte sha-URL in `allowBuilds`**: heft de
  supply-chain-bescherming op, respectievelijk verandert elke release. Verworpen (zie #665).

## Verwijzingen

- **Datum:** 2026-09-17
- **Issue:** #710 (verankering), epic #695; #665 (build-poort-analyse), #707 (canary),
  #708 (model-bewuste bump), #714 (publiceer-mechaniek), #711 (consumer-rooktest),
  #709 (uitrol alle apps), #696 (opruimen dode git-dep-machinerie).
- Vervangt de fix-aanpak van #665; voortkomend uit de #558-nasleep.
