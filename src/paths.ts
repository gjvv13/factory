import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * De wortel van het factory-pakket zelf. Vanuit dist/ is dat één map hoger;
 * hiermee vinden we skeleton/, templates/ en claude-commands/ terug, ook als
 * het pakket in node_modules van een applicatie zit.
 */
export const factoryPakketDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const skeletonDir = path.join(factoryPakketDir, 'skeleton');
export const templatesDir = path.join(factoryPakketDir, 'templates');
export const claudeCommandsDir = path.join(factoryPakketDir, 'claude-commands');
export const hooksDir = path.join(factoryPakketDir, 'hooks');
export const workflowsDir = path.join(factoryPakketDir, 'workflows');
export const skillsDir = path.join(factoryPakketDir, 'skills');
