import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import type { Application } from '../../app.js';
import { LOG_LEVELS } from '../../core/logger.js';

const updateBodySchema = z.object({ level: z.enum(LOG_LEVELS) });

/**
 * Het logniveau live bekijken en omzetten, zonder het env-bestand te bewerken en te
 * herstarten. Alleen bereikbaar via de loopback-interface (de server bindt op
 * 127.0.0.1), dus geen aparte authenticatie nodig — net als het flag-beheer.
 *
 * Niet persistent: bij een herstart valt de omgeving terug op `LOG_LEVEL` uit de env,
 * zodat de env de bron van waarheid blijft en een tijdelijke verhoging vanzelf verdwijnt.
 */
export function logLevelRoutes(app: Application): FastifyPluginCallback {
  return (server, _options, done) => {
    server.get('/admin/log-level', () => ({ level: app.logger.level, levels: LOG_LEVELS }));

    server.put('/admin/log-level', (request, reply) => {
      const body = updateBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: `Kies een niveau uit: ${LOG_LEVELS.join(', ')}` });
      }
      // Beide loggers omzetten: de app-logger (kanaal, message-service) én de
      // request-logger van Fastify, zodat de verandering meteen overal geldt.
      app.logger.level = body.data.level;
      server.log.level = body.data.level;
      return reply.code(200).send({ level: app.logger.level });
    });

    done();
  };
}
