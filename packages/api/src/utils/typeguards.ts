import {Endpoint, GetRequestCodec, RouteDefinition} from "./types.js";

export function isRequestWithoutBody<E extends Endpoint>(
  definition: RouteDefinition<E>
): definition is RouteDefinition<E> & {req: GetRequestCodec<E>} {
  return definition.method === "GET" || definition.req.schema.body === undefined;
}
