/* eslint-disable @typescript-eslint/naming-convention */
import type * as fastify from "fastify";
import {HttpHeader, MediaType, parseAcceptHeader, parseContentTypeHeader} from "../headers.js";
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
} from "../types.js";
import {WireFormat, getWireFormat} from "../wireFormat.js";
import {ApiError} from "./error.js";
import {ApplicationMethod, ApplicationResponse} from "./method.js";

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
    } else if (acceptHeader === undefined || acceptHeader === "*/*") {
      // Default to json to not force user to set header, e.g. when using curl
      responseMediaType = MediaType.json;
    } else {
      responseMediaType = parseAcceptHeader(acceptHeader);

      if (responseMediaType === null) {
        throw new ApiError(406, `Accepted media types are not supported: ${acceptHeader}`);
      }
    }
    const responseWireFormat =
      definition.resp.onlySupport ?? (responseMediaType !== null ? getWireFormat(responseMediaType) : null);

    let response: ApplicationResponse<E>;
    try {
      if (isRequestWithoutBody(definition)) {
        response = await method(definition.req.parseReq(req as RequestData), {
          sszBytes: null,
          returnBytes: responseWireFormat === WireFormat.ssz,
        });
      } else {
        // Media type is already validated by Fastify before calling handler
        const requestMediaType = parseContentTypeHeader(req.headers[HttpHeader.ContentType]) as MediaType;

        const {onlySupport} = definition.req as RequestWithBodyCodec<E>;
        const requestWireFormat = getWireFormat(requestMediaType);
        switch (requestWireFormat) {
          case WireFormat.json:
            if (onlySupport !== undefined && onlySupport !== WireFormat.json) {
              throw new ApiError(415, `Endpoint only supports ${onlySupport.toUpperCase()} requests`);
            }
            response = await method((definition.req as JsonRequestMethods<E>).parseReqJson(req as JsonRequestData), {
              sszBytes: null,
              returnBytes: responseWireFormat === WireFormat.ssz,
            });
            break;
          case WireFormat.ssz:
            if (onlySupport !== undefined && onlySupport !== WireFormat.ssz) {
              throw new ApiError(415, `Endpoint only supports ${onlySupport.toUpperCase()} requests`);
            }
            response = await method(
              (definition.req as SszRequestMethods<E>).parseReqSsz(req as SszRequestData<E["request"]>),
              {
                sszBytes: req.body as Uint8Array,
                returnBytes: responseWireFormat === WireFormat.ssz,
              }
            );
            break;
        }
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // Errors related to parsing should return 400 status code
      throw new ApiError(400, (e as Error).message);
    }

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
