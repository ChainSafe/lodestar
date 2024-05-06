import {HttpHeader, MediaType, mergeHeaders, setAuthorizationHeader} from "../headers.js";
import {
  Endpoint,
  GetRequestCodec,
  JsonRequestMethods,
  PostRequestCodec,
  RouteDefinition,
  SszRequestMethods,
} from "../types.js";
import {WireFormat} from "../wireFormat.js";
import {stringifyQuery, urlJoin} from "./format.js";

export type ExtraRequestInit = {
  baseUrl?: string;
  requestWireFormat?: WireFormat;
  responseWireFormat?: WireFormat;
  timeoutMs?: number;
  retries?: number;
  retryDelay?: number;
};

export type OptionalRequestInit = {
  bearerToken?: string;
};

export type ApiRequestInit = ExtraRequestInit & OptionalRequestInit & RequestInit;
export type ApiRequestInitRequired = Required<ExtraRequestInit> & OptionalRequestInit & RequestInit;

/** Route definition with computed extra properties */
export type RouteDefinitionExtra<E extends Endpoint> = RouteDefinition<E> & {
  operationId: string;
  urlFormatter: (args: Record<string, string | number>) => string;
};

export function createApiRequest<E extends Endpoint>(
  definition: RouteDefinitionExtra<E>,
  args: E["args"],
  init: ApiRequestInitRequired
): Request {
  const headers = new Headers(init.headers);

  let req: E["request"];

  if (definition.method === "GET") {
    req = (definition.req as GetRequestCodec<E>).writeReq(args);
  } else {
    const requestWireFormat = (definition.req as PostRequestCodec<E>).onlySupport ?? init.requestWireFormat;
    switch (requestWireFormat) {
      case WireFormat.json:
        req = (definition.req as JsonRequestMethods<E>).writeReqJson(args);
        if (req.body) {
          req.body = JSON.stringify(req.body);
          headers.set(HttpHeader.ContentType, MediaType.json);
        }
        break;
      case WireFormat.ssz:
        req = (definition.req as SszRequestMethods<E>).writeReqSsz(args);
        if (req.body) {
          headers.set(HttpHeader.ContentType, MediaType.ssz);
        }
        break;
    }
  }
  const queryString = req.query ? stringifyQuery(req.query) : "";
  const url = new URL(
    urlJoin(init.baseUrl, definition.urlFormatter(req.params ?? {})) + (queryString ? `?${queryString}` : "")
  );
  setAuthorizationHeader(url, headers, init);

  if (definition.resp.isEmpty) {
    // Do not set Accept header
  } else if (definition.resp.onlySupport !== undefined) {
    switch (definition.resp.onlySupport) {
      case WireFormat.json:
        headers.set(HttpHeader.Accept, MediaType.json);
        break;
      case WireFormat.ssz:
        headers.set(HttpHeader.Accept, MediaType.ssz);
        break;
    }
  } else {
    switch (init.responseWireFormat) {
      case WireFormat.json:
        headers.set(HttpHeader.Accept, `${MediaType.json};q=1,${MediaType.ssz};q=0.9`);
        break;
      case WireFormat.ssz:
        headers.set(HttpHeader.Accept, `${MediaType.ssz};q=1,${MediaType.json};q=0.9`);
        break;
    }
  }

  return new Request(url, {
    ...init,
    method: definition.method,
    headers: mergeHeaders(headers, req.headers),
    body: req.body as BodyInit,
  });
}
