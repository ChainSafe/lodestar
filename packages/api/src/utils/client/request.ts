import {HttpHeader, MediaType, mergeHeaders, setAuthorizationHeader} from "../headers.js";
import {
  Endpoint,
  JsonRequestMethods,
  RequestWithBodyCodec,
  RouteDefinition,
  SszRequestMethods,
  isRequestWithoutBody,
} from "../types.js";
import {WireFormat} from "../wireFormat.js";
import {stringifyQuery, urlJoin} from "./format.js";

export type ExtraRequestInit = {
  /** Wire format to use in HTTP requests to server */
  requestWireFormat?: `${WireFormat}`;
  /** Preferred wire format for HTTP responses from server */
  responseWireFormat?: `${WireFormat}`;
  /** Timeout of requests in milliseconds */
  timeoutMs?: number;
  /** Number of retries per request */
  retries?: number;
  /** Retry delay, only relevant if retries > 0 */
  retryDelay?: number;
};

export type OptionalRequestInit = {
  bearerToken?: string;
};

export type UrlInit = ApiRequestInit & {baseUrl?: string};
export type UrlInitRequired = ApiRequestInit & {
  urlIndex: number;
  baseUrl: string;
  /** Used in logs and metrics to prevent leaking user credentials */
  printableUrl: string;
};
export type ApiRequestInit = ExtraRequestInit & OptionalRequestInit & RequestInit;
export type ApiRequestInitRequired = Required<ExtraRequestInit> & UrlInitRequired;

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
  const headers = new Headers();

  let req: E["request"];

  if (isRequestWithoutBody(definition)) {
    req = definition.req.writeReq(args);
  } else {
    const requestWireFormat = (definition.req as RequestWithBodyCodec<E>).onlySupport ?? init.requestWireFormat;
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
      default:
        throw Error(`Invalid requestWireFormat: ${requestWireFormat}`);
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
      default:
        throw Error(`Invalid responseWireFormat: ${init.responseWireFormat}`);
    }
  }

  return new Request(url, {
    ...init,
    method: definition.method,
    headers: mergeHeaders(headers, req.headers, init.headers),
    body: req.body as BodyInit,
  });
}
