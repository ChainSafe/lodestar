import {mapValues} from "@lodestar/utils";
import type * as fastify from "fastify";
import {getFastifySchema} from "../schema.js";
import {Endpoint, RouteDefinition, RouteDefinitions} from "../types.js";
import {toColonNotationPath} from "../urlFormat.js";
import {FastifyHandler, createFastifyHandler} from "./handler.js";
import {ApplicationMethod, ApplicationMethods} from "./method.js";

export type FastifySchema = fastify.FastifySchema & {
  operationId: string;
  tags?: string[];
};

export type FastifyRoute<E extends Endpoint> = {
  url: string;
  method: fastify.HTTPMethods;
  handler: FastifyHandler<E>;
  schema: FastifySchema;
};
export type FastifyRoutes<Es extends Record<string, Endpoint>> = {[K in keyof Es]: FastifyRoute<Es[K]>};

export function createFastifyRoute<E extends Endpoint>(
  definition: RouteDefinition<E>,
  method: ApplicationMethod<E>,
  operationId: string
): FastifyRoute<E> {
  return {
    url: toColonNotationPath(definition.url),
    method: definition.method,
    handler: createFastifyHandler(definition, method, operationId),
    schema: {
      ...getFastifySchema(definition.req.schema),
      operationId,
    },
  };
}

export function createFastifyRoutes<Es extends Record<string, Endpoint>>(
  definitions: RouteDefinitions<Es>,
  methods: ApplicationMethods<Es>
): FastifyRoutes<Es> {
  return mapValues(definitions, (definition, operationId) =>
    createFastifyRoute(definition, methods?.[operationId]?.bind(methods), operationId as string)
  );
}
