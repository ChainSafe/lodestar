import {FastifyInstance, fastify} from "fastify";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {Schema, getFastifySchema} from "../../../src/utils/schema.js";
import {
  BEACON_API_VALIDATOR_IDS_QUERY_MAX_ITEMS,
  QUERY_STRING_ARRAY_LIMIT,
  parseRestQueryString,
} from "../../../src/utils/server/parser.js";

type QueryHandlerResult = Record<string, unknown>;

function createQueryTestServer(schema: Record<string, unknown>): FastifyInstance {
  const server = fastify({
    ajv: {customOptions: {coerceTypes: "array"}},
    routerOptions: {
      querystringParser: parseRestQueryString,
    },
  });

  server.route({
    method: "GET",
    url: "/test",
    schema,
    handler: async (req) => req.query as QueryHandlerResult,
  });

  return server;
}

function commaQuery(param: string, n: number): string {
  return `${param}=${Array.from({length: n}, (_, i) => i).join(",")}`;
}

function repeatedQuery(param: string, n: number): string {
  return Array.from({length: n}, (_, i) => `${param}=${i}`).join("&");
}

function lengthsUpTo(max: number): number[] {
  return Array.from({length: max}, (_, i) => i + 1);
}

describe("REST query string array limits", () => {
  describe("validator id query (Beacon API maxItems=64)", () => {
    let server: FastifyInstance;

    const routeSchema = getFastifySchema<{query: {id: (string | number)[]}}>({
      query: {id: Schema.UintOrStringArrayMax64},
    });

    beforeAll(async () => {
      server = createQueryTestServer(routeSchema);
      await server.ready();
    });

    afterAll(async () => {
      await server.close();
    });

    it("accepts an omitted optional id query", async () => {
      const res = await server.inject({method: "GET", url: "/test"});
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({});
    });

    it.each(lengthsUpTo(BEACON_API_VALIDATOR_IDS_QUERY_MAX_ITEMS))(
      "accepts %i comma-separated id values",
      async (n) => {
        const res = await server.inject({method: "GET", url: `/test?${commaQuery("id", n)}`});
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).id).toHaveLength(n);
      }
    );

    it.each(lengthsUpTo(BEACON_API_VALIDATOR_IDS_QUERY_MAX_ITEMS))("accepts %i repeated id values", async (n) => {
      const res = await server.inject({method: "GET", url: `/test?${repeatedQuery("id", n)}`});
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).id).toHaveLength(n);
    });

    it("rejects more than 64 comma-separated id values", async () => {
      const res = await server.inject({
        method: "GET",
        url: `/test?${commaQuery("id", BEACON_API_VALIDATOR_IDS_QUERY_MAX_ITEMS + 1)}`,
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects more than 64 repeated id values", async () => {
      const res = await server.inject({
        method: "GET",
        url: `/test?${repeatedQuery("id", BEACON_API_VALIDATOR_IDS_QUERY_MAX_ITEMS + 1)}`,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("data-column indices query (maxItems=NUMBER_OF_COLUMNS)", () => {
    let server: FastifyInstance;

    const routeSchema = getFastifySchema<{query: {indices: number[]}}>({
      query: {indices: Schema.UintArrayMaxColumns},
    });

    beforeAll(async () => {
      server = createQueryTestServer(routeSchema);
      await server.ready();
    });

    afterAll(async () => {
      await server.close();
    });

    it("accepts an omitted optional indices query", async () => {
      const res = await server.inject({method: "GET", url: "/test"});
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({});
    });

    it.each(lengthsUpTo(QUERY_STRING_ARRAY_LIMIT))("accepts %i comma-separated indices values", async (n) => {
      const res = await server.inject({method: "GET", url: `/test?${commaQuery("indices", n)}`});
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).indices).toHaveLength(n);
    });

    it.each(lengthsUpTo(QUERY_STRING_ARRAY_LIMIT))("accepts %i repeated indices values", async (n) => {
      const res = await server.inject({method: "GET", url: `/test?${repeatedQuery("indices", n)}`});
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).indices).toHaveLength(n);
    });

    it("rejects more than NUMBER_OF_COLUMNS comma-separated indices", async () => {
      const res = await server.inject({
        method: "GET",
        url: `/test?${commaQuery("indices", QUERY_STRING_ARRAY_LIMIT + 1)}`,
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects more than NUMBER_OF_COLUMNS repeated indices", async () => {
      const res = await server.inject({
        method: "GET",
        url: `/test?${repeatedQuery("indices", QUERY_STRING_ARRAY_LIMIT + 1)}`,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("parseRestQueryString overflow behavior", () => {
    it("keeps comma-separated arrays as arrays up to QUERY_STRING_ARRAY_LIMIT", () => {
      const parsed = parseRestQueryString(commaQuery("id", QUERY_STRING_ARRAY_LIMIT));
      expect(Array.isArray(parsed.id)).toBe(true);
      expect((parsed.id as unknown[]).length).toBe(QUERY_STRING_ARRAY_LIMIT);
    });

    it("turns comma-separated arrays longer than QUERY_STRING_ARRAY_LIMIT into objects", () => {
      const parsed = parseRestQueryString(commaQuery("id", QUERY_STRING_ARRAY_LIMIT + 1));
      expect(Array.isArray(parsed.id)).toBe(false);
      expect(typeof parsed.id).toBe("object");
    });
  });
});
