import type { ChannelAdapter } from './channel.js';
import type { MessageService } from '../core/message-service.js';
import type { OutboundMessage } from '../core/message.js';

export const HTTP_CHANNEL_NAME = 'http';

/**
 * Het HTTP-kanaal is request/response: de antwoorden gaan mee in de respons
 * van POST /channels/http/inbound (zie http/routes/inbound.ts). Er is dus geen
 * verbinding om ongevraagd over te versturen.
 */
export function createHttpChannel(): ChannelAdapter {
  return {
    name: HTTP_CHANNEL_NAME,
    start: (_service: MessageService) => Promise.resolve(),
    send: (_message: OutboundMessage) =>
      Promise.reject(
        new Error('Het HTTP-kanaal kan niet ongevraagd sturen; antwoorden gaan mee in de respons.'),
      ),
    stop: () => Promise.resolve(),
  };
}
