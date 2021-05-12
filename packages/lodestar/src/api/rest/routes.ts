import {FastifyInstance} from "fastify";
import {ApiNamespace} from "../impl";
import {beaconRoutes} from "./beacon";
import {configRoutes} from "./config";
import {debugRoutes} from "./debug";
import {eventsRoutes} from "./events";
import {lodestarRoutes} from "./lodestar";
import {nodeRoutes} from "./node";
import {ApiController, RouteConfig} from "./types";
import {validatorRoutes} from "./validator";

const routesGroups = [
  {namespace: ApiNamespace.BEACON, routes: beaconRoutes},
  {namespace: ApiNamespace.CONFIG, routes: configRoutes},
  {namespace: ApiNamespace.DEBUG, routes: debugRoutes},
  {namespace: ApiNamespace.EVENTS, routes: eventsRoutes},
  {namespace: ApiNamespace.LODESTAR, routes: lodestarRoutes},
  {namespace: ApiNamespace.NODE, routes: nodeRoutes},
  {namespace: ApiNamespace.VALIDATOR, routes: validatorRoutes},
];

export function registerRoutes(fastify: FastifyInstance, enabledNamespaces: ApiNamespace[]): void {
  for (const {namespace, routes} of routesGroups) {
    if (enabledNamespaces.includes(namespace)) {
      registerRoutesToServer(fastify, routes);
    }
  }
}

function registerRoutesToServer(
  fastify: FastifyInstance,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routes: ApiController<any, any>[]
): void {
  for (const route of routes) {
    fastify.route({
      url: route.url,
      method: route.method,
      handler: route.handler,
      schema: route.schema,
      config: {operationId: route.id} as RouteConfig,
    });
  }
}
