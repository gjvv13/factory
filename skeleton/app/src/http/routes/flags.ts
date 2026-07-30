import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import type { Application } from '../../app.js';

const keyParamsSchema = z.object({ key: z.string().min(1).max(80) });
const updateBodySchema = z.object({
  enabled: z.boolean(),
  description: z.string().max(300).optional(),
});

/**
 * Beheer van feature flags. Alleen bereikbaar via de loopback-interface
 * (de server bindt op 127.0.0.1), dus geen aparte authenticatie nodig.
 */
export function flagRoutes(app: Application): FastifyPluginCallback {
  return (server, _options, done) => {
    server.get('/admin/flags', () => ({ flags: app.flags.list() }));

    server.put('/admin/flags/:key', (request, reply) => {
      const params = keyParamsSchema.safeParse(request.params);
      const body = updateBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'Ongeldige flag-aanvraag' });
      }
      const flag = app.flags.set(
        params.data.key,
        body.data.enabled,
        ...(body.data.description === undefined ? [] : [body.data.description]),
      );
      return reply.code(200).send({ flag });
    });

    done();
  };
}
