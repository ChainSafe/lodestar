import Sinon from "sinon";
import {expect} from "chai";
import {mapValues} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {RouteGeneric, ReqGeneric, Resolves, RouteGroupDefinition, getGenericClient} from "../../src/utils";
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
  routesGroupDef: RouteGroupDefinition<Api, ReqTypes>,
  testCases: GenericServerTestCases<Api>
): void {
  const mockApi = mapValues(routesGroupDef.routesData, () => Sinon.stub()) as Sinon.SinonStubbedInstance<Api> & Api;
  const {baseUrl} = getTestServer<Api, ReqTypes>(routesGroupDef, config, mockApi);
  const fetchFn = getFetchFn(baseUrl);
  const client = getGenericClient<Api, ReqTypes>(routesGroupDef, config, fetchFn);

  for (const key of Object.keys(testCases)) {
    const routeId = key as keyof Api;
    const testCase = testCases[routeId];

    it(routeId as string, async () => {
      mockApi[routeId].reset();

      // Register mock data
      mockApi[routeId].resolves(testCase.res as any);

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
