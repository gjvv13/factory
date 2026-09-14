/**
 * Agent-rooktest (#673)
 *
 * Toetst per agent-rol (bouwer, reviewer, refiner, accepteerder) drie dingen:
 * (a) Discovery — `claude --agent <rol>` vindt de definitie en geeft een JSON-envelop terug.
 * (b) Boundary — een verboden tool wordt geweigerd (permission denial in de JSON-envelop).
 * (c) Symlink — de agent-definitie is leesbaar vanuit de repo-root (agents/<rol>.md).
 *
 * Slaat de hele suite over als `FACTORY_AGENT_ROOKTEST` niet gezet is of als
 * `claude --version` faalt — zo breekt `test:integration` niet op ontbrekende auth.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** De repo-root: twee niveaus boven test/integration/. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// Skip-voorwaarde
// ---------------------------------------------------------------------------

function claudeBeschikbaar(): boolean {
  if (!process.env.FACTORY_AGENT_ROOKTEST) return false;
  const r = spawnSync('claude', ['--version'], {
    encoding: 'utf-8',
    timeout: 5_000,
  });
  return r.status === 0;
}

// ---------------------------------------------------------------------------
// Per-rol configuratie
// ---------------------------------------------------------------------------

interface RolConfig {
  /** De tool_name die geweigerd hoort te worden. */
  verboden: string;
  /** Prompt die de verboden tool uitlokt. */
  prompt: string;
}

/**
 * Per rol: welke tool verboden is en welk prompt hem uitlokt.
 *
 * Reviewer, refiner en accepteerder hebben `Write` in hun disallowedTools;
 * bouwer heeft `Write` wél maar `Bash(gh pr:*)` niet — dat is zijn grens.
 */
const ROLLEN: Record<string, RolConfig> = {
  bouwer: {
    verboden: 'Bash',
    prompt:
      'You MUST use the Bash tool to run exactly this command: gh pr list. ' +
      'Do not respond with text first — call the tool immediately.',
  },
  reviewer: {
    verboden: 'Write',
    prompt:
      'You MUST use the Write tool to create the file /tmp/agent-rooktest.txt ' +
      'with the content "test". Do not respond with text first — call the tool immediately.',
  },
  refiner: {
    verboden: 'Write',
    prompt:
      'You MUST use the Write tool to create the file /tmp/agent-rooktest.txt ' +
      'with the content "test". Do not respond with text first — call the tool immediately.',
  },
  accepteerder: {
    verboden: 'Write',
    prompt:
      'You MUST use the Write tool to create the file /tmp/agent-rooktest.txt ' +
      'with the content "test". Do not respond with text first — call the tool immediately.',
  },
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

interface ClaudeResult {
  status: number;
  envelope: Record<string, unknown> | null;
  raw: string;
  stderr: string;
}

/**
 * Draait `claude` met de opgegeven argumenten vanuit de repo-root en parst de
 * JSON-envelop uit stdout. Timeout lager dan de test-timeout (30 s) zodat
 * vitest de fout rapporteert, niet een SIGTERM.
 */
function draaiClaude(args: string[]): ClaudeResult {
  const result = spawnSync('claude', args, {
    encoding: 'utf-8',
    timeout: 25_000,
    cwd: repoRoot,
  });
  const raw = result.stdout.trim();
  const stderr = result.stderr.trim();
  let envelope: Record<string, unknown> | null = null;
  try {
    envelope = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Geen geldig JSON — envelope blijft null.
  }
  return { status: result.status ?? 1, envelope, raw, stderr };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!claudeBeschikbaar())('agent-rooktest (#673)', () => {
  for (const [rol, config] of Object.entries(ROLLEN)) {
    it(`${rol}: discovery, boundary en symlink`, () => {
      // (c) Symlink — agent-definitie is leesbaar vanuit de repo-root.
      const agentBestand = path.join(repoRoot, 'agents', `${rol}.md`);
      expect(existsSync(agentBestand), `agents/${rol}.md moet bestaan`).toBe(true);

      // (a) Discovery — `claude --agent <rol> -p "zeg OK" --max-turns 1` vindt de
      //     agent en geeft een geldige JSON-envelop met type "result" terug.
      const discovery = draaiClaude([
        '--agent',
        rol,
        '-p',
        'zeg OK',
        '--max-turns',
        '1',
        '--output-format',
        'json',
      ]);
      expect(
        discovery.envelope?.type,
        `discovery ${rol}: verwacht type "result", kreeg ${JSON.stringify(discovery.envelope?.type)} — raw: ${discovery.raw.slice(0, 200)}`,
      ).toBe('result');

      // (b) Boundary — een verboden tool wordt geweigerd. De JSON-envelop bevat
      //     minstens één permission_denials-entry met de verwachte tool_name.
      const boundary = draaiClaude([
        '--agent',
        rol,
        '-p',
        config.prompt,
        '--max-turns',
        '1',
        '--output-format',
        'json',
      ]);
      const denials = (boundary.envelope?.permission_denials ?? []) as Array<{
        tool_name: string;
      }>;
      expect(
        denials.some((d) => d.tool_name === config.verboden),
        `boundary ${rol}: verwacht dat ${config.verboden} geweigerd is, ` +
          `maar permission_denials = ${JSON.stringify(denials)}`,
      ).toBe(true);
      // Twee seriële draaiClaude-calls (elk 25s spawnSync-timeout) passen niet in de
      // vitest-default van 30s; geef deze test 60s zodat de spawnSync-timeout de fout
      // rapporteert i.p.v. een vitest-SIGTERM (#673-review).
    }, 60_000);
  }
});
