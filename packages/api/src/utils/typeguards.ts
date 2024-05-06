import {Endpoint, RequestWithoutBodyCodec, RouteDefinition} from "./types.js";

export function isRequestWithoutBody<E extends Endpoint>(
  definition: RouteDefinition<E>
): definition is RouteDefinition<E> & {req: RequestWithoutBodyCodec<E>} {
  return definition.method === "GET" || definition.req.schema.body === undefined;
}
