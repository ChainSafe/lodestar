import {Json} from "@chainsafe/ssz";
import {mapValues} from "@chainsafe/lodestar-utils";
import {
  ReqGeneric,
  RouteGeneric,
  RoutesData,
  ReturnTypes,
  TypeJson,
  Resolves,
  jsonOpts,
  RouteReqSerdes,
  RouteDef,
} from "./types";
import {getFastifySchema} from "./schema";

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

export type GenericServerRoute = {
  url: RouteDef["url"];
  method: RouteDef["method"];
  handler: (req: ReqGeneric) => Promise<Json | void>;
  schema?: Record<string, any>;
  /** OperationId as defined in https://github.com/ethereum/eth2.0-APIs/blob/18cb6ff152b33a5f34c377f00611821942955c82/apis/beacon/blocks/attestations.yaml#L2 */
  id: string;
};

export function getGenericServer<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(
  routesData: RoutesData<Api>,
  reqsSerdes: RouteReqSerdes<Api, ReqTypes>,
  returnTypes: ReturnTypes<Api>,
  api: Api
): {[K in keyof Api]: GenericServerRoute} {
  return mapValues(routesData, (routeDef, routeKey) => {
    const reqSerdes = reqsSerdes[routeKey];
    const returnType = returnTypes[routeKey as keyof ReturnTypes<Api>] as TypeJson<any> | null;

    return {
      url: routeDef.url,
      method: routeDef.method,
      id: routeKey as string,
      schema: reqSerdes.schema && getFastifySchema(reqSerdes.schema),

      handler: async function handler(req: ReqGeneric): Promise<Json | void> {
        const args: any[] = reqSerdes.parseReq(req as ReqTypes[keyof Api]);
        const data = (await api[routeKey](...args)) as Resolves<Api[keyof Api]>;
        if (returnType) {
          return returnType.toJson(data, jsonOpts);
        }
      },
    };
  });
}
