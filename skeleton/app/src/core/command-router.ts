import type { ContactRepository } from './contacts.js';
import type { FlagService } from '../flags/flag-service.js';
import type { InboundMessage } from './message.js';

export interface CommandContext {
  readonly message: InboundMessage;
  /** Alles achter het commandowoord, getrimd. Leeg als er geen argumenten zijn. */
  readonly argument: string;
  readonly contacts: ContactRepository;
  readonly flags: FlagService;
  readonly version: string;
  readonly environment: string;
}

export interface Command {
  readonly name: string;
  readonly description: string;
  /**
   * Optionele feature flag. Staat de flag uit, dan bestaat het commando
   * voor de gebruiker simpelweg niet.
   */
  readonly flagKey?: string;
  handle(context: CommandContext): string;
}

export interface CommandRouter {
  route(message: InboundMessage): string;
  available(): Command[];
}

export const UNKNOWN_COMMAND_REPLY =
  "Dat commando ken ik niet. Stuur 'help' voor de mogelijkheden.";

function splitCommand(text: string): { name: string; argument: string } {
  const trimmed = text.trim();
  const separator = trimmed.search(/\s/);
  if (separator === -1) {
    return { name: trimmed.toLowerCase(), argument: '' };
  }
  return {
    name: trimmed.slice(0, separator).toLowerCase(),
    argument: trimmed.slice(separator + 1).trim(),
  };
}

export function createCommandRouter(
  commands: readonly Command[],
  dependencies: Omit<CommandContext, 'message' | 'argument'>,
): CommandRouter {
  const byName = new Map(commands.map((command) => [command.name, command]));

  function isAvailable(command: Command): boolean {
    return command.flagKey === undefined || dependencies.flags.isEnabled(command.flagKey);
  }

  return {
    available: () => commands.filter(isAvailable),
    route: (message) => {
      const { name, argument } = splitCommand(message.text);
      const command = byName.get(name);
      if (command === undefined || !isAvailable(command)) {
        return UNKNOWN_COMMAND_REPLY;
      }
      return command.handle({ ...dependencies, message, argument });
    },
  };
}
