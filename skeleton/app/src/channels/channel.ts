import type { MessageService } from '../core/message-service.js';
import type { OutboundMessage } from '../core/message.js';

/**
 * Elk kanaal waarover de applicatie te bereiken is implementeert dit.
 * De HTTP-route is het standaardkanaal (dev/acc en tests), de CLI is er voor
 * handmatig proberen, WhatsApp komt in slice 1 en een eigen interface later.
 */
export interface ChannelAdapter {
  readonly name: string;
  start(service: MessageService): Promise<void>;
  /** Ongevraagd bericht sturen. Niet elk kanaal ondersteunt dit. */
  send(message: OutboundMessage): Promise<void>;
  stop(): Promise<void>;
}
