import {timingSafeEqual} from "node:crypto";
import fs from "node:fs";
import type {FastifyInstance} from "fastify";
import type {OrderExposure, OrderExposureQuery} from "@lodestar/builder";

export function registerOrderExposure(
  server: FastifyInstance,
  tokenFile: string,
  getExposure: () => OrderExposure | null
): void {
  const stat = fs.statSync(tokenFile);
  if (!stat.isFile() || stat.size > 65) throw Error("ORDER_EXPOSURE_TOKEN_FILE");
  const contents = fs.readFileSync(tokenFile, "utf8");
  if (!/^[0-9a-f]{64}\n?$/.test(contents)) throw Error("ORDER_EXPOSURE_TOKEN_FILE");
  const expected = Buffer.from(`Bearer ${contents.trim()}`);
  server.route<{Body: unknown}>({
    method: "POST",
    url: "/internal/v1/order-exposure",
    bodyLimit: 1024,
    errorHandler: (error, _request, reply) => {
      const status = (error as {statusCode?: number}).statusCode;
      reply.code(status === 413 || status === 415 ? status : 400).send({error: "ORDER_EXPOSURE_REQUEST"});
    },
    onRequest: async (request, reply) => {
      const authorization = request.headers.authorization;
      const supplied = typeof authorization === "string" ? Buffer.from(authorization) : Buffer.alloc(0);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        reply.code(401).send({error: "ORDER_EXPOSURE_UNAUTHORIZED"});
      }
    },
    handler: async (request, reply) => {
      const body = request.body;
      if (typeof body !== "object" || body === null || Array.isArray(body))
        return reply.code(400).send({error: "ORDER_EXPOSURE_REQUEST"});
      const fields = body as Record<string, unknown>;
      if (fields.version !== 1 || !["capabilities", "query"].includes(String(fields.action)))
        return reply.code(400).send({error: "ORDER_EXPOSURE_REQUEST"});
      const exposure = getExposure();
      if (!exposure) return reply.code(503).send({error: "ORDER_EXPOSURE_NOT_READY"});
      if (fields.action === "capabilities") {
        if (Object.keys(fields).some((key) => !["version", "action"].includes(key)))
          return reply.code(400).send({error: "ORDER_EXPOSURE_REQUEST"});
        return exposure.capabilities();
      }
      if (
        Object.keys(fields).length !== 7 ||
        typeof fields.orderId !== "string" ||
        !/^0x[0-9a-f]{64}$/.test(fields.orderId) ||
        typeof fields.namespace !== "string" ||
        !/^0x[0-9a-f]{32}$/.test(fields.namespace) ||
        typeof fields.generation !== "string" ||
        !/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/.test(fields.generation) ||
        !Number.isSafeInteger(fields.admittedAtUnixMs) ||
        (fields.admittedAtUnixMs as number) < 0 ||
        typeof fields.admittedPublisherInstance !== "string" ||
        !/^[0-9a-f-]{36}$/.test(fields.admittedPublisherInstance)
      )
        return reply.code(400).send({error: "ORDER_EXPOSURE_REQUEST"});
      try {
        return await exposure.query(fields as OrderExposureQuery);
      } catch {
        return reply.code(503).send({error: "ORDER_EXPOSURE_UNAVAILABLE"});
      }
    },
  });
}
