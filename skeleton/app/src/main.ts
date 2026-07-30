import { createApplication } from './app.js';
import { createCliChannel } from './channels/cli-channel.js';
import { createHttpChannel } from './channels/http-channel.js';
import type { ChannelAdapter } from './channels/channel.js';
import { loadConfig } from './config.js';
import { buildServer } from './http/server.js';

const config = loadConfig();
const app = createApplication(config);
const server = buildServer(app);

const channel: ChannelAdapter =
  config.channel === 'cli' ? createCliChannel(app.clock) : createHttpChannel();
await channel.start(app.messageService);

async function shutdown(signal: string): Promise<void> {
  app.logger.info({ signal }, 'afsluiten');
  await channel.stop();
  await server.close();
  app.close();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  await server.listen({ host: config.host, port: config.port });
  app.logger.info(
    { environment: config.environment, port: config.port, channel: channel.name },
    'factory gestart',
  );
} catch (error) {
  app.logger.error({ error }, 'starten mislukt');
  app.close();
  process.exit(1);
}
