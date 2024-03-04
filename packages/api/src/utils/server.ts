/* eslint-disable @typescript-eslint/naming-convention */
import type * as fastify from "fastify";
import {mapValues} from "@lodestar/utils";
import {ApiError} from "./error.js";
import {
  Endpoint,
  GetRequestCodec,
  GetRequestData,
  HasOnlyOptionalProps,
  JsonPostRequestData,
  PostRequestCodec,
  RouteDefinition,
  RouteDefinitions,
  SszPostRequestData,
} from "./types.js";
import {MediaType, WireFormat, getWireFormat, parseAcceptHeader, parseContentTypeHeader} from "./headers.js";
import {toColonNotationPath} from "./urlFormat.js";
import {getFastifySchema} from "./schema.js";
import {EmptyMeta, EmptyResponseData} from "./codecs.js";

type ApplicationResponseObject<E extends Endpoint> = {
  status?: number;
} & (E["return"] extends EmptyResponseData
  ? {data?: never}
  : {data: E["return"] | (E["return"] extends undefined ? undefined : Uint8Array)}) &
  (E["meta"] extends EmptyMeta ? {meta?: never} : {meta: E["meta"]});

export type ApplicationResponse<E extends Endpoint> = HasOnlyOptionalProps<ApplicationResponseObject<E>> extends true
  ? ApplicationResponseObject<E> | void
  : ApplicationResponseObject<E>;

// TODO: what's the purpose of this?
export type ApplicationError = ApiError | Error;

type GenericOptions = Record<string, unknown>;

export type ApplicationMethod<E extends Endpoint> = (
  args: E["args"],
  opts?: GenericOptions
) => Promise<ApplicationResponse<E>>;
export type ApplicationMethods<Es extends Record<string, Endpoint>> = {[K in keyof Es]: ApplicationMethod<Es[K]>};

export type FastifyHandler<E extends Endpoint> = fastify.RouteHandlerMethod<
  fastify.RawServerDefault,
  fastify.RawRequestDefaultExpression<fastify.RawServerDefault>,
  fastify.RawReplyDefaultExpression<fastify.RawServerDefault>,
  {
    Body: E["request"] extends JsonPostRequestData ? E["request"]["body"] : undefined;
    Querystring: E["request"]["query"];
    Params: E["request"]["params"];
    Headers: E["request"]["headers"];
  },
  fastify.ContextConfigDefault
>;

export type FastifyRouteConfig = fastify.FastifyContextConfig & {
  operationId: string;
};

export type FastifySchema = fastify.FastifySchema & {
  operationId: string;
  tags?: string[];
};

export type FastifyRoute<E extends Endpoint> = {
  url: string;
  method: fastify.HTTPMethods;
  handler: FastifyHandler<E>;
  schema: FastifySchema;
  config: FastifyRouteConfig;
};
export type FastifyRoutes<Es extends Record<string, Endpoint>> = {[K in keyof Es]: FastifyRoute<Es[K]>};

export function createFastifyHandler<E extends Endpoint>(
  definition: RouteDefinition<E>,
  method: ApplicationMethod<E>,
  operationId: string
): FastifyHandler<E> {
  return async (req, resp) => {
    let response: ApplicationResponse<E>;
    if (definition.method === "GET") {
      response = await method((definition.req as GetRequestCodec<E>).parseReq(req as GetRequestData));
    } else {
      // const contentType = req.headers["content-type"];
      const mediaType = parseContentTypeHeader(req.headers["content-type"]);
      // if (mediaType === null) {
      //   throw new ServerApiError(415, `Unsupported request media type: ${contentType?.split(";", 1)[0]}`);
      // }

      // TODO: We might not need to validate request media types as this is already handled by Fastify
      const requestWireFormat = getWireFormat(mediaType as MediaType);
      switch (requestWireFormat) {
        case WireFormat.json:
          response = await method((definition.req as PostRequestCodec<E>).parseReqJson(req as JsonPostRequestData));
          break;
        case WireFormat.ssz:
          response = await method(
            (definition.req as PostRequestCodec<E>).parseReqSsz(req as SszPostRequestData<E["request"]>)
          );
          break;
      }
    }

    const acceptHeader = req.headers.accept;
    if (acceptHeader === undefined) {
      throw new ApiError("No Accept header found in request", 415, operationId);
    }

    const mediaType = parseAcceptHeader(acceptHeader);
    if (mediaType === null) {
      throw new ApiError(`Only unsupported media types are accepted: ${acceptHeader}`, 415, operationId);
    }

    const responseWireFormat = getWireFormat(mediaType);
    let wireResponse;
    switch (responseWireFormat) {
      case WireFormat.json: {
        void resp.header("content-type", "application/json");
        const data =
          response?.data instanceof Uint8Array
            ? definition.resp.data.toJson(definition.resp.data.deserialize(response.data, response.meta), response.meta)
            : definition.resp.data.toJson(response?.data, response?.meta);
        const meta = definition.resp.meta.toJson(response?.meta);
        if (definition.resp.transform) {
          return definition.resp.transform.toResponse(data, meta);
        }
        wireResponse = {
          data,
          ...(meta as object),
        };
        break;
      }
      case WireFormat.ssz: {
        const meta = definition.resp.meta.toHeadersObject(response?.meta);
        meta["content-type"] = "application/octet-stream";
        void resp.headers(meta);
        const data =
          response?.data instanceof Uint8Array
            ? response.data
            : definition.resp.data.serialize(response?.data, response?.meta);
        wireResponse = Buffer.from(data);
      }
    }
    if (response?.status !== undefined || definition.statusOk !== undefined) {
      resp.statusCode = response?.status ?? (definition.statusOk as number);
    }
    return wireResponse;
  };
}

export function createFastifyRoute<E extends Endpoint>(
  definition: RouteDefinition<E>,
  method: ApplicationMethod<E>,
  operationId: string
): FastifyRoute<E> {
  const url = toColonNotationPath(definition.url);
  return {
    url,
    method: definition.method,
    handler: createFastifyHandler(definition, method, operationId),
    schema: {
      ...getFastifySchema(definition.req.schema),
      operationId,
    },
    config: {url, method: definition.method, operationId},
  };
}

export function createFastifyRoutes<Es extends Record<string, Endpoint>>(
  definitions: RouteDefinitions<Es>,
  methods: ApplicationMethods<Es>
): FastifyRoutes<Es> {
  return mapValues(definitions, (definition, operationId) =>
    createFastifyRoute(definition, methods[operationId], operationId as string)
  );
}
