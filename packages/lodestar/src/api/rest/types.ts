import {
  DefaultBody,
  DefaultHeaders,
  DefaultParams,
  DefaultQuery,
  HTTPMethod,
  RequestHandler,
  RouteShorthandOptions,
} from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface ApiController<
  Query = DefaultQuery,
  Params = DefaultParams,
  Body = DefaultBody,
  Headers = DefaultHeaders
> {
  url: string;
  method: HTTPMethod;
  handler: RequestHandler<IncomingMessage, ServerResponse, Query, Params, Headers, Body>;
  schema?: RouteShorthandOptions<Server, IncomingMessage, ServerResponse, Query, Params, Headers, Body>["schema"];
  /** OperationId as defined in https://github.com/ethereum/eth2.0-APIs/blob/18cb6ff152b33a5f34c377f00611821942955c82/apis/beacon/blocks/attestations.yaml#L2 */
  id: string;
}

export enum HttpHeader {
  ACCEPT = "accept",
  CONTENT_TYPE = "Content-Type",
}
