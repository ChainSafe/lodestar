import {IncomingMessage} from "node:http";
import {describe, it, afterEach, expect} from "vitest";
import fastify, {RouteOptions} from "fastify";
import {ErrorAborted, TimeoutError, toBase64} from "@lodestar/utils";
import {HttpClient, HttpError} from "../../../src/utils/client/index.js";
import {HttpStatusCode} from "../../../src/utils/client/httpStatusCode.js";

/* eslint-disable @typescript-eslint/return-await */

type User = {
  id?: number;
  name: string;
};

describe("httpClient json client", () => {
  const afterEachCallbacks: (() => Promise<any> | any)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  const testRoute = {url: "/test-route", method: "GET" as const};

  async function getServer(opts: RouteOptions): Promise<{baseUrl: string}> {
    const server = fastify({logger: false});
    server.route(opts);

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
    const url = "/test-get";
    const httpClient = await getServerWithClient({
      url,
      method: "GET",
      handler: async () => ({test: 1}),
    });

    const {body: resBody, status} = await httpClient.json<User>({url, method: "GET"});

    expect(status).toBe(HttpStatusCode.OK);
    expect(resBody).toEqual({test: 1});
  });

  it("should handle successful POST request correctly", async () => {
    const query = {a: "a", b: ["b1", "b2"]};
    const body = {c: 4};
    const resBody = {test: 1};
    let queryReceived: any;
    let bodyReceived: any;

    const url = "/test-post";
    const httpClient = await getServerWithClient({
      url,
      method: "POST",
      handler: async (req) => {
        queryReceived = req.query;
        bodyReceived = req.body;
        return resBody;
      },
    });

    const {body: resBodyReceived, status} = await httpClient.json<User>({url, method: "POST", query, body});

    expect(status).toBe(HttpStatusCode.OK);
    expect(resBodyReceived).toEqual(resBody);
    expect(queryReceived).toEqual(query);
    expect(bodyReceived).toEqual(body);
  });

  it("should handle http status code 404 correctly", async () => {
    const httpClient = await getServerWithClient({
      url: "/no-route",
      method: "GET",
      handler: async () => ({}),
    });

    try {
      await httpClient.json(testRoute);
      return Promise.reject(Error("did not throw")); // So it doesn't gets catch {}
    } catch (e) {
      if (!(e instanceof HttpError)) throw Error(`Not an HttpError: ${(e as Error).message}`);
      expect(e.message).toBe("Not Found: Route GET:/test-route not found");
      expect(e.status).toBe(404);
    }
  });

  it("should handle http status code 500 correctly", async () => {
    const httpClient = await getServerWithClient({
      ...testRoute,
      handler: async () => {
        throw Error("Test error");
      },
    });

    try {
      await httpClient.json(testRoute);
      return Promise.reject(Error("did not throw"));
    } catch (e) {
      if (!(e instanceof HttpError)) throw Error(`Not an HttpError: ${(e as Error).message}`);
      expect(e.message).toBe("Internal Server Error: Test error");
      expect(e.status).toBe(500);
    }
  });

  it("should handle http status with custom code 503", async () => {
    const httpClient = await getServerWithClient({
      ...testRoute,
      handler: async (req, res) => {
        return res.code(503).send("Node is syncing");
      },
    });

    try {
      await httpClient.json(testRoute);
      return Promise.reject(Error("did not throw"));
    } catch (e) {
      if (!(e instanceof HttpError)) throw Error(`Not an HttpError: ${(e as Error).message}`);
      expect(e.message).toBe("Service Unavailable: Node is syncing");
      expect(e.status).toBe(503);
    }
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

    await httpClient.json(testRoute);
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

    await httpClient.json(testRoute);
  });

  it("should handle aborting request with timeout", async () => {
    const {baseUrl} = await getServer({
      ...testRoute,
      handler: async () => new Promise((r) => setTimeout(r, 1000)),
    });

    const httpClient = new HttpClient({baseUrl, timeoutMs: 10});

    try {
      await httpClient.json(testRoute);
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
    const signal = controller.signal;
    const httpClient = new HttpClient({baseUrl, getAbortSignal: () => signal});

    setTimeout(() => controller.abort(), 10);

    try {
      await httpClient.json(testRoute);
      return Promise.reject(Error("did not throw"));
    } catch (e) {
      if (!(e instanceof ErrorAborted)) throw Error(`Not an ErrorAborted: ${(e as Error).message}`);
    }
  });
});
