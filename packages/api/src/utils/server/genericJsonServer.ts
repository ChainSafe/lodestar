import type {FastifyInstance} from "fastify";
import {mapValues} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {ReqGeneric, TypeJson, RouteGroupDefinition} from "../types.js";
import {getFastifySchema} from "../schema.js";
import {toColonNotationPath} from "../urlFormat.js";
import {APIServerHandler} from "../../interfaces.js";
import {HttpStatusCode} from "../client/httpStatusCode.js";
import {ServerRoute} from "./types.js";

// See /packages/api/src/routes/index.ts for reasoning

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ServerRoutes<
  Api extends Record<string, APIServerHandler>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric},
> = {
  [K in keyof Api]: ServerRoute<ReqTypes[K]>;
};

export function getGenericJsonServer<
  Api extends Record<string, APIServerHandler>,
  ReqTypes extends {[K in keyof Api]: ReqGeneric},
>(
  {routesData, getReqSerializers, getReturnTypes}: RouteGroupDefinition<Api, ReqTypes>,
  config: ChainForkConfig,
  api: Api
): ServerRoutes<Api, ReqTypes> {
  const reqSerializers = getReqSerializers(config);
  const returnTypes = getReturnTypes(config);

  return mapValues(routesData, (routeDef, routeId) => {
    const routeSerdes = reqSerializers[routeId];
    const returnType = returnTypes[routeId as keyof typeof returnTypes] as TypeJson<any> | null;

    return {
      // Convert '/states/{state_id}' into '/states/:state_id'
      url: toColonNotationPath(routeDef.url),
      method: routeDef.method,
      id: routeId as string,
      schema: routeSerdes.schema && getFastifySchema(routeSerdes.schema),

      handler: async function handler(this: FastifyInstance, req, resp): Promise<unknown | void> {
        const args: any[] = routeSerdes.parseReq(req as ReqGeneric as ReqTypes[keyof Api]);

        // The type resolves here is `unknown | void | {status: number; response: unknown | void}`
        // which end up being just `unknown` in the end because of the `unknown | void` part
        const data = await api[routeId](...args, req, resp);

        const status =
          "status" in (data as {status: number; response: unknown})
            ? (data as {status: number; response: unknown}).status
            : routeDef.statusOk !== undefined
            ? routeDef.statusOk
            : HttpStatusCode.OK;

        const response =
          "status" in (data as {status: number; response: unknown})
            ? (data as {status: number; response: unknown}).response
            : data;

        resp.statusCode = status;

        if (returnType) {
          return returnType.toJson(response);
        } else {
          return {};
        }
      },
    };
  });
}
