import {Json} from "@chainsafe/ssz";
import {mapValues} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {compileRouteUrlFormater} from "./urlFormat";
import {RouteDef, ReqGeneric, RouteGeneric, ReturnTypes, TypeJson, jsonOpts, RouteGroupDefinition} from "./types";

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

export function toUint(val: string | number): number {
  if (typeof val === "number") return val;
  else return parseInt(val, 10);
}

export type FetchOpts = {
  url: RouteDef["url"];
  method: RouteDef["method"];
  query: ReqGeneric["query"];
  body: ReqGeneric["body"];
};
export type FetchFn = <T>(opts: FetchOpts) => Promise<T>;

export function getGenericClient<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(
  {routesData, getReqSerdes, getReturnTypes}: RouteGroupDefinition<Api, ReqTypes>,
  config: IBeaconConfig,
  fetchFn: FetchFn
): Api {
  const reqSerdes = getReqSerdes(config);
  const returnTypes = getReturnTypes(config);

  return mapValues(routesData, (routeDef, routeKey) => {
    const urlFormater = compileRouteUrlFormater(routeDef.url);
    const routeSerdes = reqSerdes[routeKey];
    const returnType = returnTypes[routeKey as keyof ReturnTypes<Api>] as TypeJson<any> | null;

    return async function request(...args: Parameters<Api[keyof Api]>): Promise<any | void> {
      const req = routeSerdes.writeReq(...args);
      const res = await fetchFn<Json>({
        url: urlFormater(req.params || {}),
        method: routeDef.method,
        query: req.query,
        body: req.body as unknown,
      });
      if (returnType) {
        return returnType.fromJson(res, jsonOpts) as ReturnType<Api[keyof Api]>;
      }
    };
  }) as Api;
}
