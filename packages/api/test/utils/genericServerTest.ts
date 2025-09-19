import {ChainForkConfig} from "@lodestar/config";
import {FastifyInstance} from "fastify";
import {MockInstance, afterAll, beforeAll, describe, expect, it} from "vitest";
import {ApiClientMethods, ApiRequestInit, HttpClient, IHttpClient} from "../../src/utils/client/index.js";
import {Endpoint} from "../../src/utils/index.js";
import {ApplicationMethods, ApplicationResponse, FastifyRoutes} from "../../src/utils/server/index.js";
import {WireFormat} from "../../src/utils/wireFormat.js";
import {getMockApi, getTestServer} from "./utils.js";

export type GenericServerTestCases<Es extends Record<string, Endpoint>> = {
  [K in keyof Es]: {
    args: Es[K]["args"];
    res: ApplicationResponse<Es[K]>;
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
  let httpClient: HttpClient;

  beforeAll(async () => {
    const res = getTestServer();
    server = res.server;

    for (const route of Object.values(getRoutes(config, mockApi))) {
      server.route(route);
    }

    const baseUrl = await res.start();
    httpClient = new HttpClient({baseUrl});
    client = getClient(config, httpClient);
  });

  afterAll(async () => {
    if (server !== undefined) await server.close();
  });

  describe("run generic server tests", () => {
    describe.each(Object.keys(testCases))("%s", (key) => {
      it.each(Object.values(WireFormat))("%s", async (format) => {
        const wireFormat = format as WireFormat;
        const localInit: ApiRequestInit = {
          requestWireFormat: wireFormat,
          responseWireFormat: wireFormat,
        };
        const routeId = key as keyof Es;
        const testCase = testCases[routeId];

        // Register mock data for this route
        (mockApi[routeId] as MockInstance).mockResolvedValue(testCases[routeId].res);

        // Do the call
        const res = await client[routeId](testCase.args ?? localInit, localInit);

        // Assert server handler called with correct args
        expect(mockApi[routeId]).toHaveBeenCalledTimes(1);
        expect(mockApi[routeId]).toHaveBeenCalledWith(testCase.args, expect.any(Object));

        // Assert returned value and metadata is correct
        expect(res.value()).toEqual(testCase.res?.data);
        expect(res.meta()).toEqual(testCase.res?.meta);
      });
    });
  });
}
