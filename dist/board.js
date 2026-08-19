import { run, uitvoerVan, waarschuwing } from './shell.js';
/**
 * De backlog staat als GitHub Issues in één repo, met het board als bron van waarheid
 * voor de fase (#131). Dit is de enige plek die dat board aanraakt.
 *
 * Alles loopt via `gh api graphql` en niet via `gh project item-list`/`field-list`.
 * Dat is geen stijlkeuze maar een kostenkeuze: GitHub geeft 5000 GraphQL-punten per
 * uur, gedeeld over álles wat er op het account draait. Gemeten op 2026-08-19:
 * een `item-list` van 83 items kost 102 punten en een `field-list` ook, terwijl de
 * gerichte opzoeking hieronder — item-id, veld-id, optie-ids én de huidige kolom in
 * één document — er 1 kost. Een uitrol mag de rest van de dag niet opeten.
 */
const EIGENAAR = 'gjvv13';
const BACKLOG_REPO = 'factory';
const PROJECT_NUMMER = 2;
/** De kolommen van het board, in pijplijnvolgorde. Zie WORKFLOW.md. */
export const KOLOMMEN = [
    'Idee',
    'Functioneel uitwerken',
    'Klaar voor technische refinement',
    'Technisch refinen',
    'Klaar voor Bouwen',
    'Bouwen',
    'Uitrollen',
    'Done',
];
/**
 * Het issuenummer waar een branch bij hoort, of undefined als het er geen is.
 * Alleen de slice-vorm telt: `fix/…`, `docs/…` en `chore/factory-…` horen niet bij
 * een backlog-item, en die stil overslaan is het gewenste gedrag — niet een fout.
 */
export function issueUitBranch(branch) {
    const match = /^slice\/(\d+)-\d+$/.exec(branch);
    if (match?.[1] === undefined) {
        return undefined;
    }
    const nummer = Number.parseInt(match[1], 10);
    return Number.isSafeInteger(nummer) && nummer > 0 ? nummer : undefined;
}
const OPZOEK_QUERY = `query($eigenaar:String!,$repo:String!,$project:Int!,$nummer:Int!){
  user(login:$eigenaar){ projectV2(number:$project){ id
    field(name:"Status"){ ... on ProjectV2SingleSelectField { id options { id name } } } } }
  repository(owner:$eigenaar,name:$repo){ issue(number:$nummer){
    projectItems(first:10){ nodes { id project { number }
      fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } }
}`;
/** Zoekt in één aanroep alles op wat nodig is om de kolom te kunnen zetten. */
function zoekDoelwit(issue, kolom, cwd) {
    const ruw = uitvoerVan('gh', [
        'api',
        'graphql',
        '-f',
        `query=${OPZOEK_QUERY}`,
        '-f',
        `eigenaar=${EIGENAAR}`,
        '-f',
        `repo=${BACKLOG_REPO}`,
        '-F',
        `project=${String(PROJECT_NUMMER)}`,
        '-F',
        `nummer=${String(issue)}`,
    ], cwd);
    if (ruw === undefined || ruw === '') {
        return undefined;
    }
    let antwoord;
    try {
        antwoord = JSON.parse(ruw);
    }
    catch {
        return undefined;
    }
    const project = antwoord.data?.user?.projectV2;
    const projectId = project?.id;
    const veldId = project?.field?.id;
    const optieId = project?.field?.options?.find((optie) => optie.name === kolom)?.id;
    const knoop = antwoord.data?.repository?.issue?.projectItems?.nodes?.find((node) => node.project?.number === PROJECT_NUMMER);
    const itemId = knoop?.id;
    if (projectId === undefined ||
        veldId === undefined ||
        optieId === undefined ||
        itemId === undefined) {
        return undefined;
    }
    const huidig = knoop?.fieldValueByName?.name;
    return { itemId, projectId, veldId, optieId, ...(huidig === undefined ? {} : { huidig }) };
}
/**
 * Zet een issue in een kolom. Levert true als er iets veranderd is.
 *
 * Faalt nooit hard: de pijplijn levert software af, en de administratie mag dat niet
 * tegenhouden. Een leeg board, een rate-limit of een ontbrekend item geeft een
 * waarschuwing en gaat door — anders valt een uitrol om op boekhouding.
 */
export function zetKolom(issue, kolom, cwd) {
    const doelwit = zoekDoelwit(issue, kolom, cwd);
    if (doelwit === undefined) {
        waarschuwing(`kon #${String(issue)} niet op het board vinden — kolom niet gezet.`);
        return false;
    }
    if (doelwit.huidig === kolom) {
        return false;
    }
    const uitkomst = run('gh', [
        'project',
        'item-edit',
        '--id',
        doelwit.itemId,
        '--project-id',
        doelwit.projectId,
        '--field-id',
        doelwit.veldId,
        '--single-select-option-id',
        doelwit.optieId,
    ], { ...(cwd === undefined ? {} : { cwd }), capture: true, toleranter: true });
    if (uitkomst.code !== 0) {
        waarschuwing(`kon #${String(issue)} niet naar '${kolom}' verplaatsen op het board.`);
        return false;
    }
    return true;
}
/**
 * Plaatst één comment op een backlog-issue. Ook dit mag de pijplijn niet ophouden,
 * dus een fout is een waarschuwing.
 */
export function plaatsComment(issue, tekst, cwd) {
    const uitkomst = run('gh', ['issue', 'comment', String(issue), '--repo', `${EIGENAAR}/${BACKLOG_REPO}`, '--body', tekst], { ...(cwd === undefined ? {} : { cwd }), capture: true, toleranter: true });
    if (uitkomst.code !== 0) {
        waarschuwing(`kon geen comment op #${String(issue)} plaatsen.`);
    }
}
//# sourceMappingURL=board.js.map