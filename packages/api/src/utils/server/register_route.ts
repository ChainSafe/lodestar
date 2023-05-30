import {ServerInstance, RouteConfig, ServerRoute} from "./types.js";

export function registerRoute(
  server: ServerInstance,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  route: ServerRoute<any>
): void {
  server.route({
    url: route.url,
    method: route.method,
    handler: route.handler,
    schema: route.schema,
    config: {operationId: route.id} as RouteConfig,
  });
}
