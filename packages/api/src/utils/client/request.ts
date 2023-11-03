import {WireFormat, mergeHeaders, setAuthorizationHeader} from "../headers.js";
import {Endpoint, GetRequestCodec, PostRequestCodec, RouteDefinition} from "../types.js";
import {stringifyQuery, urlJoin} from "./format.js";

export type ExtraRequestInit = {
  baseUrl?: string;
  requestWireFormat?: WireFormat;
  responseWireFormat?: WireFormat;
  timeoutMs?: number;
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

  let req: {
    params?: E["request"]["params"];
    query?: E["request"]["query"];
    headers?: E["request"]["headers"];
    body?: string | Uint8Array;
  };

  if (definition.method === "GET") {
    req = (definition.req as GetRequestCodec<E>).writeReq(args);
  } else {
    switch (init.requestWireFormat) {
      case WireFormat.json:
        req = (definition.req as PostRequestCodec<E>).writeReqJson(args);
        headers.set("content-type", "application/json");
        break;
      case WireFormat.ssz:
        req = (definition.req as PostRequestCodec<E>).writeReqSsz(args);
        headers.set("content-type", "application/octet-stream");
        break;
    }
  }
  const url = new URL(
    urlJoin(init.baseUrl, definition.urlFormatter(req.params ?? {})) +
      (req.query ? "?" + stringifyQuery(req.query) : "")
  );
  setAuthorizationHeader(url, headers, init);

  switch (init.responseWireFormat) {
    case WireFormat.json:
      headers.set("accept", "application/json;q=1,application/octet-stream;q=0.9");
      break;
    case WireFormat.ssz:
      headers.set("accept", "application/octet-stream;q=1,application/json;q=0.9");
      break;
  }

  return new Request(url, {
    ...init,
    method: definition.method,
    headers: mergeHeaders(headers, req.headers),
    body: req.body,
  });
}
