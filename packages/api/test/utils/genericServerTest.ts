import Sinon from "sinon";
import {expect} from "chai";
import {mapValues} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {RouteGeneric, ReqGeneric, Resolves} from "../../src/utils";
import {FetchFn} from "../../src/client/utils";
import {ServerRoutes} from "../../src/server/utils";
import {getFetchFn, getTestServer} from "./utils";

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
  config: IBeaconConfig,
  getClient: (config: IBeaconConfig, fetchFn: FetchFn) => Api,
  getRoutes: (config: IBeaconConfig, api: Api) => ServerRoutes<Api, ReqTypes>,
  testCases: GenericServerTestCases<Api>
): void {
  const mockApi = mapValues(testCases, () => Sinon.stub()) as Sinon.SinonStubbedInstance<Api> & Api;
  const {baseUrl, server} = getTestServer();

  const fetchFn = getFetchFn(baseUrl);
  const client = getClient(config, fetchFn);

  const routes = getRoutes(config, mockApi);
  for (const key of Object.keys(testCases)) {
    const routeId = key as keyof typeof routes;
    const route = routes[routeId];
    server.route({
      url: route.url,
      method: route.method,
      handler: route.handler,
      schema: route.schema,
    });

    // Register mock data for all routes
    mockApi[routeId].resolves(testCases[routeId].res as any);
  }

  for (const key of Object.keys(testCases)) {
    const routeId = key as keyof Api;
    const testCase = testCases[routeId];

    it(routeId as string, async () => {
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
