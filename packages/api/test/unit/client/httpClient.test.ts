import {IncomingMessage} from "node:http";
import {BooleanType, ContainerType, UintNumberType, ValueOf} from "@chainsafe/ssz";
import {ErrorAborted, TimeoutError, toBase64} from "@lodestar/utils";
import {RouteOptions, fastify} from "fastify";
import {afterEach, describe, expect, it, vi} from "vitest";
import {WireFormat} from "../../../src/index.js";
import {addSszContentTypeParser} from "../../../src/server/index.js";
import {HttpClient, RouteDefinitionExtra} from "../../../src/utils/client/index.js";
import {
  AnyEndpoint,
  EmptyArgs,
  EmptyMeta,
  EmptyRequest,
  EmptyRequestCodec,
  EmptyResponseCodec,
  EmptyResponseData,
  JsonOnlyReq,
  JsonOnlyResponseCodec,
} from "../../../src/utils/codecs.js";
import {HttpHeader, MediaType} from "../../../src/utils/headers.js";
import {HttpStatusCode} from "../../../src/utils/httpStatusCode.js";
import {Endpoint, Schema} from "../../../src/utils/index.js";
import {compileRouteUrlFormatter} from "../../../src/utils/urlFormat.js";

/* eslint-disable @typescript-eslint/return-await */

describe("httpClient json client", () => {
  const afterEachCallbacks: (() => Promise<any> | any)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  const testRoute = {url: "/test-route", method: "GET" as const};
  const testDefinition: RouteDefinitionExtra<AnyEndpoint> = {
    url: testRoute.url,
    method: testRoute.method,
    req: EmptyRequestCodec,
    resp: EmptyResponseCodec,
    operationId: "testRoute",
    urlFormatter: compileRouteUrlFormatter(testRoute.url),
  };

  async function getServer(opts: RouteOptions): Promise<{baseUrl: string}> {
    const server = fastify({logger: false});
    server.route(opts);

    addSszContentTypeParser(server);

    const reqs = new Set<IncomingMessage>();
    server.addHook("onRequest", async (req) => reqs.add(req.raw));
    afterEachCallbacks.push(async () => {
      for (const req of reqs) req.destroy();
      await server.close();
    });

    return {baseUrl: await server.listen({port: 0})};
  }

  async function getServerWithClient(opts: RouteOptions): Promise<HttpClient> {
    const {baseUrl} = await getServer(opts);
    return new HttpClient({baseUrl});
  }

  it("should handle successful GET request correctly", async () => {
    type TestGetEndpoint = Endpoint<
      // ⏎
      "GET",
      EmptyArgs,
      EmptyRequest,
      {test: number},
      EmptyMeta
    >;

    const url = "/test-get";
    const testGetDefinition: RouteDefinitionExtra<TestGetEndpoint> = {
      url,
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
      operationId: "testGet",
      urlFormatter: compileRouteUrlFormatter(url),
    };

    const httpClient = await getServerWithClient({
      url,
      method: "GET",
      handler: async () => ({data: {test: 1}}),
    });

    const res = await httpClient.request(testGetDefinition, undefined);

    expect(res.status).toBe(HttpStatusCode.OK);
    expect(res.value()).toEqual({test: 1});
  });

  it("should handle successful POST request correctly", async () => {
    type TestPostEndpoint = Endpoint<
      "POST",
      {a: string; b: string[]; c: number},
      {query: {a: string; b: string[]}; body: {c: number}},
      {test: number},
      EmptyMeta
    >;

    const query = {a: "a", b: ["b1", "b2"]};
    const body = {c: 4};
    const resBody = {test: 1};
    let queryReceived: any;
    let bodyReceived: any;

    const url = "/test-post";
    const testPostDefinition: RouteDefinitionExtra<TestPostEndpoint> = {
      url,
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({a, b, c}) => ({query: {a, b}, body: {c}}),
        parseReqJson: ({query, body}) => ({a: query.a, b: query.b, c: body.c}),
        schema: {
          query: {a: Schema.String, b: Schema.StringArray},
          body: Schema.Object,
        },
      }),
      resp: JsonOnlyResponseCodec,
      operationId: "testPost",
      urlFormatter: compileRouteUrlFormatter(url),
    };

    const httpClient = await getServerWithClient({
      url,
      method: "POST",
      handler: async (req) => {
        queryReceived = req.query;
        bodyReceived = req.body;
        return {data: resBody};
      },
    });

    const res = await httpClient.request(testPostDefinition, {...query, ...body});

    expect(res.status).toBe(HttpStatusCode.OK);
    expect(res.value()).toEqual(resBody);
    expect(queryReceived).toEqual(query);
    expect(bodyReceived).toEqual(body);
  });

  it("should handle http status code 404 correctly", async () => {
    const httpClient = await getServerWithClient({
      url: "/no-route",
      method: "GET",
      handler: async () => ({}),
    });

    const res = await httpClient.request(testDefinition, {});

    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);

    expect(res.error()?.message).toBe("testRoute failed with status 404: Route GET:/test-route not found");
  });

  it("should handle http status code 415 correctly", async () => {
    const container = new ContainerType({
      a: new BooleanType(),
      b: new UintNumberType(1),
    });

    type TestEndpoint = Endpoint<
      "POST",
      {payload: ValueOf<typeof container>},
      {body: unknown},
      EmptyResponseData,
      EmptyMeta
    >;

    const url = "/test-unsupported-media-type";
    const routeId = "testUnsupportedMediaType";
    const testPostDefinition: RouteDefinitionExtra<TestEndpoint> = {
      url,
      method: "POST",
      req: {
        writeReqJson: ({payload}) => ({body: container.toJson(payload)}),
        parseReqJson: ({body}) => ({payload: container.fromJson(body)}),
        writeReqSsz: ({payload}) => ({body: container.serialize(payload)}),
        parseReqSsz: ({body}) => ({payload: container.deserialize(body)}),
        schema: {
          body: Schema.Object,
        },
      },
      resp: EmptyResponseCodec,
      operationId: routeId,
      urlFormatter: compileRouteUrlFormatter(url),
    };

    const httpClient = await getServerWithClient({
      url,
      method: "POST",
      handler: async (req, res) => {
        if (req.headers[HttpHeader.ContentType] !== MediaType.json) {
          void res.status(415);
        }
      },
    });
    const fetchSpy = vi.spyOn(httpClient, "fetch" as any);
    const sszNotSupportedCache = httpClient["sszNotSupportedByRouteIdByUrlIndex"].getOrDefault(0);

    const res1 = await httpClient.request(
      testPostDefinition,
      {payload: {a: true, b: 1}},
      {requestWireFormat: WireFormat.ssz}
    );

    expect(res1.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sszNotSupportedCache?.has(routeId)).toBe(true);

    // Subsequent requests should always use JSON
    const res2 = await httpClient.request(
      testPostDefinition,
      {payload: {a: true, b: 1}},
      {requestWireFormat: WireFormat.ssz}
    );

    expect(res2.ok).toBe(true);
    // Call count should only be incremented by 1, no retry
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("should handle http status code 500 correctly", async () => {
    const httpClient = await getServerWithClient({
      ...testRoute,
      handler: async () => {
        throw Error("Test error");
      },
    });

    const res = await httpClient.request(testDefinition, {});

    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);

    expect(res.error()?.message).toBe("testRoute failed with status 500: Test error");
  });

  it("should handle http status with custom code 503", async () => {
    const httpClient = await getServerWithClient({
      ...testRoute,
      handler: async (_req, res) => {
        return res.code(503).send("Node is syncing");
      },
    });

    const res = await httpClient.request(testDefinition, {});

    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);

    expect(res.error()?.message).toBe("testRoute failed with status 503: Node is syncing");
  });

  it("should send a SSZ-serialized request if configured as wire format", async () => {
    const container = new ContainerType({
      a: new BooleanType(),
      b: new UintNumberType(1),
    });

    type TestEndpoint = Endpoint<
      "POST",
      {payload: ValueOf<typeof container>},
      {body: unknown},
      EmptyResponseData,
      EmptyMeta
    >;

    const url = "/test-ssz-wire-format";
    const routeId = "testSszWireFormat";
    const testPostDefinition: RouteDefinitionExtra<TestEndpoint> = {
      url,
      method: "POST",
      req: {
        writeReqJson: ({payload}) => ({body: container.toJson(payload)}),
        parseReqJson: ({body}) => ({payload: container.fromJson(body)}),
        writeReqSsz: ({payload}) => ({body: container.serialize(payload)}),
        parseReqSsz: ({body}) => ({payload: container.deserialize(body)}),
        schema: {
          body: Schema.Object,
        },
      },
      resp: EmptyResponseCodec,
      operationId: routeId,
      urlFormatter: compileRouteUrlFormatter(url),
    };
    const payload = {a: true, b: 1};

    const httpClient = await getServerWithClient({
      url,
      method: "POST",
      handler: async (req) => {
        expect(req.headers[HttpHeader.ContentType]).toBe(MediaType.ssz);
        expect(req.body).toBeInstanceOf(Uint8Array);
        expect(container.deserialize(req.body as Uint8Array)).toEqual(payload);
      },
    });

    (await httpClient.request(testPostDefinition, {payload}, {requestWireFormat: WireFormat.ssz})).assertOk();
  });

  it("should send a JSON-serialized request if configured as wire format", async () => {
    const container = new ContainerType({
      a: new BooleanType(),
      b: new UintNumberType(1),
    });

    type TestEndpoint = Endpoint<
      "POST",
      {payload: ValueOf<typeof container>},
      {body: unknown},
      EmptyResponseData,
      EmptyMeta
    >;

    const url = "/test-json-wire-format";
    const routeId = "testJsonWireFormat";
    const testPostDefinition: RouteDefinitionExtra<TestEndpoint> = {
      url,
      method: "POST",
      req: {
        writeReqJson: ({payload}) => ({body: container.toJson(payload)}),
        parseReqJson: ({body}) => ({payload: container.fromJson(body)}),
        writeReqSsz: ({payload}) => ({body: container.serialize(payload)}),
        parseReqSsz: ({body}) => ({payload: container.deserialize(body)}),
        schema: {
          body: Schema.Object,
        },
      },
      resp: EmptyResponseCodec,
      operationId: routeId,
      urlFormatter: compileRouteUrlFormatter(url),
    };
    const payload = {a: true, b: 1};

    const httpClient = await getServerWithClient({
      url,
      method: "POST",
      handler: async (req) => {
        expect(req.headers[HttpHeader.ContentType]).toBe(MediaType.json);
        expect(req.body).toBeInstanceOf(Object);
        expect(container.fromJson(req.body)).toEqual(payload);
      },
    });

    (await httpClient.request(testPostDefinition, {payload}, {requestWireFormat: WireFormat.json})).assertOk();
  });

  it("should set user credentials in URL as Authorization header", async () => {
    const {baseUrl} = await getServer({
      ...testRoute,
      handler: async (req) => {
        expect(req.headers.authorization).toBe("Basic dXNlcjpwYXNzd29yZA==");
        return {};
      },
    });
    const url = new URL(baseUrl);
    url.username = "user";
    url.password = "password";
    const httpClient = new HttpClient({baseUrl: url.toString()});

    (await httpClient.request(testDefinition, {})).assertOk();
  });

  it("should not URI-encode user credentials in Authorization header", async () => {
    // Semi exhaustive set of characters that RFC-3986 allows in the userinfo portion of a URI
    // Notably absent is `%`. See comment on isValidHttpUrl().
    const username = "A1-._~!$'&\"()*+,;=";
    const password = "b2-._~!$'&\"()*+,;=";
    let {baseUrl} = await getServer({
      ...testRoute,
      handler: async (req) => {
        expect(req.headers.authorization).toBe(`Basic ${toBase64(`${username}:${password}`)}`);
        return {};
      },
    });
    // Since `new URL()` is what URI-encodes, we have to do string manipulation to set the username/password
    // First validate the assumption that the URL starts with http://
    expect(baseUrl.indexOf("http://")).toBe(0);
    // We avoid using baseUrl.replace() because it treats $ as a special character
    baseUrl = `http://${username}:${password}@${baseUrl.substring("http://".length)}`;

    const httpClient = new HttpClient({baseUrl: baseUrl});

    (await httpClient.request(testDefinition, {})).assertOk();
  });

  it("should handle aborting request with timeout", async () => {
    const {baseUrl} = await getServer({
      ...testRoute,
      handler: async () => new Promise((r) => setTimeout(r, 1000)),
    });

    const httpClient = new HttpClient({baseUrl, globalInit: {timeoutMs: 10}});

    try {
      await httpClient.request(testDefinition, {});
      return Promise.reject(Error("did not throw"));
    } catch (e) {
      if (!(e instanceof TimeoutError)) throw Error(`Not an TimeoutError: ${(e as Error).message}`);
    }
  });

  it("should handle aborting all request with general AbortController", async () => {
    const {baseUrl} = await getServer({
      ...testRoute,
      handler: async () => new Promise((r) => setTimeout(r, 1000)),
    });

    const controller = new AbortController();
    const httpClient = new HttpClient({baseUrl, globalInit: {signal: controller.signal}});

    setTimeout(() => controller.abort(), 10);

    try {
      await httpClient.request(testDefinition, {});
      return Promise.reject(Error("did not throw"));
    } catch (e) {
      if (!(e instanceof ErrorAborted)) throw Error(`Not an ErrorAborted: ${(e as Error).message}`);
    }
  });
});
