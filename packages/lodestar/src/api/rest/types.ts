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
}

export enum HttpHeader {
  ACCEPT = "accept",
  CONTENT_TYPE = "Content-Type",
}
