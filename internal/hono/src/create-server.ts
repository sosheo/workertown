import {
  type ExecutionContext,
  type MessageBatch,
  type ScheduledEvent,
} from "@cloudflare/workers-types";
import { type Env, Hono } from "hono";
import { cors } from "hono/cors";

import {
  type ApiKeyOptions,
  type BasicOptions,
  type IpOptions,
  type JwtOptions,
  type SentryOptions,
  apiKey as apiKeyMiddleware,
  basic as basicMiddleware,
  ip as ipMiddleware,
  jwt as jwtMiddleware,
  sentry as sentryMiddleware,
} from "./middleware/index.js";
import { type Context } from "./types.js";

export class WorkertownHono<T extends Context> extends Hono<T> {
  queue?: (
    // rome-ignore lint/suspicious/noExplicitAny: We don't care about the shape of the messages here
    batch: MessageBatch<any>,
    env: Env["Bindings"],
    ctx: ExecutionContext,
  ) => void | Promise<void>;
  scheduled?: (
    event: ScheduledEvent,
    env: Env["Bindings"],
    ctx: ExecutionContext,
  ) => void | Promise<void>;
}

export interface CreateServerOptions {
  access?: {
    ip?: IpOptions | false;
  };
  auth?: {
    basic?: BasicOptions | false;
    jwt?: JwtOptions | false;
    apiKey?: ApiKeyOptions | false;
  };
  basePath?: string;
  cors?: // Copy/pasted from cors/hono
    | {
        origin:
          | string
          | string[]
          | ((origin: string) => string | undefined | null);
        allowMethods?: string[];
        allowHeaders?: string[];
        maxAge?: number;
        credentials?: boolean;
        exposeHeaders?: string[];
      }
    | false;
  sentry?: SentryOptions | false;
}

export function createServer<T extends Context>(
  options: CreateServerOptions = {},
) {
  const {
    access: accessOptions,
    auth: authOptions,
    basePath = "/",
    cors: corsOptions,
    sentry: sentryOptions,
  } = options;
  const server = new Hono<T>().basePath(basePath) as WorkertownHono<T>;

  // This sets `ctx.env` to NodeJS' `process.env` if we're in that environment
  server.use(async (ctx, next) => {
    if (!ctx.env && globalThis.process?.env) {
      ctx.env = globalThis.process.env;
    }

    return next();
  });

  if (accessOptions?.ip) {
    server.use("*", ipMiddleware(accessOptions?.ip));
  }

  if (sentryOptions) {
    server.use("*", sentryMiddleware(sentryOptions));
  }

  if (authOptions?.basic !== false) {
    server.use("*", basicMiddleware(authOptions?.basic));
  }

  if (authOptions?.apiKey !== false) {
    server.use("*", apiKeyMiddleware(authOptions?.apiKey));
  }

  if (authOptions?.jwt !== false) {
    server.use("*", jwtMiddleware(authOptions?.jwt));
  }

  if (corsOptions) {
    server.use("*", cors(corsOptions));
    server.options("*", (ctx) => ctx.text("OK"));
  }

  server.notFound((ctx) =>
    ctx.json(
      { success: false, status: 404, data: null, error: "Not found" },
      404,
    ),
  );

  server.onError((error, ctx) => {
    console.error(error);

    return ctx.json(
      {
        success: false,
        status: 500,
        data: null,
        // rome-ignore lint/suspicious/noExplicitAny: We need to reach inside of the Error
        error: (error.cause as any)?.message ?? error.message,
      },
      500,
    );
  });

  return server as WorkertownHono<T>;
}
