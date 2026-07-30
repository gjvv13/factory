import type { Clock } from './clock.js';
import type { CommandRouter } from './command-router.js';
import type { Logger } from './logger.js';
import type { InboundMessage, OutboundMessage } from './message.js';
import type { MessageLogRepository } from './message-log.js';

export interface MessageService {
  /** Verwerkt één inkomend bericht en geeft de antwoorden terug. */
  handle(message: InboundMessage): OutboundMessage[];
}

/**
 * Het hart van de applicatie: kanaalonafhankelijk. Elke adapter (HTTP, CLI,
 * later WhatsApp of een eigen interface) doet niets anders dan hier afleveren.
 */
export function createMessageService(dependencies: {
  router: CommandRouter;
  messageLog: MessageLogRepository;
  clock: Clock;
  logger: Logger;
}): MessageService {
  const { router, messageLog, clock, logger } = dependencies;

  return {
    handle: (message) => {
      messageLog.recordInbound(message);
      const replyText = router.route(message);
      const reply: OutboundMessage = {
        channel: message.channel,
        to: message.from,
        text: replyText,
      };
      messageLog.recordOutbound(reply, clock.now());
      logger.info(
        { channel: message.channel, from: message.from, chars: message.text.length },
        'bericht verwerkt',
      );
      return [reply];
    },
  };
}
