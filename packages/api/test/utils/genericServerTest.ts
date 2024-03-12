import {it, expect, describe, beforeAll, afterAll, vi, MockInstance} from "vitest";
import {FastifyInstance} from "fastify";
import {ChainForkConfig} from "@lodestar/config";
import {Endpoint} from "../../src/utils/index.js";
import * as fetchObj from "../../src/utils/client/fetch.js";
import {ApplicationMethods, ApplicationResponse, FastifyRoutes} from "../../src/utils/server.js";
import {
  ApiClientMethods,
  HttpClient,
  HttpClientModules,
  HttpClientOptions,
  IHttpClient,
} from "../../src/utils/client/index.js";
import {getMockApi, getTestServer} from "./utils.js";

const fetchSpy = vi.spyOn(fetchObj, "fetch");

export type GenericServerTestCases<Es extends Record<string, Endpoint>> = {
  [K in keyof Es]: {
    args: Es[K]["args"];
    res: ApplicationResponse<Es[K]>;
    query?: Es[K]["request"]["query"]; //TODO: remove
  };
};

export function runGenericServerTest<Es extends Record<string, Endpoint>>(
  config: ChainForkConfig,
  getClient: (config: ChainForkConfig, http: IHttpClient) => ApiClientMethods<Es>,
  getRoutes: (config: ChainForkConfig, methods: ApplicationMethods<Es>) => FastifyRoutes<Es>,
  testCases: GenericServerTestCases<Es>
): void {
  const mockApi = getMockApi<Es>(testCases);
  let server: FastifyInstance;

  let client: ApiClientMethods<Es>;
  let httpClient: HttpClientSpy;

  beforeAll(async () => {
    const res = getTestServer();
    server = res.server;

    for (const route of Object.values(getRoutes(config, mockApi))) {
      server.route(route);
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
      const routeId = key as keyof Es;
      const testCase = testCases[routeId];

      // Register mock data for this route
      // TODO: Look for the type error
      (mockApi[routeId] as MockInstance).mockResolvedValue(testCases[routeId].res);

      // Do the call
      const res = await client[routeId](testCase.args ?? {});

      // Use spy to assert argument serialization
      if (testCase.query) {
        // TODO: is this needed, query param are already validator by args in spec tests
        expect(fetchSpy).toHaveBeenLastCalledWith(testCase.query);
      }

      // Assert server handler called with correct args
      expect(mockApi[routeId]).toHaveBeenCalledTimes(1);
      expect(mockApi[routeId]).toHaveBeenCalledWith(testCase.args);

      // Assert returned value and metadata is correct
      expect(await res.value()).toEqual(testCase.res?.data);
      expect(await res.meta()).toEqual(testCase.res?.meta);
    });
  });
}

class HttpClientSpy extends HttpClient {
  constructor(opts: HttpClientOptions, modules: HttpClientModules = {}) {
    super({...opts, fetch: fetchSpy.getMockImplementation()}, modules);
  }
}
