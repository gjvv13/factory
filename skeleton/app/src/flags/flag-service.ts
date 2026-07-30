import { eq } from 'drizzle-orm';
import type { Clock } from '../core/clock.js';
import type { Db } from '../db/client.js';
import { featureFlags } from '../db/schema.js';

export interface FeatureFlag {
  readonly key: string;
  readonly enabled: boolean;
  readonly description: string;
  readonly updatedAt: string;
}

export interface FlagService {
  isEnabled(key: string): boolean;
  list(): FeatureFlag[];
  set(key: string, enabled: boolean, description?: string): FeatureFlag;
  invalidate(): void;
}

/**
 * Feature flags uit de database met een korte cache.
 * De cache maakt lezen goedkoop in het hete pad; de TTL zorgt dat een flag
 * die je in productie omzet binnen enkele seconden werkt, zonder herstart.
 */
export function createFlagService(db: Db, clock: Clock, cacheTtlMs: number): FlagService {
  let cache: Map<string, FeatureFlag> | undefined;
  let cachedAtMs = 0;

  function readAll(): Map<string, FeatureFlag> {
    const now = clock.now().getTime();
    if (cache !== undefined && now - cachedAtMs < cacheTtlMs) {
      return cache;
    }
    const rows = db.select().from(featureFlags).all();
    cache = new Map(rows.map((row) => [row.key, row]));
    cachedAtMs = now;
    return cache;
  }

  return {
    isEnabled: (key) => readAll().get(key)?.enabled ?? false,
    list: () => [...readAll().values()].sort((a, b) => a.key.localeCompare(b.key)),
    set: (key, enabled, description) => {
      const updatedAt = clock.now().toISOString();
      const existing = db.select().from(featureFlags).where(eq(featureFlags.key, key)).get();
      const row: FeatureFlag = {
        key,
        enabled,
        description: description ?? existing?.description ?? '',
        updatedAt,
      };
      db.insert(featureFlags)
        .values(row)
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: { enabled: row.enabled, description: row.description, updatedAt },
        })
        .run();
      cache = undefined;
      return row;
    },
    invalidate: () => {
      cache = undefined;
    },
  };
}
