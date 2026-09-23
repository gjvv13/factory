import {
  issueBestaat,
  labelsVan,
  ouderVan,
  zetKolomUitkomst,
  zetLabel,
  type Kolom,
} from '../board.js';
import { GebruikersFout, kop, ok, waarschuwing } from '../shell.js';

/**
 * De drie labels die een bug de autonome baan op zetten: `type:bug` maakt hem
 * bouwbaar en fastlane-waardig, `fastlane` en `auto-merge-ok` geven de nacht-bouw
 * toestemming vooraf om zonder mens te landen (#767, besluit 1/2; #573).
 */
export const TRIAGE_LABELS = ['type:bug', 'fastlane', 'auto-merge-ok'] as const;

/**
 * De wachtrijkolom waar triage het item op zet. Een getriageerde bug wordt eerst
 * bug-exempt gerefined (#782); `rondAf` promoveert 'm daarna vanzelf naar Klaar voor
 * Bouwen, waar de nacht-fastlane 'm oppakt (#784). Vandaar de refine-wachtrij, en
 * niet direct Klaar voor Bouwen (#767, besluit 3a).
 */
export const TRIAGE_DOELKOLOM: Kolom = 'Klaar voor technische refinement';

/**
 * De pure kern: welke labels ontbreken er nog. Los unit-getest; de schil doet de
 * `gh`-I/O. De kolom laat de schil aan `zetKolomUitkomst` over — die leest het board
 * en meldt zelf al-goed/verzet, dus een tweede board-lezing hier zou punten kosten.
 */
export function triagePlan(huidigeLabels: readonly string[]): { teZetten: string[] } {
  return { teZetten: TRIAGE_LABELS.filter((label) => !huidigeLabels.includes(label)) };
}

/**
 * `factory triage <issue>` — de mens-poort van de autonome baan (#783). Zet in één
 * gebaar de drie labels én de wachtrijkolom, atomisch-naar-buiten (naverifieerd) en
 * idempotent. Markeert alleen; bouwen/reviewen/mergen blijft bij de nacht-fastlane en
 * de auto-merge-gate (#573).
 */
export function triage(issueArgument: string | undefined): void {
  const issue = vereisIssue(issueArgument);
  const cwd = process.cwd();
  kop(`#${String(issue)} triëren voor de autonome baan`);

  // Bestaan checken vóór het zetten: `zetLabel` faalt zacht, dus een typefout in het
  // nummer zou anders stil niets doen (geen groen vinkje op een misstand).
  if (!issueBestaat(issue, cwd)) {
    throw new GebruikersFout(
      `#${String(issue)} bestaat niet of is niet leesbaar — er is niets getrieerd.`,
    );
  }

  // Een child-slice hoort niet op de autonome baan (#767): `fastlaneWachtrij` weigert
  // items met een ouder. Triage zet de labels/kolom toch, maar meldt het gat.
  if (ouderVan(issue, cwd) !== undefined) {
    waarschuwing(
      `#${String(issue)} hangt onder een epic — de nacht-fastlane slaat child-slices over. ` +
        `De labels en kolom zijn wél gezet.`,
    );
  }

  const huidige = labelsVan(issue, cwd);
  const { teZetten } = triagePlan(huidige);
  for (const label of teZetten) {
    zetLabel(issue, label, cwd);
  }
  for (const label of TRIAGE_LABELS) {
    ok(teZetten.includes(label) ? `label '${label}' gezet.` : `label '${label}' stond al goed.`);
  }

  // Naverifiëren: lees de labels terug en faal hard als er één ontbreekt. Zo is de
  // uitkomst binair — alle drie, of een fout — ondanks de zachte `zetLabel`.
  const na = labelsVan(issue, cwd);
  const ontbreekt = TRIAGE_LABELS.filter((label) => !na.includes(label));
  if (ontbreekt.length > 0) {
    throw new GebruikersFout(
      `#${String(issue)} mist na triage het label ${ontbreekt.join(', ')}. ` +
        `Bestaat het label op de repo? Maak het aan met 'gh label create'.`,
    );
  }

  const beweging = zetKolomUitkomst(issue, TRIAGE_DOELKOLOM, cwd);
  if (beweging === 'mislukt') {
    throw new GebruikersFout(
      `#${String(issue)} kon niet op '${TRIAGE_DOELKOLOM}' gezet worden — zie de melding hierboven.`,
    );
  }
  ok(
    beweging === 'verzet'
      ? `#${String(issue)} staat nu op '${TRIAGE_DOELKOLOM}'.`
      : `#${String(issue)} stond al op '${TRIAGE_DOELKOLOM}'.`,
  );
  ok(`#${String(issue)} is getrieerd — hands-off vanaf hier.`);
}

/** Valideert het issue-argument. Spiegelt `vereisIssue` in `prioriteit.ts`. */
function vereisIssue(waarde: string | undefined): number {
  const issue = Number.parseInt(waarde ?? '', 10);
  if (!Number.isSafeInteger(issue) || issue <= 0) {
    throw new GebruikersFout('Gebruik: factory triage <issuenummer>');
  }
  return issue;
}
