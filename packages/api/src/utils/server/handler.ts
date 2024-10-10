import type * as fastify from "fastify";
import {HttpHeader, MediaType, SUPPORTED_MEDIA_TYPES, parseAcceptHeader, parseContentTypeHeader} from "../headers.js";
import {
  Endpoint,
  RequestData,
  JsonRequestData,
  JsonRequestMethods,
  RequestWithBodyCodec,
  RouteDefinition,
  SszRequestData,
  SszRequestMethods,
  isRequestWithoutBody,
  RequestWithoutBodyCodec,
} from "../types.js";
import {WireFormat, fromWireFormat, getWireFormat} from "../wireFormat.js";
import {ApiError} from "./error.js";
import {ApplicationMethod} from "./method.js";

export type FastifyHandler<E extends Endpoint> = fastify.RouteHandlerMethod<
  fastify.RawServerDefault,
  fastify.RawRequestDefaultExpression<fastify.RawServerDefault>,
  fastify.RawReplyDefaultExpression<fastify.RawServerDefault>,
  {
    Body: E["request"] extends JsonRequestData ? E["request"]["body"] : undefined;
    Querystring: E["request"]["query"];
    Params: E["request"]["params"];
    Headers: E["request"]["headers"];
  },
  fastify.ContextConfigDefault
>;

export function createFastifyHandler<E extends Endpoint>(
  definition: RouteDefinition<E>,
  method: ApplicationMethod<E>,
  _operationId: string
): FastifyHandler<E> {
  return async (req, resp) => {
    // Determine response wire format first to inform application method
    // about the preferable return type to avoid unnecessary serialization
    let responseMediaType: MediaType | null;

    const acceptHeader = req.headers.accept;
    if (definition.resp.isEmpty) {
      // Ignore Accept header, the response will be sent without body
      responseMediaType = null;
    } else if (acceptHeader === undefined) {
      // Default to json to not force user to set header, e.g. when using curl
      responseMediaType = MediaType.json;
    } else {
      const {onlySupport} = definition.resp;
      const supportedMediaTypes = onlySupport !== undefined ? [fromWireFormat(onlySupport)] : SUPPORTED_MEDIA_TYPES;
      responseMediaType = parseAcceptHeader(acceptHeader, supportedMediaTypes);

      if (responseMediaType === null) {
        throw new ApiError(406, `Accepted media types not supported: ${acceptHeader}`);
      }
    }
    const responseWireFormat = responseMediaType !== null ? getWireFormat(responseMediaType) : null;

    let requestWireFormat: WireFormat | null;
    if (isRequestWithoutBody(definition)) {
      requestWireFormat = null;
    } else {
      const contentType = req.headers[HttpHeader.ContentType];
      if (contentType === undefined && req.body === undefined) {
        // Default to json parser if body is omitted. This is not possible for most
        // routes as request will fail schema validation before this handler is called
        requestWireFormat = WireFormat.json;
      } else {
        if (contentType === undefined) {
          throw new ApiError(400, "Content-Type header is required");
        }
        const requestMediaType = parseContentTypeHeader(contentType);
        if (requestMediaType === null) {
          throw new ApiError(415, `Unsupported media type: ${contentType.split(";", 1)[0]}`);
        }
        requestWireFormat = getWireFormat(requestMediaType);
      }

      const {onlySupport} = definition.req as RequestWithBodyCodec<E>;
      if (onlySupport !== undefined && onlySupport !== requestWireFormat) {
        throw new ApiError(415, `Endpoint only supports ${onlySupport.toUpperCase()} requests`);
      }
    }

    let args: E["args"];
    try {
      switch (requestWireFormat) {
        case WireFormat.json:
          args = (definition.req as JsonRequestMethods<E>).parseReqJson(req as JsonRequestData);
          break;
        case WireFormat.ssz:
          args = (definition.req as SszRequestMethods<E>).parseReqSsz(req as SszRequestData<E["request"]>);
          break;
        case null:
          args = (definition.req as RequestWithoutBodyCodec<E>).parseReq(req as RequestData);
          break;
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // Errors related to parsing should return 400 status code
      throw new ApiError(400, (e as Error).message);
    }

    const response = await method(args, {
      sszBytes: requestWireFormat === WireFormat.ssz ? (req.body as Uint8Array) : null,
      returnBytes: responseWireFormat === WireFormat.ssz,
    });

    if (response?.status !== undefined) {
      resp.statusCode = response.status;
    }

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
          return definition.resp.transform.toResponse(data, metaJson);
        }
        return {
          data,
          ...(metaJson as object),
        };
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
        return data;
      }
      case null:
        // Send response without body
        return;
    }
  };
}
