import {FastifyInstance} from "fastify";
import {ApiNamespace} from "../../impl";
import {beaconRoutes} from "./beacon";
import {configRoutes} from "./config";
import {debugRoutes} from "./debug";
import {eventsRoutes} from "./events";
import {lodestarRoutes} from "./lodestar";
import {nodeRoutes} from "./node";
import {ApiController} from "./types";
import {validatorRoutes} from "./validator";

const routesGroups = [
  {prefix: "/v1/beacon", namespace: ApiNamespace.BEACON, routes: beaconRoutes},
  {prefix: "/v1/config", namespace: ApiNamespace.CONFIG, routes: configRoutes},
  {prefix: "/v1/debug", namespace: ApiNamespace.DEBUG, routes: debugRoutes},
  {prefix: "/v1/events", namespace: ApiNamespace.EVENTS, routes: eventsRoutes},
  {prefix: "/v1/lodestar", namespace: ApiNamespace.LODESTAR, routes: lodestarRoutes},
  {prefix: "/v1/node", namespace: ApiNamespace.NODE, routes: nodeRoutes},
  {prefix: "/v1/validator", namespace: ApiNamespace.VALIDATOR, routes: validatorRoutes},
];

export function registerRoutes(server: FastifyInstance, enabledNamespaces: ApiNamespace[]): void {
  server.register(
    async function (fastify) {
      for (const {prefix, namespace, routes} of routesGroups) {
        if (enabledNamespaces.includes(namespace)) {
          registerRoutesToServer(fastify, routes, prefix);
        }
      }
    },
    {prefix: "/eth"}
  );
}

function registerRoutesToServer(
  server: FastifyInstance,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routes: ApiController<any, any>[],
  prefix: string
): void {
  server.register(
    async function (fastify) {
      for (const route of routes) {
        fastify.route({
          url: route.url,
          method: route.method,
          handler: route.handler,
          schema: route.schema,
        });
      }
    },
    {prefix}
  );
}
