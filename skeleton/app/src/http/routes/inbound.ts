import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import type { Application } from '../../app.js';
import { HTTP_CHANNEL_NAME } from '../../channels/http-channel.js';

const inboundBodySchema = z.object({
  from: z.string().min(1).max(120),
  text: z.string().min(1).max(4000),
});

const recentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

/**
 * Het HTTP-kanaal: een bericht erin, de antwoorden eruit.
 * Dit is het kanaal dat dev en acc gebruiken en waarmee de e2e-tests praten.
 */
export function inboundRoutes(app: Application): FastifyPluginCallback {
  return (server, _options, done) => {
    server.post('/channels/http/inbound', (request, reply) => {
      const body = inboundBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Ongeldig bericht: from en text zijn verplicht' });
      }
      const replies = app.messageService.handle({
        channel: HTTP_CHANNEL_NAME,
        from: body.data.from,
        text: body.data.text,
        receivedAt: app.clock.now(),
      });
      return reply.code(200).send({ replies });
    });

    server.get('/admin/messages', (request, reply) => {
      const query = recentQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'Ongeldige limit' });
      }
      return reply.code(200).send({ messages: app.messageLog.recent(query.data.limit) });
    });

    done();
  };
}
