import { type Hono } from "hono";

export function makeRequest(
  // rome-ignore lint/suspicious/noExplicitAny: We don't care about the shape of the Hono server here
  service: Hono<any, any, any>,
  path: string,
  {
    method = "GET",
    body,
    headers = {},
  }: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  return service.fetch(
    new Request(`http://service.local${path}`, {
      method,
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}
