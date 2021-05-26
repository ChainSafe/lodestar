import {Json} from "@chainsafe/ssz";
import {mapValues} from "@chainsafe/lodestar-utils";
import {compileRouteUrlFormater} from "../../utils/urlFormat";
import {
  RouteDef,
  ReqGeneric,
  RouteGeneric,
  ReturnTypes,
  TypeJson,
  jsonOpts,
  ReqSerializer,
  RouteReqSerdes,
  RoutesData,
} from "../../utils/types";

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
  query?: ReqGeneric["query"];
  body?: ReqGeneric["body"];
};
export type FetchFn = {
  json: <T>(opts: FetchOpts) => Promise<T>;
  arrayBuffer: (opts: FetchOpts) => Promise<ArrayBuffer>;
};

/**
 * Format FetchFn opts from Fn arguments given a route definition and request serializer.
 * For routes that return only JSOn use @see getGenericJsonClient
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getFetchOptsSerializer<Fn extends (...args: any) => any, ReqType extends ReqGeneric>(
  routeDef: RouteDef,
  reqSerializer: ReqSerializer<Fn, ReqType>
) {
  const urlFormater = compileRouteUrlFormater(routeDef.url);

  return function getFetchOpts(...args: Parameters<Fn>): FetchOpts {
    const req = reqSerializer.writeReq(...args);
    return {
      url: urlFormater(req.params || {}),
      method: routeDef.method,
      query: req.query,
      body: req.body as unknown,
    };
  };
}

/**
 * Generate `getFetchOptsSerializer()` functions for all routes in `Api`
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getFetchOptsSerializers<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(routesData: RoutesData<Api>, reqSerializers: RouteReqSerdes<Api, ReqTypes>) {
  return mapValues(routesData, (routeDef, routeKey) => getFetchOptsSerializer(routeDef, reqSerializers[routeKey]));
}

/**
 * Get a generic JSON client from route definition, request serializer and return types
 */
export function getGenericJsonClient<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(
  routesData: RoutesData<Api>,
  reqSerializers: RouteReqSerdes<Api, ReqTypes>,
  returnTypes: ReturnTypes<Api>,
  fetchFn: FetchFn
): Api {
  return mapValues(routesData, (routeDef, routeKey) => {
    const fetchOptsSerializer = getFetchOptsSerializer(routeDef, reqSerializers[routeKey]);
    const returnType = returnTypes[routeKey as keyof ReturnTypes<Api>] as TypeJson<any> | null;

    return async function request(...args: Parameters<Api[keyof Api]>): Promise<any | void> {
      const res = await fetchFn.json<Json>(fetchOptsSerializer(...args));
      if (returnType) {
        return returnType.fromJson(res, jsonOpts) as ReturnType<Api[keyof Api]>;
      }
    };
  }) as Api;
}
