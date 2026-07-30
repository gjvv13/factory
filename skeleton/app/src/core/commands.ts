import type { Command, CommandRouter } from './command-router.js';

/** Ping zit achter een flag, zodat de flag-werking in elke omgeving aantoonbaar is. */
export const pingCommand: Command = {
  name: 'ping',
  description: 'Antwoordt met pong.',
  flagKey: 'ping',
  handle: () => 'pong',
};

export const versionCommand: Command = {
  name: 'versie',
  description: 'Laat versie en omgeving zien.',
  handle: (context) => `Factory ${context.version} (${context.environment})`,
};

/** Begroeting op basis van de contacts-tabel: leunt op ingelezen testdata. */
export const helloCommand: Command = {
  name: 'hallo',
  description: 'Begroet je bij naam als je bekend bent.',
  handle: (context) => {
    const contact = context.contacts.findByHandle(context.message.channel, context.message.from);
    return contact === undefined
      ? 'Hallo! Ik ken je nog niet. Voeg je toe als contact om bij naam begroet te worden.'
      : `Hallo ${contact.displayName}!`;
  },
};

export function createHelpCommand(getRouter: () => CommandRouter): Command {
  return {
    name: 'help',
    description: 'Laat de beschikbare commandos zien.',
    handle: () => {
      const lines = getRouter()
        .available()
        .map((command) => `- ${command.name}: ${command.description}`);
      return ['Ik kan dit:', ...lines].join('\n');
    },
  };
}
