import type { ChannelAdapter } from './channel.js';
import type { Clock } from '../core/clock.js';
import type { MessageService } from '../core/message-service.js';
import type { OutboundMessage } from '../core/message.js';

export const FAKE_CHANNEL_NAME = 'fake';

export interface FakeChannel extends ChannelAdapter {
  /** Simuleert een inkomend bericht en geeft de antwoordteksten terug. */
  receive(from: string, text: string): string[];
  readonly sent: readonly OutboundMessage[];
}

/** In-memory kanaal voor unit tests: geen netwerk, geen stdin. */
export function createFakeChannel(clock: Clock): FakeChannel {
  const sent: OutboundMessage[] = [];
  let service: MessageService | undefined;

  return {
    name: FAKE_CHANNEL_NAME,
    sent,
    start: (messageService) => {
      service = messageService;
      return Promise.resolve();
    },
    receive: (from, text) => {
      if (service === undefined) {
        throw new Error('Kanaal is niet gestart.');
      }
      return service
        .handle({ channel: FAKE_CHANNEL_NAME, from, text, receivedAt: clock.now() })
        .map((reply) => reply.text);
    },
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
    stop: () => {
      service = undefined;
      return Promise.resolve();
    },
  };
}
