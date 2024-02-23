import {it, expect, MockInstance, describe, beforeAll, afterAll} from "vitest";
import {FastifyInstance} from "fastify";
import {ChainForkConfig} from "@lodestar/config";
import {ReqGeneric, Resolves} from "../../src/utils/index.js";
import {FetchOpts, HttpClient, IHttpClient} from "../../src/utils/client/index.js";
import {ServerRoutes} from "../../src/utils/server/genericJsonServer.js";
import {registerRoute} from "../../src/utils/server/registerRoute.js";
import {HttpStatusCode} from "../../src/utils/client/httpStatusCode.js";
import {APIClientHandler, ApiClientResponseData, ServerApi} from "../../src/interfaces.js";
import {getMockApi, getTestServer} from "./utils.js";

type IgnoreVoid<T> = T extends void ? undefined : T;

export type GenericServerTestCases<Api extends Record<string, APIClientHandler>> = {
  [K in keyof Api]: {
    args: Parameters<Api[K]>;
    res: IgnoreVoid<ApiClientResponseData<Resolves<Api[K]>>>;
    query?: FetchOpts["query"];
  };
};

export function runGenericServerTest<
  Api extends Record<string, APIClientHandler>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric},
>(
  config: ChainForkConfig,
  getClient: (config: ChainForkConfig, https: IHttpClient) => Api,
  getRoutes: (config: ChainForkConfig, api: ServerApi<Api>) => ServerRoutes<ServerApi<Api>, ReqTypes>,
  testCases: GenericServerTestCases<Api>
): void {
  const mockApi = getMockApi<Api>(testCases);
  let server: FastifyInstance;

  let client: Api;
  let httpClient: HttpClientSpy;

  beforeAll(async () => {
    const res = getTestServer();
    server = res.server;

    for (const route of Object.values(getRoutes(config, mockApi))) {
      registerRoute(server, route);
    }

    const baseUrl = await res.start();
    httpClient = new HttpClientSpy({baseUrl});
    client = getClient(config, httpClient);
  });

  afterAll(async () => {
    if (server !== undefined) await server.close();
  });

  describe("run generic server tests", () => {
    it.each(Object.keys(testCases))("%s", async (key) => {
      const routeId = key as keyof Api;
      const testCase = testCases[routeId];

      // Register mock data for this route
      // TODO: Look for the type error
      (mockApi[routeId] as MockInstance).mockResolvedValue(testCases[routeId].res);

      // Do the call
      const res = await client[routeId](...(testCase.args as any[]));

      // Use spy to assert argument serialization
      if (testCase.query) {
        expect(httpClient.opts?.query).toEqual(testCase.query);
      }

      // Assert server handler called with correct args
      expect(mockApi[routeId] as MockInstance).toHaveBeenCalledTimes(1);

      // if mock api args are > testcase args, there may be some undefined extra args parsed towards the end
      // to obtain a match, ignore the extra args
      expect(mockApi[routeId] as MockInstance).toHaveBeenNthCalledWith(1, ...(testCase.args as any[]));

      // Assert returned value is correct
      expect(res.response).toEqual(testCase.res);
    });
  });
}

class HttpClientSpy extends HttpClient {
  opts: FetchOpts | null = null;

  async json<T>(opts: FetchOpts): Promise<{status: HttpStatusCode; body: T}> {
    this.opts = opts;
    return super.json(opts);
  }
  async arrayBuffer(opts: FetchOpts): Promise<{status: HttpStatusCode; body: ArrayBuffer}> {
    this.opts = opts;
    return super.arrayBuffer(opts);
  }

  async request(opts: FetchOpts): Promise<{status: HttpStatusCode; body: void}> {
    this.opts = opts;
    return super.request(opts);
  }
}
