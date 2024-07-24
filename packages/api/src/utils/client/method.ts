import {mapValues} from "@lodestar/utils";
import {Endpoint, HasOnlyOptionalProps, RouteDefinition, RouteDefinitions} from "../types.js";
import {compileRouteUrlFormatter} from "../urlFormat.js";
import {IHttpClient} from "./httpClient.js";
import {ApiRequestInit} from "./request.js";
import {ApiResponse} from "./response.js";

export type ApiClientMethod<E extends Endpoint> = E["args"] extends void
  ? (init?: ApiRequestInit) => Promise<ApiResponse<E>>
  : HasOnlyOptionalProps<E["args"]> extends true
    ? (args?: E["args"], init?: ApiRequestInit) => Promise<ApiResponse<E>>
    : (args: E["args"], init?: ApiRequestInit) => Promise<ApiResponse<E>>;

export type ApiClientMethods<Es extends Record<string, Endpoint>> = {[K in keyof Es]: ApiClientMethod<Es[K]>};

export function createApiClientMethod<E extends Endpoint>(
  definition: RouteDefinition<E>,
  client: IHttpClient,
  operationId: string
): ApiClientMethod<E> {
  const urlFormatter = compileRouteUrlFormatter(definition.url);
  const definitionExtended = {
    ...definition,
    urlFormatter,
    operationId,
  };

  // If the request args is void, then completely remove the args parameter
  if (
    definition.req.schema.body === undefined &&
    definition.req.schema.params === undefined &&
    definition.req.schema.query === undefined
  ) {
    return (async (init?: ApiRequestInit) => {
      return client.request(definitionExtended, undefined, init);
    }) as ApiClientMethod<E>;
  }
  return async (args?: E["args"], init?: ApiRequestInit) => {
    return client.request(definitionExtended, args ?? {}, init);
  };
}

export function createApiClientMethods<Es extends Record<string, Endpoint>>(
  definitions: RouteDefinitions<Es>,
  client: IHttpClient
): ApiClientMethods<Es> {
  return mapValues(definitions, (definition, operationId) => {
    return createApiClientMethod(definition, client, operationId as string);
  }) as unknown as ApiClientMethods<Es>;
}
