import {Json} from "@chainsafe/ssz";
import {mapValues} from "@chainsafe/lodestar-utils";
// eslint-disable-next-line import/no-extraneous-dependencies
import * as fastify from "fastify";
import {
  ReqGeneric,
  RouteGeneric,
  ReturnTypes,
  TypeJson,
  Resolves,
  jsonOpts,
  RouteGroupDefinition,
} from "../../utils/types";
import {getFastifySchema} from "../../utils/schema";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */

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

export type ServerRoute<Req extends ReqGeneric = ReqGeneric> = {
  url: string;
  method: fastify.HTTPMethods;
  handler: FastifyHandler<Req>;
  schema?: fastify.FastifySchema;
  /** OperationId as defined in https://github.com/ethereum/eth2.0-APIs/blob/18cb6ff152b33a5f34c377f00611821942955c82/apis/beacon/blocks/attestations.yaml#L2 */
  id: string;
};

/** Adaptor for Fastify v3.x.x route type which has a ton of arguments */
type FastifyHandler<Req extends ReqGeneric> = fastify.RouteHandlerMethod<
  fastify.RawServerDefault,
  fastify.RawRequestDefaultExpression<fastify.RawServerDefault>,
  fastify.RawReplyDefaultExpression<fastify.RawServerDefault>,
  {
    Body: Req["body"];
    Querystring: Req["query"];
    Params: Req["params"];
  },
  fastify.ContextConfigDefault
>;

export type ServerRoutes<Api extends Record<string, RouteGeneric>, ReqTypes extends {[K in keyof Api]: ReqGeneric}> = {
  [K in keyof Api]: ServerRoute<ReqTypes[K]>;
};

export function getGenericJsonServer<
  Api extends Record<string, RouteGeneric>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric}
>(
  {routesData, getReqSerializers, getReturnTypes}: RouteGroupDefinition<Api, ReqTypes>,
  config: IBeaconConfig,
  api: Api
): ServerRoutes<Api, ReqTypes> {
  const reqSerializers = getReqSerializers(config);
  const returnTypes = getReturnTypes(config);

  return mapValues(routesData, (routeDef, routeKey) => {
    const routeSerdes = reqSerializers[routeKey];
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
        } else {
          return {};
        }
      },
    };
  });
}
