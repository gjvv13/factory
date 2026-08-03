import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { e2eCoverageEnv, schrijfE2eDekking } from 'factory/e2e-coverage';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    baseUrl: string;
    databaseFile: string;
  }
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Kon geen vrije poort bepalen'));
        return;
      }
      const { port } = address;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitForHealth(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = 'onbekend';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Applicatie stopte tijdens opstarten (exit ${String(child.exitCode)})`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
      lastError = `status ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Applicatie werd niet gezond binnen 30s: ${lastError}`);
}

/**
 * Wacht tot het serverproces echt gestopt is, zodat Node de v8-coverage heeft
 * weggeschreven voordat we die inlezen. Met een ruime bovengrens: een hangende
 * server mag de teardown niet blokkeren.
 */
async function wachtOpExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 10_000);
    timer.unref();
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Start één echte applicatie-instantie op een vrije poort met een lege database.
 * De e2e-tests praten er via HTTP mee, precies zoals een kanaal dat zou doen.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const rootDir = process.cwd();
  const workDir = path.join(rootDir, '.tmp', 'e2e');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const databaseFile = path.join(workDir, 'e2e.sqlite');
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${String(port)}`;

  const child = spawn(process.execPath, ['--import', 'tsx', 'app/src/main.ts'], {
    cwd: rootDir,
    env: {
      ...process.env,
      // Bij een coverage-poort meet Node de server-executie via NODE_V8_COVERAGE;
      // na afsluiten zet de teardown die om naar coverage/e2e/. Ná process.env zodat
      // onze meetmap wint van een eventueel geërfde waarde.
      ...e2eCoverageEnv(rootDir),
      FACTORY_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_FILE: databaseFile,
      CHANNEL: 'http',
      LOG_LEVEL: 'silent',
      // Geen flag-cache: een flag die je omzet werkt direct, zodat tests
      // niet op een TTL hoeven te wachten.
      FLAG_CACHE_TTL_MS: '0',
      ROOT_DIR: rootDir,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  await waitForHealth(baseUrl, child);

  project.provide('baseUrl', baseUrl);
  project.provide('databaseFile', databaseFile);

  return async () => {
    child.kill('SIGTERM');
    await wachtOpExit(child);
    await schrijfE2eDekking(rootDir);
  };
}
