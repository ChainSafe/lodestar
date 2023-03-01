// eslint-disable-next-line import/no-extraneous-dependencies
import {FastifyInstance} from "fastify";
// eslint-disable-next-line import/no-extraneous-dependencies
import * as fastify from "fastify";
import {ReqGeneric} from "../types.js";

export type ServerInstance = FastifyInstance;

export type RouteConfig = {
  operationId: ServerRoute["id"];
};

export type ServerRoute<Req extends ReqGeneric = ReqGeneric> = {
  url: string;
  method: fastify.HTTPMethods;
  handler: FastifyHandler<Req>;
  schema?: fastify.FastifySchema;
  /** OperationId as defined in https://github.com/ethereum/beacon-APIs/blob/v2.1.0/apis/beacon/blocks/attestations.yaml#L2 */
  id: string;
};

/* eslint-disable @typescript-eslint/naming-convention */

/** Adaptor for Fastify v3.x.x route type which has a ton of arguments */
export type FastifyHandler<Req extends ReqGeneric> = fastify.RouteHandlerMethod<
  fastify.RawServerDefault,
  fastify.RawRequestDefaultExpression<fastify.RawServerDefault>,
  fastify.RawReplyDefaultExpression<fastify.RawServerDefault>,
  {
    Body: Req["body"];
    Querystring: Req["query"];
    Params: Req["params"];
  },
  fastify.ContextConfigDefault
>;
