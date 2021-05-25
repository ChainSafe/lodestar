import {Json} from "@chainsafe/ssz";
import {mapValues} from "@chainsafe/lodestar-utils";
import {
  ReqGeneric,
  RouteGeneric,
  ReturnTypes,
  TypeJson,
  Resolves,
  jsonOpts,
  RouteDef,
  RouteGroupDefinition,
} from "./types";
import {getFastifySchema} from "./schema";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Reasoning of the API definitions

// api args => req params
// --- wire
// req params => api args
// --- exec api
// api return => res body
// --- wire
// res body => api return

// Server has to know:
// - req params => api args
// - api return => res body

// Client has to know:
// - api args => req params
// - res body => api return

// Extra things to consider
// - The debug state route returns a bytes stream
// - The events routes return Server Events not a JSON HTTP response
// - There are v1 and v2 routes that should be merge in one handler

// For a returned JSON value, we don't really need the SSZ type
// - need to convert camelCase to snake_case when sending
// - need to convert from snake_case to camelCase when receiving
// - need to convert BigInt, 0x01 to bytes, etc.
// ?? - Define a return SSZ type for the routes that need it?

export type GenericServerRoute<Req extends ReqGeneric = ReqGeneric> = {
  url: RouteDef["url"];
  method: RouteDef["method"];
  handler: (req: Req) => Promise<Json | void>;
  schema?: Record<string, any>;
  /** OperationId as defined in https://github.com/ethereum/eth2.0-APIs/blob/18cb6ff152b33a5f34c377f00611821942955c82/apis/beacon/blocks/attestations.yaml#L2 */
  id: string;
};

export function getGenericServer<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(
  {routesData, getReqSerdes, getReturnTypes}: RouteGroupDefinition<Api, ReqTypes>,
  config: IBeaconConfig,
  api: Api
): {[K in keyof Api]: GenericServerRoute<ReqTypes[K]>} {
  const reqSerdes = getReqSerdes(config);
  const returnTypes = getReturnTypes(config);

  return mapValues(routesData, (routeDef, routeKey) => {
    const routeSerdes = reqSerdes[routeKey];
    const returnType = returnTypes[routeKey as keyof ReturnTypes<Api>] as TypeJson<any> | null;

    return {
      url: routeDef.url,
      method: routeDef.method,
      id: routeKey as string,
      schema: routeSerdes.schema && getFastifySchema(routeSerdes.schema),

      handler: async function handler(req: ReqGeneric): Promise<Json | void> {
        const args: any[] = routeSerdes.parseReq(req as ReqTypes[keyof Api]);
        const data = (await api[routeKey](...args)) as Resolves<Api[keyof Api]>;
        if (returnType) {
          return returnType.toJson(data, jsonOpts);
        }
      },
    };
  });
}
