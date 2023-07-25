import { SqliteStorageAdapter } from "../storage/sqlite-storage-adapter.js";
import { type CreateServerOptions, type Runtime } from "../types.js";

export function getRuntime(
  config: CreateServerOptions,
  env: Record<string, unknown>,
): Runtime {
  const db = env[config.env.db] as string;

  return {
    storage: new SqliteStorageAdapter(
      db.endsWith(".sqlite") ? { db } : undefined,
    ),
  };
}
