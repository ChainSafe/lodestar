/* eslint-disable @typescript-eslint/naming-convention */
import type * as fastify from "fastify";
import {mapValues} from "@lodestar/utils";
import {ServerError} from "./error.js";
import {
  Endpoint,
  GetRequestCodec,
  GetRequestData,
  HasOnlyOptionalProps,
  JsonPostRequestData,
  JsonRequestMethods,
  PostRequestCodec,
  RouteDefinition,
  RouteDefinitions,
  SszPostRequestData,
  SszRequestMethods,
} from "./types.js";
import {
  HttpHeader,
  MediaType,
  WireFormat,
  getWireFormat,
  parseAcceptHeader,
  parseContentTypeHeader,
} from "./headers.js";
import {HttpSuccessCodes} from "./httpStatusCode.js";
import {toColonNotationPath} from "./urlFormat.js";
import {getFastifySchema} from "./schema.js";
import {EmptyMeta, EmptyResponseData} from "./codecs.js";

type ApplicationResponseObject<E extends Endpoint> = {
  /** Set non-200 success status code */
  status?: HttpSuccessCodes;
} & (E["return"] extends EmptyResponseData
  ? {data?: never}
  : {data: E["return"] | (E["return"] extends undefined ? undefined : Uint8Array)}) &
  (E["meta"] extends EmptyMeta ? {meta?: never} : {meta: E["meta"]});

export type ApplicationResponse<E extends Endpoint> =
  HasOnlyOptionalProps<ApplicationResponseObject<E>> extends true
    ? ApplicationResponseObject<E> | void
    : ApplicationResponseObject<E>;

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

export type FastifySchema = fastify.FastifySchema & {
  operationId: string;
  tags?: string[];
};

export type FastifyRoute<E extends Endpoint> = {
  url: string;
  method: fastify.HTTPMethods;
  handler: FastifyHandler<E>;
  schema: FastifySchema;
};
export type FastifyRoutes<Es extends Record<string, Endpoint>> = {[K in keyof Es]: FastifyRoute<Es[K]>};

export function createFastifyHandler<E extends Endpoint>(
  definition: RouteDefinition<E>,
  method: ApplicationMethod<E>,
  _operationId: string
): FastifyHandler<E> {
  return async (req, resp) => {
    let response: ApplicationResponse<E>;

    try {
      if (definition.method === "GET") {
        response = await method((definition.req as GetRequestCodec<E>).parseReq(req as GetRequestData));
      } else {
        // Media type is already validated by Fastify before calling handler
        const mediaType = parseContentTypeHeader(req.headers[HttpHeader.ContentType]) as MediaType;

        const {onlySupport} = definition.req as PostRequestCodec<E>;
        const requestWireFormat = getWireFormat(mediaType);
        switch (requestWireFormat) {
          case WireFormat.json:
            if (onlySupport !== undefined && onlySupport !== WireFormat.json) {
              throw new ServerError(415, `Endpoint only supports ${onlySupport} requests`);
            }
            response = await method((definition.req as JsonRequestMethods<E>).parseReqJson(req as JsonPostRequestData));
            break;
          case WireFormat.ssz:
            if (onlySupport !== undefined && onlySupport !== WireFormat.ssz) {
              throw new ServerError(415, `Endpoint only supports ${onlySupport} requests`);
            }
            response = await method(
              (definition.req as SszRequestMethods<E>).parseReqSsz(req as SszPostRequestData<E["request"]>)
            );
            break;
        }
      }
    } catch (e) {
      if (e instanceof ServerError) throw e;
      // Errors related to parsing should return 400 status code
      throw new ServerError(400, (e as Error).message);
    }

    if (response?.status !== undefined) {
      resp.statusCode = response.status;
    }

    if (definition.resp.isEmpty) {
      // Send response without body
      return;
    }

    let mediaType: MediaType | null;

    const acceptHeader = req.headers.accept;
    if (acceptHeader === undefined || acceptHeader === "*/*") {
      // Default to json to not force user to set header, e.g. when using curl
      mediaType = MediaType.json;
    } else {
      mediaType = parseAcceptHeader(acceptHeader);

      if (mediaType === null) {
        throw new ServerError(406, `Accepted media types are not supported: ${acceptHeader}`);
      }
    }

    const responseWireFormat = definition.resp.onlySupport ?? getWireFormat(mediaType);
    let wireResponse;
    switch (responseWireFormat) {
      case WireFormat.json: {
        const metaHeaders = definition.resp.meta.toHeadersObject(response?.meta);
        metaHeaders[HttpHeader.ContentType] = MediaType.json;
        void resp.headers(metaHeaders);
        const data =
          response?.data instanceof Uint8Array
            ? definition.resp.data.toJson(definition.resp.data.deserialize(response.data, response.meta), response.meta)
            : definition.resp.data.toJson(response?.data, response?.meta);
        const metaJson = definition.resp.meta.toJson(response?.meta);
        if (definition.resp.transform) {
          wireResponse = definition.resp.transform.toResponse(data, metaJson);
        } else {
          wireResponse = {
            data,
            ...(metaJson as object),
          };
        }
        break;
      }
      case WireFormat.ssz: {
        const metaHeaders = definition.resp.meta.toHeadersObject(response?.meta);
        metaHeaders[HttpHeader.ContentType] = MediaType.ssz;
        void resp.headers(metaHeaders);
        const data =
          response?.data instanceof Uint8Array
            ? response.data
            : definition.resp.data.serialize(response?.data, response?.meta);
        // Fastify supports returning `Uint8Array` from handler and will efficiently
        // convert it to a `Buffer` internally without copying the underlying `ArrayBuffer`
        wireResponse = data;
      }
    }

    return wireResponse;
  };
}

export function createFastifyRoute<E extends Endpoint>(
  definition: RouteDefinition<E>,
  method: ApplicationMethod<E>,
  operationId: string,
  thisArg: unknown
): FastifyRoute<E> {
  return {
    url: toColonNotationPath(definition.url),
    method: definition.method,
    handler: createFastifyHandler(definition, method?.bind(thisArg), operationId),
    schema: {
      ...getFastifySchema(definition.req.schema),
      operationId,
    },
  };
}

export function createFastifyRoutes<Es extends Record<string, Endpoint>>(
  definitions: RouteDefinitions<Es>,
  methods: ApplicationMethods<Es>
): FastifyRoutes<Es> {
  return mapValues(definitions, (definition, operationId) =>
    createFastifyRoute(definition, methods?.[operationId], operationId as string, methods)
  );
}

export function addSszContentTypeParser(server: fastify.FastifyInstance): void {
  // Cache body schema symbol, does not change per request
  let bodySchemaSymbol: symbol | undefined;

  server.addContentTypeParser(
    MediaType.ssz,
    {parseAs: "buffer"},
    async (request: fastify.FastifyRequest, payload: Buffer) => {
      if (bodySchemaSymbol === undefined) {
        // Get body schema symbol to be able to access validation function
        // https://github.com/fastify/fastify/blob/af2ccb5ff681c1d0ac22eb7314c6fa803f73c873/lib/symbols.js#L25
        bodySchemaSymbol = Object.getOwnPropertySymbols(request.context).find((s) => s.description === "body-schema");
      }
      // JSON schema validation will be applied to `Buffer` object, it is required to override validation function
      // See https://github.com/fastify/help/issues/1012, it is not possible right now to define a schema per content type
      (request.context as unknown as Record<symbol, unknown>)[bodySchemaSymbol as symbol] = () => true;

      // We could just return the `Buffer` here which is a subclass of `Uint8Array` but downstream code does not require it
      // and it's better to convert it here to avoid unexpected behavior such as `Buffer.prototype.slice` not copying memory
      // See https://github.com/nodejs/node/issues/41588#issuecomment-1016269584
      return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    }
  );
}
