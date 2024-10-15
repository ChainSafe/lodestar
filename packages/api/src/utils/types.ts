import {ExtraRequestInit} from "./client/request.js";
import {EmptyMeta} from "./codecs.js";
import {HeadersExtra} from "./headers.js";
import {SchemaDefinition} from "./schema.js";
import {WireFormat} from "./wireFormat.js";

export type HasOnlyOptionalProps<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K;
} extends {[K2 in keyof T]: never}
  ? true
  : false;

export type PathParams = Record<string, string | number>;
export type QueryParams = Record<string, string | number | boolean | (string | number)[]>;
export type HeaderParams = Record<string, string>;

export type RequestData<
  P extends PathParams = PathParams,
  Q extends QueryParams = QueryParams,
  H extends HeaderParams = HeaderParams,
> = {
  params?: P;
  query?: Q;
  headers?: H;
};

export type JsonRequestData<
  B = unknown,
  P extends PathParams = PathParams,
  Q extends QueryParams = QueryParams,
  H extends HeaderParams = HeaderParams,
> = RequestData<P, Q, H> & {
  body?: B;
};

export type SszRequestData<P extends JsonRequestData> = Omit<P, "body"> &
  ("body" extends keyof P ? (P["body"] extends void ? {body?: never} : {body: Uint8Array}) : {body?: never});

export type HttpMethod = "GET" | "POST" | "DELETE";

/**
 * This type describes the general shape of a route
 *
 * This includes both http and application-level shape
 * - The http method
 *   - Used to more strictly enforce the shape of the request
 * - The application-level parameters
 *   - this enforces the shape of the input data passed by the client and to the route handler
 * - The http request
 *   - this enforces the shape of the querystring, url params, request body
 * - The application-level return data
 *   - this enforces the shape of the output data passed back to the client and returned by the route handler
 * - The application-level return metadata
 *   - this enforces the shape of the returned metadata, used informationally and to help decode the return data
 */
export type Endpoint<
  Method extends HttpMethod = HttpMethod,
  ArgsType = unknown,
  RequestType extends Method extends "GET" ? RequestData : JsonRequestData = JsonRequestData,
  ReturnType = unknown,
  Meta = unknown,
> = {
  method: Method;
  /** The parameters the client passes / server app code ingests */
  args: ArgsType;
  /** The parameters in the http request */
  request: RequestType;
  /** The return data */
  return: ReturnType;
  /** The return metadata */
  meta: Meta;
};

// Request codec

/** Encode / decode requests to & from function params, as well as schema definitions */
export type RequestWithoutBodyCodec<E extends Endpoint> = {
  writeReq: (p: E["args"]) => E["request"]; // client
  parseReq: (r: E["request"]) => E["args"]; // server
  schema: SchemaDefinition<E["request"]>;
};

export type JsonRequestMethods<E extends Endpoint> = {
  writeReqJson: (p: E["args"]) => E["request"]; // client
  parseReqJson: (r: E["request"]) => E["args"]; // server
};

export type SszRequestMethods<E extends Endpoint> = {
  writeReqSsz: (p: E["args"]) => SszRequestData<E["request"]>; // client
  parseReqSsz: (r: SszRequestData<E["request"]>) => E["args"]; // server
};

export type RequestWithBodyCodec<E extends Endpoint> = JsonRequestMethods<E> &
  SszRequestMethods<E> & {
    schema: SchemaDefinition<E["request"]>;
    /** Support ssz-only or json-only requests */
    onlySupport?: WireFormat;
  };

/**
 * Handles translation between `Endpoint["args"]` and `Endpoint["request"]`
 */
export type RequestCodec<E extends Endpoint> = E["method"] extends "GET"
  ? RequestWithoutBodyCodec<E>
  : "body" extends keyof E["request"]
    ? RequestWithBodyCodec<E>
    : RequestWithoutBodyCodec<E>;

export function isRequestWithoutBody<E extends Endpoint>(
  definition: RouteDefinition<E>
): definition is RouteDefinition<E> & {req: RequestWithoutBodyCodec<E>} {
  return definition.method === "GET" || definition.req.schema.body === undefined;
}

// Response codec

export type ResponseDataCodec<T, M> = {
  toJson: (data: T, meta: M) => unknown; // server
  fromJson: (data: unknown, meta: M) => T; // client
  serialize: (data: T, meta: M) => Uint8Array; // server
  deserialize: (data: Uint8Array, meta: M) => T; // client
};

export type ResponseMetadataCodec<T> = {
  toJson: (val: T) => unknown; // server
  fromJson: (val: unknown) => T; // client
  toHeadersObject: (val: T) => Record<string, string>; // server
  fromHeaders: (headers: HeadersExtra) => T; // server
};

export type ResponseCodec<E extends Endpoint> = {
  data: ResponseDataCodec<E["return"], E["meta"]>;
  meta: ResponseMetadataCodec<E["meta"]>;
  /** Occasionally, json responses require an extra transformation to separate the data from metadata */
  transform?: {
    toResponse: (data: unknown, meta: unknown) => unknown;
    fromResponse: (resp: unknown) => {
      data: E["return"];
    } & (E["meta"] extends EmptyMeta ? {meta?: never} : {meta: E["meta"]});
  };
  /** Support ssz-only or json-only responses */
  onlySupport?: WireFormat;
  /** Indicator used to handle empty responses */
  isEmpty?: true;
};

/**
 * Top-level definition of a route used by both the client and server
 * - url and method
 * - request and response codec
 * - request json schema
 */
export type RouteDefinition<E extends Endpoint> = {
  url: string;
  method: E["method"];
  req: RequestCodec<E>;
  resp: ResponseCodec<E>;
  init?: ExtraRequestInit;
};

export type RouteDefinitions<Es extends Record<string, Endpoint>> = {[K in keyof Es]: RouteDefinition<Es[K]>};
