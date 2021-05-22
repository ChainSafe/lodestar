import {Api} from "@chainsafe/lodestar-api";
import {ReqGeneric} from "@chainsafe/lodestar-api/lib/utils";
import {IncomingMessage, Server, ServerResponse} from "http";
import {
  DefaultBody,
  DefaultHeaders,
  DefaultParams,
  DefaultQuery,
  HTTPMethod,
  RequestHandler,
  RouteShorthandOptions,
} from "fastify";

// eslint-disable-next-line @typescript-eslint/naming-convention
export type ApiController<
  Query = DefaultQuery,
  Params = DefaultParams,
  Body = DefaultBody,
  Headers = DefaultHeaders
> = {
  url: string;
  method: HTTPMethod;
  handler: RequestHandler<IncomingMessage, ServerResponse, Query, Params, Headers, Body>;
  schema?: RouteShorthandOptions<Server, IncomingMessage, ServerResponse, Query, Params, Headers, Body>["schema"];
  /** OperationId as defined in https://github.com/ethereum/eth2.0-APIs/blob/18cb6ff152b33a5f34c377f00611821942955c82/apis/beacon/blocks/attestations.yaml#L2 */
  id: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiControllerGeneric = ApiController<any, any, any, any>;

export type ApiControllers<Api extends Record<string, unknown>, ReqTypes extends {[K in keyof Api]: ReqGeneric}> = {
  [K in keyof Api]: ApiController<ReqTypes[K]["query"], ReqTypes[K]["params"], ReqTypes[K]["body"]>;
};

export enum HttpHeader {
  ACCEPT = "accept",
  CONTENT_TYPE = "Content-Type",
}

export enum MimeTypes {
  SSZ = "application/octet-stream",
}

export type RouteConfig = {
  operationId: ApiController["id"];
};

export type ApiNamespace = keyof Api;
export const apiNamespaces: ApiNamespace[] = [
  "beacon",
  "validator",
  "node",
  "events",
  "debug",
  "config",
  "lightclient",
  "lodestar",
];
