import {ServerInstance, RouteConfig, ServerRoute} from "./types.js";

export function registerRoute(
  server: ServerInstance,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  route: ServerRoute<any>,
  namespace?: string
): void {
  server.route({
    url: route.url,
    method: route.method,
    handler: route.handler,
    // append the namespace as a tag for downstream consumption of our API schema, eg: for swagger UI
    schema: {...route.schema, ...(namespace ? {tags: [namespace]} : undefined), operationId: route.id},
    config: {operationId: route.id} as RouteConfig,
  });
}
