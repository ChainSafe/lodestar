import {ErrorAborted, TimeoutError} from "@chainsafe/lodestar-utils";
import {AbortController} from "@chainsafe/abort-controller";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import fastify, {RouteOptions} from "fastify";
import {IncomingMessage} from "node:http";
import {HttpClient, HttpError} from "../../../src/client/utils/index.js";

chai.use(chaiAsPromised);

interface IUser {
  id?: number;
  name: string;
}

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

    return {baseUrl: await server.listen(0)};
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

    const resBody: IUser = await httpClient.json<IUser>({url, method: "GET"});

    expect(resBody).to.deep.equal({test: 1}, "Wrong res body");
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

    const resBodyReceived: IUser = await httpClient.json<IUser>({url, method: "POST", query, body});

    expect(resBodyReceived).to.deep.equal(resBody, "Wrong resBody");
    expect(queryReceived).to.deep.equal(query, "Wrong query");
    expect(bodyReceived).to.deep.equal(body, "Wrong body");
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
      expect(e.message).to.equal("Not Found: Route GET:/test-route not found", "Wrong error message");
      expect(e.status).to.equal(404, "Wrong error status code");
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
      expect(e.message).to.equal("Internal Server Error: Test error");
      expect(e.status).to.equal(500, "Wrong error status code");
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
      expect(e.message).to.equal("Service Unavailable: Node is syncing");
      expect(e.status).to.equal(503, "Wrong error status code");
    }
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
