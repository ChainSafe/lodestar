import {expect} from "chai";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {RouteGeneric, ReqGeneric, Resolves} from "../../src/utils";
import {HttpClient, IHttpClient} from "../../src/client/utils";
import {ServerRoutes} from "../../src/server/utils";
import {getMockApi, getTestServer} from "./utils";
import {registerRoutesGroup} from "../../src/server";

type IgnoreVoid<T> = T extends void ? undefined : T;

export type GenericServerTestCases<Api extends Record<string, RouteGeneric>> = {
  [K in keyof Api]: {
    args: Parameters<Api[K]>;
    res: IgnoreVoid<Resolves<Api[K]>>;
  };
};

export function runGenericServerTest<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(
  config: IChainForkConfig,
  getClient: (config: IChainForkConfig, https: IHttpClient) => Api,
  getRoutes: (config: IChainForkConfig, api: Api) => ServerRoutes<Api, ReqTypes>,
  testCases: GenericServerTestCases<Api>
): void {
  const mockApi = getMockApi<Api>(testCases);
  const {baseUrl, server} = getTestServer();

  const httpClient = new HttpClient({baseUrl});
  const client = getClient(config, httpClient);

  const routes = getRoutes(config, mockApi);
  registerRoutesGroup(server, routes);

  for (const key of Object.keys(testCases)) {
    const routeId = key as keyof Api;
    const testCase = testCases[routeId];

    it(routeId as string, async () => {
      // Register mock data for this route
      mockApi[routeId].resolves(testCases[routeId].res as any);

      // Do the call
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const res = await (client[routeId] as RouteGeneric)(...(testCase.args as any[]));

      // Assert server handler called with correct args
      expect(mockApi[routeId].callCount).to.equal(1, `mockApi[${routeId}] must be called once`);
      expect(mockApi[routeId].getCall(0).args).to.deep.equal(testCase.args, `mockApi[${routeId}] wrong args`);

      // Assert returned value is correct
      expect(res).to.deep.equal(testCase.res, "Wrong returned value");
    });
  }
}
