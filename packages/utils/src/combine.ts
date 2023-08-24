import { type Server, createServer } from "@workertown/internal-server";

export function combine(...args: Server[]): Server {
  const server = args.reduce(
    (acc, hono) => acc.route("/", hono),
    createServer({
      access: { ip: false, rateLimit: false },
      auth: { apiKey: false, basic: false, jwt: false },
      logger: false,
      sentry: false,
    }),
  );

  return server as Server;
}
