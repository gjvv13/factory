/**
 * Een eigen werkmap per slice, zodat twee sessies elkaar niet in de weg zitten (#118).
 *
 * De botsing tussen parallelle sessies zit niet in branches maar in de gedeelde
 * werkmap: één `.git`, één HEAD, één `git status`. Een worktree geeft elke sessie zijn
 * eigen map achter dezelfde `.git`, en dan verdwijnt de hele "werkt er al iemand
 * hier?"-vraag. Op 2026-08-19 ging dat twee keer mis in één dag — een wijziging die
 * werd teruggedraaid, en andermans werk dat in een vreemde staging opdook.
 */
/** Waar de worktree voor een issue komt te staan: náást de repo, nooit erin. */
export declare function werkplekPad(repoWortel: string, issue: number): string;
/**
 * De hoofdwerkmap van de repo, ook als je al ín een worktree staat.
 *
 * Zonder dit stapelt het zich op: draai je `werkplek` vanuit `factory-wt/128`, dan
 * wordt de nieuwe map `factory-wt/128-wt/999`. `--git-common-dir` wijst altijd naar de
 * `.git` van de hoofdkloon, in een worktree én daarbuiten.
 */
export declare function repoWortelVan(cwd: string): string;
/** De branch die bij een issue hoort; `-1` blijft staan zodat #128 de koppeling herkent. */
export declare function branchVan(issue: number): string;
export interface WerkplekOpties {
    /** Ruimt de werkplek op in plaats van hem te maken. */
    readonly op?: boolean;
}
/**
 * Maakt (of hervindt) de werkplek voor een issue en print het pad. Idempotent: een
 * hervatte sessie krijgt dezelfde map terug in plaats van een fout.
 */
export declare function werkplek(issueArgument: string | undefined, opties?: WerkplekOpties): void;
