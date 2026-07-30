import type { Config } from './config.js';
import { systemClock, type Clock } from './core/clock.js';
import { createCommandRouter, type Command, type CommandRouter } from './core/command-router.js';
import { createHelpCommand, helloCommand, pingCommand, versionCommand } from './core/commands.js';
import { createContactRepository, type ContactRepository } from './core/contacts.js';
import { createLogger, type Logger } from './core/logger.js';
import { createMessageLogRepository, type MessageLogRepository } from './core/message-log.js';
import { createMessageService, type MessageService } from './core/message-service.js';
import { openDatabase, runMigrations, type Db } from './db/client.js';
import { createFlagService, type FlagService } from './flags/flag-service.js';

export interface Application {
  readonly config: Config;
  readonly db: Db;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly flags: FlagService;
  readonly contacts: ContactRepository;
  readonly messageLog: MessageLogRepository;
  readonly router: CommandRouter;
  readonly messageService: MessageService;
  close(): void;
}

export interface ApplicationOptions {
  readonly clock?: Clock;
  readonly logger?: Logger;
  /** Standaard aan: de app zorgt zelf dat het schema bij is. */
  readonly migrate?: boolean;
}

/**
 * Compositieroot: hier worden alle onderdelen aan elkaar geknoopt.
 * Verder in de code wordt niets meer zelf geconstrueerd, zodat alles
 * in tests vervangbaar is.
 */
export function createApplication(config: Config, options: ApplicationOptions = {}): Application {
  const clock = options.clock ?? systemClock;
  const logger =
    options.logger ??
    createLogger(config.logLevel, { environment: config.environment, version: config.version });

  const handle = openDatabase(config.databaseFile);
  if (options.migrate !== false) {
    runMigrations(handle.db, config.migrationsDir);
  }

  const flags = createFlagService(handle.db, clock, config.flagCacheTtlMs);
  const contacts = createContactRepository(handle.db);
  const messageLog = createMessageLogRepository(handle.db);

  // Help moet de router kennen die hem zelf bevat; die knoop leggen we hier.
  const routerRef: { current?: CommandRouter } = {};
  const commands: readonly Command[] = [
    createHelpCommand(() => {
      if (routerRef.current === undefined) {
        throw new Error('Router is nog niet opgebouwd.');
      }
      return routerRef.current;
    }),
    pingCommand,
    helloCommand,
    versionCommand,
  ];
  const router = createCommandRouter(commands, {
    contacts,
    flags,
    version: config.version,
    environment: config.environment,
  });
  routerRef.current = router;

  const messageService = createMessageService({ router, messageLog, clock, logger });

  return {
    config,
    db: handle.db,
    clock,
    logger,
    flags,
    contacts,
    messageLog,
    router,
    messageService,
    close: () => {
      handle.close();
    },
  };
}
