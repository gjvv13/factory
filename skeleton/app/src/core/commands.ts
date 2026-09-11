import type { Command, CommandRouter } from './command-router.js';

/**
 * Vast diagnose-commando: altijd beschikbaar, zonder flag. De skeleton-default-rooktest
 * leunt hierop, zodat een deploy het volledige inbound-berichtpad test ongeacht wat een
 * app met zijn eigen handler doet (#464).
 */
export const pingCommand: Command = {
  name: 'ping',
  description: 'Antwoordt met pong.',
  handle: () => 'pong',
};

/** Echo zit achter een flag, zodat de flag-werking in elke omgeving aantoonbaar is. */
export const echoCommand: Command = {
  name: 'echo',
  description: 'Herhaalt het argument.',
  flagKey: 'echo',
  handle: (context) => (context.argument === '' ? 'Geef iets om te herhalen.' : context.argument),
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
