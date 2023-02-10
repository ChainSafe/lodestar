import {mapValues} from "@lodestar/utils";
import {compileRouteUrlFormater} from "../urlFormat.js";
import {RouteDef, ReqGeneric, ReturnTypes, TypeJson, ReqSerializer, ReqSerializers, RoutesData} from "../types.js";
import {APIClientHandler} from "../../interfaces.js";
import {FetchOpts, HttpError, IHttpClient} from "./httpClient.js";

// See /packages/api/src/routes/index.ts for reasoning

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Format FetchFn opts from Fn arguments given a route definition and request serializer.
 * For routes that return only JSOn use @see getGenericJsonClient
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function getFetchOptsSerializer<Fn extends (...args: any) => any, ReqType extends ReqGeneric>(
  routeDef: RouteDef,
  reqSerializer: ReqSerializer<Fn, ReqType>,
  routeId: string
) {
  const urlFormater = compileRouteUrlFormater(routeDef.url);

  return function getFetchOpts(...args: Parameters<Fn>): FetchOpts {
    const req = reqSerializer.writeReq(...args);
    return {
      url: urlFormater(req.params || {}),
      method: routeDef.method,
      query: req.query,
      body: req.body as unknown,
      headers: req.headers,
      routeId,
    };
  };
}

/**
 * Generate `getFetchOptsSerializer()` functions for all routes in `Api`
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function getFetchOptsSerializers<
  Api extends Record<string, APIClientHandler>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(routesData: RoutesData<Api>, reqSerializers: ReqSerializers<Api, ReqTypes>) {
  return mapValues(routesData, (routeDef, routeId) =>
    getFetchOptsSerializer(routeDef, reqSerializers[routeId], routeId as string)
  );
}

/**
 * Get a generic JSON client from route definition, request serializer and return types.
 */
export function generateGenericJsonClient<
  Api extends Record<string, APIClientHandler>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(
  routesData: RoutesData<Api>,
  reqSerializers: ReqSerializers<Api, ReqTypes>,
  returnTypes: ReturnTypes<Api>,
  fetchFn: IHttpClient
): Api {
  return (mapValues(routesData, (routeDef, routeId) => {
    const fetchOptsSerializer = getFetchOptsSerializer(routeDef, reqSerializers[routeId], routeId as string);
    const returnType = returnTypes[routeId as keyof ReturnTypes<Api>] as TypeJson<any> | null;

    return async function request(...args: Parameters<Api[keyof Api]>): Promise<ReturnType<Api[keyof Api]>> {
      try {
        if (returnType) {
          const res = await fetchFn.json<unknown>(fetchOptsSerializer(...args));
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          return {ok: true, response: returnType.fromJson(res.body), status: res.status} as ReturnType<Api[keyof Api]>;
        } else {
          // We need to avoid parsing the response as the servers might just
          // response status 200 and close the request instead of writing an
          // empty json response. We return the status code.
          const res = await fetchFn.request(fetchOptsSerializer(...args));

          return {ok: true, response: undefined, status: res.status} as ReturnType<Api[keyof Api]>;
        }
      } catch (err) {
        if (err instanceof HttpError) {
          return {ok: false, error: {code: err.status, message: err.message, operationId: routeId}} as ReturnType<
            Api[keyof Api]
          >;
        }

        throw err;
      }
    };
  }) as unknown) as Api;
}
