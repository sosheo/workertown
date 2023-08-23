import { createRouter, validate } from "@workertown/internal-hono";
import { z } from "zod";

import { type Context } from "../../types.js";

const router = createRouter<Context>();

router.post(
  "/",
  validate(
    "json",
    z.object({
      path: z.string(),
      callbackUrl: z.string().url().optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  async (ctx) => {
    const config = ctx.get("config");
    const storage = ctx.get("storage");
    const { path, callbackUrl, metadata } = ctx.req.valid("json");
    const expiresAt = new Date(Date.now() + config.files.uploadUrlTtl * 1000);
    const id = await storage.createUploadUrl({
      path,
      callbackUrl,
      metadata,
      expiresAt,
    });

    return ctx.json({
      status: 200,
      success: true,
      data: { id, expiresAt: expiresAt.toISOString() },
    });
  },
);

export { router };
