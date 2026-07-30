import readline from 'node:readline';
import type { ChannelAdapter } from './channel.js';
import type { MessageService } from '../core/message-service.js';
import type { Clock } from '../core/clock.js';
import type { OutboundMessage } from '../core/message.js';

export const CLI_CHANNEL_NAME = 'cli';
export const CLI_PARTICIPANT = 'local-terminal';

/**
 * Handmatig praten met de applicatie vanuit de terminal.
 * Handig tijdens ontwikkelen en om een slice te demonstreren zonder WhatsApp.
 */
export function createCliChannel(clock: Clock): ChannelAdapter {
  let reader: readline.Interface | undefined;

  return {
    name: CLI_CHANNEL_NAME,
    start: (service: MessageService) => {
      reader = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log("Factory CLI. Typ een commando ('help'), of Ctrl-C om te stoppen.");
      reader.setPrompt('> ');
      reader.prompt();
      reader.on('line', (line) => {
        if (line.trim() !== '') {
          for (const reply of service.handle({
            channel: CLI_CHANNEL_NAME,
            from: CLI_PARTICIPANT,
            text: line,
            receivedAt: clock.now(),
          })) {
            console.log(reply.text);
          }
        }
        reader?.prompt();
      });
      return Promise.resolve();
    },
    send: (message: OutboundMessage) => {
      console.log(message.text);
      return Promise.resolve();
    },
    stop: () => {
      reader?.close();
      reader = undefined;
      return Promise.resolve();
    },
  };
}
