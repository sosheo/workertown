import { createRouter } from "@workertown/hono";

import { type Context } from "../../types.js";

const router = createRouter<Context>();

router.get("/info", (ctx) => {
  const config = ctx.get("config");

  return ctx.json({ status: 200, success: true, data: config });
});

router.post("/migrate", async (ctx) => {
  const storage = ctx.get("storage");
  let success = true;

  try {
    await storage.runMigrations();
  } catch (_) {
    success = false;
  }

  return ctx.json(
    { status: success ? 200 : 500, success, data: success },
    success ? 200 : 500
  );
});

export { router };