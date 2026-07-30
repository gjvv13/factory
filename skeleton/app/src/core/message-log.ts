import { desc } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { messageLog } from '../db/schema.js';
import type { InboundMessage, OutboundMessage } from './message.js';

export interface LoggedMessage {
  readonly id: number;
  readonly channel: string;
  readonly direction: 'in' | 'out';
  readonly participant: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface MessageLogRepository {
  recordInbound(message: InboundMessage): void;
  recordOutbound(message: OutboundMessage, at: Date): void;
  recent(limit: number): LoggedMessage[];
}

export function createMessageLogRepository(db: Db): MessageLogRepository {
  return {
    recordInbound: (message) => {
      db.insert(messageLog)
        .values({
          channel: message.channel,
          direction: 'in',
          participant: message.from,
          text: message.text,
          createdAt: message.receivedAt.toISOString(),
        })
        .run();
    },
    recordOutbound: (message, at) => {
      db.insert(messageLog)
        .values({
          channel: message.channel,
          direction: 'out',
          participant: message.to,
          text: message.text,
          createdAt: at.toISOString(),
        })
        .run();
    },
    recent: (limit) => db.select().from(messageLog).orderBy(desc(messageLog.id)).limit(limit).all(),
  };
}
