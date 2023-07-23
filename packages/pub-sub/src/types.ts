import {
  type CreateServerOptions as BaseCreateServerOptions,
  type WorkertownContext,
} from "@workertown/internal-hono";

import { type QueueAdapter } from "./queue/index.js";
import { type StorageAdapter } from "./storage/index.js";

export interface CreateServerOptions extends BaseCreateServerOptions {
  endpoints: {
    v1: {
      admin: string;
      publish: string;
      subscriptions: string;
    };
    public: string;
  };
  env: {
    database: string;
    queue: string;
  };
  queue?: QueueAdapter;
  storage?: StorageAdapter;
}

export type Context = WorkertownContext<{
  config: CreateServerOptions;
  queue: QueueAdapter;
  storage: StorageAdapter;
}>;
