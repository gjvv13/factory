import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { zoekAppDir } from '../app-config.js';
import { claudeCommandsDir, hooksDir, skillsDir, workflowsDir } from '../paths.js';
import { GebruikersFout, git, kop, ok, waarschuwing } from '../shell.js';

function kopieerAlsAnders(bron: string, doel: string): boolean {
  if (existsSync(doel) && readFileSync(bron, 'utf8') === readFileSync(doel, 'utf8')) {
    return false;
  }
  mkdirSync(path.dirname(doel), { recursive: true });
  copyFileSync(bron, doel);
  return true;
}

/**
 * Kopieert een hele boom (een skill kan naast SKILL.md ook referenties of
 * scripts bevatten) en geeft de bijgewerkte paden terug, relatief aan doelBasis.
 */
function kopieerBoom(bronDir: string, doelDir: string, doelBasis: string): string[] {
  const bijgewerkt: string[] = [];
  for (const item of readdirSync(bronDir, { withFileTypes: true })) {
    const bron = path.join(bronDir, item.name);
    const doel = path.join(doelDir, item.name);
    if (item.isDirectory()) {
      bijgewerkt.push(...kopieerBoom(bron, doel, doelBasis));
    } else if (kopieerAlsAnders(bron, doel)) {
      bijgewerkt.push(path.relative(doelBasis, doel));
    }
  }
  return bijgewerkt;
}

/**
 * Zet de bestanden die de factory aanlevert maar die in de app-repo moeten
 * staan gelijk aan de versie uit het pakket: de slash commands, de skills, de
 * git hook en de CI-workflow. Deze kunnen niet uit node_modules komen omdat
 * Claude Code, git en GitHub Actions ze op een vaste plek in de repo verwachten.
 */
export function syncNaarApp(appDir: string): string[] {
  const bijgewerkt: string[] = [];

  for (const bestand of readdirSync(claudeCommandsDir)) {
    const doel = path.join(appDir, '.claude', 'commands', bestand);
    if (kopieerAlsAnders(path.join(claudeCommandsDir, bestand), doel)) {
      bijgewerkt.push(path.join('.claude', 'commands', bestand));
    }
  }

  for (const skill of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!skill.isDirectory()) continue;
    const doelDir = path.join(appDir, '.claude', 'skills', skill.name);
    bijgewerkt.push(...kopieerBoom(path.join(skillsDir, skill.name), doelDir, appDir));
  }

  for (const bestand of readdirSync(workflowsDir)) {
    const doel = path.join(appDir, '.github', 'workflows', bestand);
    if (kopieerAlsAnders(path.join(workflowsDir, bestand), doel)) {
      bijgewerkt.push(path.join('.github', 'workflows', bestand));
    }
  }

  const hookDoel = path.join(appDir, '.githooks', 'pre-commit');
  if (kopieerAlsAnders(path.join(hooksDir, 'pre-commit'), hookDoel)) {
    bijgewerkt.push(path.join('.githooks', 'pre-commit'));
  }
  chmodSync(hookDoel, 0o755);
  git(['config', 'core.hooksPath', '.githooks'], appDir);

  return bijgewerkt;
}

export function sync(): void {
  const appDir = zoekAppDir();
  if (appDir === undefined) {
    throw new GebruikersFout('factory sync hoort in een applicatiemap te draaien.');
  }

  kop('Slash commands, skills, git hook en CI-workflow gelijkzetten');
  const bijgewerkt = syncNaarApp(appDir);

  if (bijgewerkt.length === 0) {
    waarschuwing('Niets te doen: alles staat al gelijk aan de factory.');
    return;
  }
  for (const bestand of bijgewerkt) {
    process.stdout.write(`  bijgewerkt: ${bestand}\n`);
  }
  ok(`${String(bijgewerkt.length)} bestand(en) bijgewerkt`);
}
