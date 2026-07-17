import {FastifyInstance, LightMyRequestResponse} from "fastify";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {testLogger} from "@lodestar/logger/test-utils";
import {RestApiServer} from "../../../../src/api/rest/base.js";

/**
 * Registers a minimal route mirroring the `id` array query param of `getStateValidators`
 * (`maxItems: 64`) so we can exercise the real server's query string parsing (qs + ajv).
 */
class TestRestApiServer extends RestApiServer {
  registerTestRoute(): void {
    this.server.route({
      method: "GET",
      url: "/test/validators",
      schema: {
        querystring: {
          type: "object",
          properties: {
            id: {type: "array", items: {anyOf: [{type: "string"}, {type: "integer"}]}},
          },
        },
      },
      handler: async (req) => ({id: (req.query as {id?: unknown[]}).id ?? []}),
    });
  }

  get fastify(): FastifyInstance {
    return this.server;
  }
}

describe("RestApiServer query string array parsing", () => {
  let server: TestRestApiServer;

  const commaIds = (n: number): string => `id=${Array.from({length: n}, (_, i) => i).join(",")}`;
  const repeatedIds = (n: number): string => Array.from({length: n}, (_, i) => `id=${i}`).join("&");
  const inject = (query: string): Promise<LightMyRequestResponse> =>
    server.fastify.inject({method: "GET", url: `/test/validators?${query}`});

  beforeAll(async () => {
    server = new TestRestApiServer({port: 0}, {logger: testLogger(), metrics: null});
    server.registerTestRoute();
    await server.fastify.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("coerces a single id value into an array", async () => {
    const res = await inject("id=5");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).id).toEqual(["5"]);
  });

  it("parses more than the previous qs default of 20 comma-separated ids (regression for #9672)", async () => {
    const res = await inject(commaIds(21));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).id).toHaveLength(21);
  });

  it("parses comma-separated id array up to the beacon-API maxItems (64)", async () => {
    const res = await inject(commaIds(64));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).id).toHaveLength(64);
  });

  it("parses repeated id params up to the limit (64)", async () => {
    const res = await inject(repeatedIds(64));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).id).toHaveLength(64);
  });

  it("rejects a comma-separated id array larger than the limit", async () => {
    // qs turns arrays longer than arrayLimit into an object, which fails `type: array` validation
    const res = await inject(commaIds(65));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe("id must be array");
  });
});
