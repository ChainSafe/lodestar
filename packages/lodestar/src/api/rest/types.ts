import {ReqGeneric} from "@chainsafe/lodestar-api/lib/utils";
import {
  ContextConfigDefault,
  FastifySchema,
  HTTPMethods,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
  RouteHandlerMethod,
} from "fastify";

/* eslint-disable @typescript-eslint/naming-convention */

// eslint-disable-next-line @typescript-eslint/naming-convention
export type ApiController<Req extends ReqGeneric = ReqGeneric> = {
  url: string;
  method: HTTPMethods;
  handler: FastifyHandler<Req>;
  schema?: FastifySchema;
  /** OperationId as defined in https://github.com/ethereum/eth2.0-APIs/blob/18cb6ff152b33a5f34c377f00611821942955c82/apis/beacon/blocks/attestations.yaml#L2 */
  id: string;
};

type FastifyHandler<Req extends ReqGeneric> = RouteHandlerMethod<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  {
    Body: Req["body"];
    Querystring: Req["query"];
    Params: Req["params"];
  },
  ContextConfigDefault
>;

export type ApiControllers<Api extends Record<string, unknown>, ReqTypes extends {[K in keyof Api]: ReqGeneric}> = {
  // TODO: Use ReqTypes declarations
  [K in keyof Api]: ApiController<ReqTypes[K]>;
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
