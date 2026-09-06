import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const hooksDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'claude-hooks',
);

/** Draait een hook-script met gesimuleerde JSON-input en geeft stdout + exitcode terug. */
function draaiHook(
  script: string,
  toolInput: Record<string, unknown>,
): { stdout: string; stderr: string; code: number } {
  const input = JSON.stringify({ tool_input: toolInput });
  const result = spawnSync('bash', [path.join(hooksDir, script)], {
    input,
    encoding: 'utf-8',
    timeout: 5000,
    env: { ...process.env, PATH: process.env.PATH },
  });
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    code: result.status ?? 1,
  };
}

function verwachtBlok(result: { stdout: string; code: number }): void {
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('"decision":"block"');
}

function verwachtDoor(result: { stdout: string; code: number }): void {
  expect(result.code).toBe(0);
  expect(result.stdout).toBe('');
}

// ---------------------------------------------------------------------------
// gate-inleveren.sh
// ---------------------------------------------------------------------------
describe('gate-inleveren.sh', () => {
  const hook = 'gate-inleveren.sh';

  it('blokkeert factory inleveren zonder modus-vlag', () => {
    verwachtBlok(draaiHook(hook, { command: 'factory inleveren' }));
  });

  it('blokkeert factory inleveren met alleen --titel', () => {
    verwachtBlok(draaiHook(hook, { command: 'factory inleveren --titel="test"' }));
  });

  it('laat factory inleveren --fastlane door', () => {
    verwachtDoor(draaiHook(hook, { command: 'factory inleveren --fastlane' }));
  });

  it('laat factory inleveren --geen-automerge door', () => {
    verwachtDoor(draaiHook(hook, { command: 'factory inleveren --geen-automerge' }));
  });

  it('blokkeert gh pr merge', () => {
    verwachtBlok(
      draaiHook(hook, {
        command: 'gh pr merge https://github.com/gjvv13/factory/pull/1 --auto --merge',
      }),
    );
  });

  it('blokkeert git push origin main', () => {
    verwachtBlok(draaiHook(hook, { command: 'git push origin main' }));
  });

  it("laat andere commando's door", () => {
    verwachtDoor(draaiHook(hook, { command: 'git status' }));
    verwachtDoor(draaiHook(hook, { command: 'pnpm test' }));
    verwachtDoor(draaiHook(hook, { command: 'git push origin slice/123-1' }));
  });

  it('laat een lege input door', () => {
    verwachtDoor(draaiHook(hook, {}));
  });
});

// ---------------------------------------------------------------------------
// gate-refine.sh
// ---------------------------------------------------------------------------
describe('gate-refine.sh', () => {
  const hook = 'gate-refine.sh';

  it('blokkeert een body-file met technische secties zonder functionele secties', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
    const bodyBestand = path.join(tmp, 'body.md');
    writeFileSync(bodyBestand, '# Titel\n\n## Technische architectuur\n\nDit is technisch.\n');
    const result = draaiHook(hook, {
      command: `gh issue edit 123 --repo gjvv13/factory --body-file ${bodyBestand}`,
    });
    verwachtBlok(result);
  });

  it('laat een body-file met functionele architectuur door', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
    const bodyBestand = path.join(tmp, 'body.md');
    writeFileSync(
      bodyBestand,
      '# Titel\n\n## Functionele architectuur\n\nDit is functioneel.\n\n## Technische architectuur\n\nDit is technisch.\n',
    );
    const result = draaiHook(hook, {
      command: `gh issue edit 123 --repo gjvv13/factory --body-file ${bodyBestand}`,
    });
    verwachtDoor(result);
  });

  it('laat een body-file met functionele besluiten door', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
    const bodyBestand = path.join(tmp, 'body.md');
    writeFileSync(
      bodyBestand,
      '# Titel\n\n## Functionele besluiten\n\nBesluit.\n\n## Technische architectuur\n\nDit is technisch.\n',
    );
    const result = draaiHook(hook, {
      command: `gh issue edit 123 --repo gjvv13/factory --body-file ${bodyBestand}`,
    });
    verwachtDoor(result);
  });

  it('laat een body-file zonder technische secties door', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
    const bodyBestand = path.join(tmp, 'body.md');
    writeFileSync(bodyBestand, '# Titel\n\nAlleen een beschrijving.\n');
    const result = draaiHook(hook, {
      command: `gh issue edit 123 --repo gjvv13/factory --body-file ${bodyBestand}`,
    });
    verwachtDoor(result);
  });

  it("laat commando's zonder --body-file door", () => {
    verwachtDoor(draaiHook(hook, { command: 'gh issue edit 123 --title "Nieuwe titel"' }));
  });

  it("laat andere commando's door", () => {
    verwachtDoor(draaiHook(hook, { command: 'git status' }));
  });

  it('laat een lege input door', () => {
    verwachtDoor(draaiHook(hook, {}));
  });

  it('hanteert --body-file= (gelijkteken-syntax)', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
    const bodyBestand = path.join(tmp, 'body.md');
    writeFileSync(bodyBestand, '# Titel\n\n## Technische architectuur\n\nTechnisch.\n');
    const result = draaiHook(hook, {
      command: `gh issue edit 123 --repo gjvv13/factory --body-file=${bodyBestand}`,
    });
    verwachtBlok(result);
  });
});

// ---------------------------------------------------------------------------
// waarschuw-branch.sh
// ---------------------------------------------------------------------------
describe('waarschuw-branch.sh', () => {
  const hook = 'waarschuw-branch.sh';

  it('geeft geen uitvoer op een slice-branch', () => {
    const result = draaiHook(hook, { command: 'git commit -m "test"' });
    verwachtDoor(result);
    expect(result.stderr).toBe('');
  });

  it("laat niet-commit commando's door", () => {
    verwachtDoor(draaiHook(hook, { command: 'git status' }));
    verwachtDoor(draaiHook(hook, { command: 'git push' }));
  });

  it('triggert niet op git commit-tree of git commit-graph', () => {
    verwachtDoor(draaiHook(hook, { command: 'git commit-tree abc123' }));
    verwachtDoor(draaiHook(hook, { command: 'git commit-graph write' }));
  });

  it('blokkeert niet (altijd exit 0)', () => {
    const result = draaiHook(hook, { command: 'git commit -m "test"' });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });
});
