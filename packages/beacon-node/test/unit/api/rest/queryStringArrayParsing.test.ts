import {FastifyInstance} from "fastify";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {testLogger} from "@lodestar/logger/test-utils";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {RestApiServer, RestApiServerModules, RestApiServerOpts} from "../../../../src/api/rest/base.js";

/**
 * Regression coverage for https://github.com/ChainSafe/lodestar/issues/9672.
 *
 * After the v1.44.0 `qs` bump, requests like `GET .../validators?id=a,b,c,...` with more than
 * 20 comma-separated ids started failing with `id must be array` (400). Root cause: `qs`'s default
 * `arrayLimit` (20) is below the beacon-API `maxItems` for the validator `id` query (64), so anything
 * over 20 items was parsed as an object instead of an array and rejected by the `type: "array"` schema.
 * #9673 fixed it by raising the querystring `arrayLimit` to `NUMBER_OF_COLUMNS`.
 *
 * These tests exercise the real {@link RestApiServer} so they are bound to the production querystring
 * parser configured in `base.ts` (rather than a stand-alone Fastify instance with a copied config).
 * If the `arrayLimit` override regresses, the 21/64/65-item cases below fail exactly as #9672 did.
 */

/** Exposes the protected Fastify instance so tests can register a route and inject requests. */
class TestRestApiServer extends RestApiServer {
  get fastify(): FastifyInstance {
    return this.server;
  }
}

// Mirrors `Schema.UintOrStringArray`, the schema used by `getStateValidators` / `getStateValidatorBalances`
// for the `id` query param (packages/api/src/beacon/routes/beacon/state.ts).
const uintOrStringArraySchema = {
  querystring: {
    type: "object",
    properties: {id: {type: "array", items: {anyOf: [{type: "string"}, {type: "integer"}]}}},
  },
};

// Mirrors `Schema.UintArray`, the schema used by `getDebugDataColumnSidecars` for the `indices` query param
// (packages/api/src/beacon/routes/debug.ts) — the param that requires the `NUMBER_OF_COLUMNS` limit.
const uintArraySchema = {
  querystring: {
    type: "object",
    properties: {indices: {type: "array", items: {type: "integer", minimum: 0}}},
  },
};

/**
 * Representative boundary item counts (rather than exhaustively enumerating 1..64).
 * - 1: single value, exercises Ajv `coerceTypes: "array"` scalar-to-array coercion
 * - 20: last count accepted under `qs`'s default `arrayLimit`
 * - 21: first count that regressed in #9672 (would parse as object under the default limit)
 * - 64: beacon-API `maxItems` for the validator `id` query, must be supported
 * - 65: above the spec `maxItems` and still accepted — we deliberately do not hard-cap server-side
 * - NUMBER_OF_COLUMNS: the configured `arrayLimit`, the largest array any beacon-API query carries
 */
const ACCEPTED_COUNTS = [1, 20, 21, 64, 65, NUMBER_OF_COLUMNS];
// First count that overflows `arrayLimit`; `qs` returns an object and schema validation rejects it (400).
const OVERFLOW_COUNT = NUMBER_OF_COLUMNS + 1;

function commaQuery(param: string, n: number): string {
  return `${param}=${Array.from({length: n}, (_, i) => i).join(",")}`;
}

function repeatedQuery(param: string, n: number): string {
  return Array.from({length: n}, (_, i) => `${param}=${i}`).join("&");
}

describe("RestApiServer query string array parsing", () => {
  let server: TestRestApiServer;

  beforeAll(async () => {
    const opts: RestApiServerOpts = {port: 0};
    const modules: RestApiServerModules = {logger: testLogger(), metrics: null};
    server = new TestRestApiServer(opts, modules);

    server.fastify.get("/validators", {schema: uintOrStringArraySchema}, async (req) => req.query);
    server.fastify.get("/data-column-sidecars", {schema: uintArraySchema}, async (req) => req.query);

    await server.fastify.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe("validator id query (maxItems=64, Schema.UintOrStringArray)", () => {
    for (const n of ACCEPTED_COUNTS) {
      it(`parses ${n} comma-separated ids as an array`, async () => {
        const res = await server.fastify.inject({method: "GET", url: `/validators?${commaQuery("id", n)}`});
        expect(res.statusCode, `comma-separated id query with ${n} items should be accepted (200)`).toBe(200);
        const {id} = res.json() as {id: unknown[]};
        expect(Array.isArray(id), `comma-separated id query with ${n} items should parse as an array`).toBe(true);
        expect(id, `comma-separated id query should preserve all ${n} parsed items`).toHaveLength(n);
      });

      it(`parses ${n} repeated ids as an array`, async () => {
        const res = await server.fastify.inject({method: "GET", url: `/validators?${repeatedQuery("id", n)}`});
        expect(res.statusCode, `repeated id query with ${n} items should be accepted (200)`).toBe(200);
        const {id} = res.json() as {id: unknown[]};
        expect(Array.isArray(id), `repeated id query with ${n} items should parse as an array`).toBe(true);
        expect(id, `repeated id query should preserve all ${n} parsed items`).toHaveLength(n);
      });
    }

    it(`rejects ${OVERFLOW_COUNT} comma-separated ids with the #9672 error`, async () => {
      const res = await server.fastify.inject({method: "GET", url: `/validators?${commaQuery("id", OVERFLOW_COUNT)}`});
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("must be array");
    });

    it(`rejects ${OVERFLOW_COUNT} repeated ids with the #9672 error`, async () => {
      const res = await server.fastify.inject({
        method: "GET",
        url: `/validators?${repeatedQuery("id", OVERFLOW_COUNT)}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("must be array");
    });
  });

  describe("data-column indices query (maxItems=NUMBER_OF_COLUMNS, Schema.UintArray)", () => {
    it(`parses a full custody set of ${NUMBER_OF_COLUMNS} indices as an array`, async () => {
      const res = await server.fastify.inject({
        method: "GET",
        url: `/data-column-sidecars?${commaQuery("indices", NUMBER_OF_COLUMNS)}`,
      });
      expect(res.statusCode).toBe(200);
      const {indices} = res.json() as {indices: unknown[]};
      expect(Array.isArray(indices)).toBe(true);
      expect(indices).toHaveLength(NUMBER_OF_COLUMNS);
    });
  });
});
