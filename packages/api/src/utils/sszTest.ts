/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, ListBasicType, ListCompositeType, Type, ValueOf} from "@chainsafe/ssz";
import type * as fastify from "fastify";
import {Epoch, Root, StringType, allForks, ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {ErrorAborted, Logger, TimeoutError, fromHex, mapValues, toHex} from "@lodestar/utils";
import {ExecutionOptimistic} from "../beacon/routes/beacon/block.js";
import {StateId} from "../beacon/routes/beacon/index.js";
import {AttesterDuty} from "../beacon/routes/validator.js";
import {NodeHealthOptions} from "../beacon/routes/node.js";
import {Schema, SchemaDefinition, getFastifySchema} from "./schema.js";
import {stringifyQuery, urlJoin} from "./client/format.js";
import {Metrics} from "./client/httpClient.js";
import {compileRouteUrlFormater, toColonNotationPath} from "./urlFormat.js";
import {isFetchError} from "./client/fetch.js";

// ssz types -- assumed to already be defined

const ValidatorIndices = new ListBasicType(ssz.ValidatorIndex, 2 ** 40);
const AttesterDuty = new ContainerType({
  // The validator's public key, uniquely identifying them
  pubkey: ssz.BLSPubkey,
  // Index of validator in validator registry
  validatorIndex: ssz.ValidatorIndex,
  committeeIndex: ssz.CommitteeIndex,
  // Number of validators in committee
  committeeLength: ssz.UintNum64,
  // Number of committees at the provided slot
  committeesAtSlot: ssz.UintNum64,
  // Index of validator in committee
  validatorCommitteeIndex: ssz.UintNum64,
  // The slot at which the validator must attest.
  slot: ssz.Slot,
});
const AttesterDuties = new ListCompositeType(AttesterDuty, 2 ** 40);
const NodeVersion = new ContainerType({
  version: new StringType(),
});

type ValidatorIndicesType = ValueOf<typeof ValidatorIndices>;
type AttesterDutiesType = ValueOf<typeof AttesterDuties>;
type NodeVersionType = ValueOf<typeof NodeVersion>;

// Endpoint

export type PathParams = Record<string, string | number>;
export type QueryParams = Record<string, string | number | (string | number)[]>;

export type GetRequestData<P extends PathParams, Q extends QueryParams> = {
  params?: P;
  query?: Q;
};

export type JsonPostRequestData<P extends PathParams, Q extends QueryParams, B> = GetRequestData<P, Q> & {
  body?: B;
};

export type SszPostRequestData<P extends JsonPostRequestData<PathParams, QueryParams, unknown>> = Omit<P, "body"> & {
  body: P["body"] extends undefined ? undefined : Uint8Array;
};

export type HttpMethod = "GET" | "POST" | "DELETE";

/**
 * This type describes the general shape of a route
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
  RequestType extends Method extends "GET"
    ? GetRequestData<PathParams, QueryParams>
    : JsonPostRequestData<PathParams, QueryParams, unknown> = GetRequestData<PathParams, QueryParams>,
  ReturnType = unknown,
  Meta = unknown,
> = {
  method: Method;
  /** the parameters the client passes / server app code ingests */
  args: ArgsType;
  /** the parameters in the http request */
  request: RequestType;
  /** the return data */
  return: ReturnType;
  /** the return metadata */
  meta: Meta;
};

// Request codec

/** Encode / decode requests to & from function params, as well as schema definitions */
export type GetRequestCodec<E extends Endpoint> = {
  writeReq: (p: E["args"]) => E["request"];
  parseReq: (r: E["request"]) => E["args"];
  schema: SchemaDefinition<E["request"]>;
};

export type PostRequestCodec<E extends Endpoint> = {
  writeReqJson: (p: E["args"]) => E["request"];
  parseReqJson: (r: E["request"]) => E["args"];
  writeReqSsz: (p: E["args"]) => SszPostRequestData<E["request"]>;
  parseReqSsz: (r: SszPostRequestData<E["request"]>) => E["args"];
  schema: SchemaDefinition<E["request"]>;
};

/**
 * Previously called ReqSerializer
 * this handles translating between Endpoint["params"] and Endpoint["request"]
 *
 * TODO: Should this be split into separate serialize and deserialize + schema objects?
 * For separate consumption by client and server.
 * Taking this idea to the extreme, Each group of endpoints would have definitions split into three files for nice treeshaking (types, client, server)
 */
export type RequestCodec<E extends Endpoint> = E["method"] extends "GET" ? GetRequestCodec<E> : PostRequestCodec<E>;

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
  fromHeaders: (val: Headers) => T; // server
};

export type ResponseCodec<E extends Endpoint> = {
  data: ResponseDataCodec<E["return"], E["meta"]>;
  meta: ResponseMetadataCodec<E["meta"]>;
  /** Occasionally, json responses require an extra transormation to separate the data from metadata */
  transform?: {
    toResponse: (data: unknown, meta: unknown) => unknown;
    fromResponse: (resp: unknown) => {
      data: unknown;
      meta: unknown;
    };
  };
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
  // TODO remove?
  statusOk?: number; // only used for keymanager to set non-200 ok
  req: RequestCodec<E>;
  resp: ResponseCodec<E>;
};

export type RouteDefinitions<Es extends Record<string, Endpoint>> = {[K in keyof Es]: RouteDefinition<Es[K]>};

// Utility types / codecs

export type EmptyArgs = void;
export type EmptyRequest = Record<string, never>;
export type EmptyResponseData = void;
export type EmptyMeta = Record<string, never>;

/** Shortcut for routes that have no params, query */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EmptyGetRequestCodec: GetRequestCodec<Endpoint<"GET", EmptyArgs, EmptyRequest, any, any>> = {
  writeReq: () => ({}),
  parseReq: () => {},
  schema: {},
};

export const EmptyResponseDataCodec: ResponseDataCodec<EmptyResponseData, EmptyMeta> = {
  toJson: () => ({}),
  fromJson: () => {},
  serialize: () => new Uint8Array(),
  deserialize: () => {},
};

export const EmptyMetaCodec: ResponseMetadataCodec<EmptyMeta> = {
  toJson: () => ({}),
  fromJson: () => ({}),
  toHeadersObject: () => ({}),
  fromHeaders: () => ({}),
};

export function WithVersion<T, M extends {version: ForkName}>(
  getType: (v: ForkName) => Type<T>
): ResponseDataCodec<T, M> {
  return {
    toJson: (data, meta: M) => getType(meta.version).toJson(data),
    fromJson: (data, meta: M) => getType(meta.version).fromJson(data),
    serialize: (data, meta: M) => getType(meta.version).serialize(data),
    deserialize: (data, meta: M) => getType(meta.version).deserialize(data),
  };
}

export const ExecutionOptimisticAndVersionCodec: ResponseMetadataCodec<ExecutionOptimisticAndVersion> = {
  toJson: (val) => val,
  fromJson: (val) => val as ExecutionOptimisticAndVersion,
  toHeadersObject: (val) => ({
    "Eth-Execution-Optimistic": String(val.executionOptimistic),
    "Eth-Consensus-Version": val.version,
  }),
  fromHeaders: (val) => ({
    executionOptimistic: Boolean(val.get("Eth-Execution-Optimistic")),
    version: val.get("Eth-Consensus-Version")!.toLowerCase() as ForkName,
  }),
};

export type ExecutionOptimisticAndVersion = {executionOptimistic: ExecutionOptimistic; version: ForkName};
export type ExecutionOptimisticAndDependentRoot = {executionOptimistic: ExecutionOptimistic; dependentRoot: Root};

export const ExecutionOptimisticAndDependentRootCodec: ResponseMetadataCodec<ExecutionOptimisticAndDependentRoot> = {
  toJson: ({executionOptimistic, dependentRoot}) => ({executionOptimistic, dependentRoot: toHex(dependentRoot)}),
  fromJson: (val) =>
    ({
      executionOptimistic: (val as any).executionOptimistic as boolean,
      dependentRoot: fromHex((val as any).dependentRoot),
    }) as ExecutionOptimisticAndDependentRoot,
  toHeadersObject: (val) => ({
    "Eth-Execution-Optimistic": String(val.executionOptimistic),
    "Eth-Consensus-Dependent-Root": toHex(val.dependentRoot),
  }),
  fromHeaders: (val) => ({
    executionOptimistic: Boolean(val.get("Eth-Execution-Optimistic")),
    dependentRoot: fromHex(val.get("Eth-Consensus-Dependent-Root")!),
  }),
};

// Showing some usage of how to define routes - a GET and a POST

// First, Endpoints are defined.

export type TestEndpoints = {
  getState: Endpoint<
    "GET",
    {stateId: StateId},
    {params: {state_id: string}},
    allForks.BeaconState,
    ExecutionOptimisticAndVersion
  >;
  getAttesterDuties: Endpoint<
    "POST",
    {epoch: Epoch; indices: ValidatorIndicesType},
    {params: {epoch: number}; body: string[]},
    AttesterDutiesType,
    ExecutionOptimisticAndDependentRoot
  >;
  getNodeVersion: Endpoint<
    //
    "GET",
    EmptyArgs,
    EmptyRequest,
    NodeVersionType,
    EmptyMeta
  >;
  getHealth: Endpoint<
    //
    "GET",
    {options?: NodeHealthOptions},
    {query: {syncing_status?: number}},
    EmptyResponseData,
    EmptyMeta
  >;
};

// Then route definitions

export const definitions: RouteDefinitions<TestEndpoints> = {
  getState: {
    url: "/eth/v2/debug/beacon/states/{state_id}",
    method: "GET",
    req: {
      writeReq: ({stateId}) => ({params: {state_id: String(stateId)}}),
      parseReq: ({params}) => ({stateId: params.state_id}),
      schema: {params: {state_id: Schema.StringRequired}},
    },
    resp: {
      // this is an example where respones metadata informs interpretation of the response data
      data: WithVersion((forkName) => ssz[forkName].BeaconState as Type<allForks.BeaconState>),
      meta: ExecutionOptimisticAndVersionCodec,
    },
  },
  getAttesterDuties: {
    url: "/eth/v1/validator/duties/attester/{epoch}",
    method: "POST",
    // POST request codecs include *Json functions to translate to / from json bodies and *Ssz functions to translate to / from ssz bodies
    req: {
      writeReqJson: ({epoch, indices}) => ({params: {epoch}, body: ValidatorIndices.toJson(indices) as string[]}),
      parseReqJson: ({params, body}) => ({epoch: params.epoch, indices: ValidatorIndices.fromJson(body)}),
      writeReqSsz: ({epoch, indices}) => ({params: {epoch}, body: ValidatorIndices.serialize(indices)}),
      parseReqSsz: ({params, body}) => ({epoch: params.epoch, indices: ValidatorIndices.deserialize(body)}),
      schema: {params: {epoch: Schema.UintRequired}, body: Schema.StringArray},
    },
    resp: {
      // A ssz type suffices in cases where the data shape is static
      data: AttesterDuties,
      meta: ExecutionOptimisticAndDependentRootCodec,
    },
  },
  getNodeVersion: {
    url: "/eth/v1/node/version",
    method: "GET",
    req: EmptyGetRequestCodec,
    resp: {
      data: NodeVersion,
      meta: EmptyMetaCodec,
    },
  },
  getHealth: {
    url: "/eth/v1/node/health",
    method: "GET",
    req: {
      parseReq: ({query}) => ({options: {syncingStatus: query.syncing_status}}),
      writeReq: ({options}) => ({query: {syncing_status: options?.syncingStatus}}),
      schema: {query: {syncing_status: Schema.Uint}},
    },
    resp: {
      data: EmptyResponseDataCodec,
      meta: EmptyMetaCodec,
    },
  },
};

// Api client

export enum WireFormat {
  json = "json",
  ssz = "ssz",
}

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

export const DEFAULT_REQUEST_WIRE_FORMAT = WireFormat.json;
export const DEFAULT_RESPONSE_WIRE_FORMAT = WireFormat.ssz;

/** Route definition with computed extra properties */
export type RouteDefinitionExtra<E extends Endpoint> = RouteDefinition<E> & {
  operationId: string;
  urlFormatter: (args: Record<string, string | number>) => string;
};

export function createApiRequest<E extends Endpoint>(
  definition: RouteDefinitionExtra<E>,
  params: E["args"],
  init: ApiRequestInitRequired
): Request {
  const headers = new Headers(init.headers);

  let req: {
    params?: E["request"]["params"];
    query?: E["request"]["query"];
    body?: string | Uint8Array;
  };

  if (definition.method === "GET") {
    req = (definition.req as GetRequestCodec<E>).writeReq(params);
  } else {
    switch (init.requestWireFormat) {
      case WireFormat.json:
        req = (definition.req as PostRequestCodec<E>).writeReqJson(params);
        headers.set("content-type", "application/json");
        break;
      case WireFormat.ssz:
        req = (definition.req as PostRequestCodec<E>).writeReqSsz(params);
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
    headers,
    body: req.body,
  });
}

export type RawBody = {type: WireFormat.json; value: unknown} | {type: WireFormat.ssz; value: Uint8Array};

export type SuccessApiResponse<E extends Endpoint> = Response & {
  ok: true;
  meta: () => Promise<E["meta"]>;
  value: () => Promise<E["return"]>;
  rawBody: () => Promise<RawBody>;
  ssz: () => Promise<Uint8Array>;
};

export type FailureApiResponse = Response & {
  ok: false;
  error: () => Promise<ApiError>;
};

export type UnknownApiResponse<E extends Endpoint> = SuccessApiResponse<E> | FailureApiResponse;

export type ApiClientMethod<E extends Endpoint> = E["args"] extends void
  ? (init?: ApiRequestInit) => Promise<UnknownApiResponse<E>>
  : (args: E["args"], init?: ApiRequestInit) => Promise<UnknownApiResponse<E>>;

export type ApiClientMethods<Es extends Record<string, Endpoint>> = {[K in keyof Es]: ApiClientMethod<Es[K]>};

export function getWireFormat(contentType?: string | null): WireFormat {
  if (!contentType) throw Error("No content-type header found");

  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();

  if (mediaType === "application/json") {
    return WireFormat.json;
  }
  if (mediaType === "application/octet-stream") {
    return WireFormat.ssz;
  }
  throw Error(`Unsupported response media type: ${mediaType}`);
}

export class ApiResponse<E extends Endpoint> extends Response {
  private definition: RouteDefinitionExtra<E>;
  private _rawBody?: RawBody;
  private _errorBody?: string;
  private _meta?: E["meta"];
  private _value?: E["return"];

  constructor(definition: RouteDefinitionExtra<E>, body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
    this.definition = definition;
  }

  wireFormat(): WireFormat {
    return getWireFormat(this.headers.get("content-type"));
  }

  async rawBody(): Promise<RawBody> {
    if (!this.ok) {
      throw await this.error();
    }

    if (!this._rawBody) {
      switch (this.wireFormat()) {
        case WireFormat.json:
          this._rawBody = {
            type: WireFormat.json,
            value: await this.json(),
          };
          break;
        case WireFormat.ssz:
          this._rawBody = {
            type: WireFormat.ssz,
            value: new Uint8Array(await this.arrayBuffer()),
          };
          break;
      }
    }
    return this._rawBody;
  }

  async meta(): Promise<E["meta"]> {
    if (!this._meta) {
      const rawBody = await this.rawBody();
      switch (rawBody.type) {
        case WireFormat.json: {
          const metaJson = this.definition.resp.transform
            ? this.definition.resp.transform.fromResponse(rawBody.value).meta
            : rawBody.value;
          this._meta = this.definition.resp.meta.fromJson(metaJson);
          break;
        }
        case WireFormat.ssz:
          this._meta = this.definition.resp.meta.fromHeaders(this.headers);
          break;
      }
    }
    return this._meta;
  }

  async value(): Promise<E["return"]> {
    if (!this._value) {
      const rawBody = await this.rawBody();
      const meta = await this.meta();
      switch (rawBody.type) {
        case WireFormat.json: {
          const dataJson = this.definition.resp.transform
            ? this.definition.resp.transform.fromResponse(rawBody.value).data
            : (rawBody.value as Record<string, unknown>)?.["data"];
          this._value = this.definition.resp.data.fromJson(dataJson, meta);
          break;
        }
        case WireFormat.ssz:
          this._value = this.definition.resp.data.deserialize(rawBody.value, meta);
          break;
      }
    }
    return this._value;
  }

  async ssz(): Promise<Uint8Array> {
    const rawBody = await this.rawBody();
    switch (rawBody.type) {
      case WireFormat.json:
        return this.definition.resp.data.serialize(await this.value(), await this.meta());
      case WireFormat.ssz:
        return rawBody.value;
    }
  }

  async error(): Promise<ApiError | null> {
    if (this.ok) {
      return null;
    }
    if (!this._errorBody) {
      this._errorBody = await this.text();
    }
    return new ApiError(getErrorMessage(this._errorBody), this.status, this.definition.operationId);
  }
}

function getErrorMessage(errBody: string): string {
  try {
    const errJson = JSON.parse(errBody) as {message: string};
    if (errJson.message) {
      return errJson.message;
    } else {
      return errBody;
    }
  } catch (e) {
    return errBody;
  }
}

export function createApiClientMethod<E extends Endpoint>(
  definition: RouteDefinition<E>,
  client: HttpClient,
  operationId: string
): ApiClientMethod<E> {
  const urlFormatter = compileRouteUrlFormater(definition.url);
  const definitionExtended = {
    ...definition,
    urlFormatter,
    operationId,
  };

  // If the request args is void, then completely remove the args parameter
  if (
    definition.req.schema.body === undefined &&
    definition.req.schema.params === undefined &&
    definition.req.schema.query === undefined
  ) {
    return (async (init?: ApiRequestInit) => {
      return client.requestWithRetries(definitionExtended, undefined, init ?? {});
    }) as ApiClientMethod<E>;
  }
  return (async (args, init) => {
    return client.requestWithRetries(definitionExtended, args, init ?? {});
  }) as ApiClientMethod<E>;
}

export function setAuthorizationHeader(url: URL, headers: Headers, {bearerToken}: OptionalRequestInit): void {
  if (bearerToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }
  if (url.username || url.password) {
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Basic ${toBase64(`${url.username}:${url.password}`)}`);
    }
    // Remove the username and password from the URL
    url.username = "";
    url.password = "";
  }
}

export function mergeHeaders(a: HeadersInit | undefined, b: HeadersInit | undefined): Headers {
  if (!a) {
    return new Headers(b);
  }
  const headers = new Headers(a);
  if (!b) {
    return headers;
  }
  if (Array.isArray(b)) {
    for (const [key, value] of b) {
      headers.set(key, value);
    }
  } else if (b instanceof Headers) {
    for (const [key, value] of b as unknown as Iterable<[string, string]>) {
      headers.set(key, value);
    }
  } else {
    for (const [key, value] of Object.entries(b)) {
      headers.set(key, value);
    }
  }
  return headers;
}

export function createApiClientMethods<Es extends Record<string, Endpoint>>(
  definitions: RouteDefinitions<Es>,
  client: HttpClient
): ApiClientMethods<Es> {
  return mapValues(definitions, (definition, operationId) => {
    return createApiClientMethod(definition, client, operationId as string);
  }) as unknown as ApiClientMethods<Es>;
}

// server

export type ApplicationResponse<E extends Endpoint> = {
  data: E["return"] | (E["return"] extends undefined ? undefined : Uint8Array);
  meta: E["meta"];
  statusCode?: number;
};

export type ApplicationError = ApiError | Error;

export type ApplicationMethod<E extends Endpoint> = (args: E["args"]) => Promise<ApplicationResponse<E>>;
export type ApplicationMethods<Es extends Record<string, Endpoint>> = {[K in keyof Es]: ApplicationMethod<Es[K]>};

export type FastifyHandler<E extends Endpoint> = fastify.RouteHandlerMethod<
  fastify.RawServerDefault,
  fastify.RawRequestDefaultExpression<fastify.RawServerDefault>,
  fastify.RawReplyDefaultExpression<fastify.RawServerDefault>,
  {
    Body: E["request"] extends JsonPostRequestData<PathParams, QueryParams, unknown> ? E["request"]["body"] : undefined;
    Querystring: E["request"]["query"];
    Params: E["request"]["params"];
  },
  fastify.ContextConfigDefault
>;

export type FastifyRouteConfig = fastify.FastifyContextConfig & {
  operationId: string;
};

export type FastifyRoute<E extends Endpoint> = {
  url: string;
  method: fastify.HTTPMethods;
  handler: FastifyHandler<E>;
  schema?: fastify.FastifySchema;
  config: FastifyRouteConfig;
};
export type FastifyRoutes<Es extends Record<string, Endpoint>> = {[K in keyof Es]: FastifyRoute<Es[K]>};

export function createFastifyHandler<E extends Endpoint>(
  definition: RouteDefinition<E>,
  method: ApplicationMethod<E>
): FastifyHandler<E> {
  return async (req, resp) => {
    let response: ApplicationResponse<E>;
    if (definition.method === "GET") {
      response = await method(
        (definition.req as GetRequestCodec<E>).parseReq(req as GetRequestData<PathParams, QueryParams>)
      );
    } else {
      const requestWireFormat = getWireFormat(req.headers["content-type"]);
      switch (requestWireFormat) {
        case WireFormat.json:
          response = await method(
            (definition.req as PostRequestCodec<E>).parseReqJson(
              req as JsonPostRequestData<PathParams, QueryParams, unknown>
            )
          );
          break;
        case WireFormat.ssz:
          response = await method(
            (definition.req as PostRequestCodec<E>).parseReqSsz(req as SszPostRequestData<E["request"]>)
          );
          break;
      }
    }

    const responseWireFormat = getWireFormat(req.headers.accept ?? DEFAULT_RESPONSE_WIRE_FORMAT);
    let wireResponse;
    switch (responseWireFormat) {
      case WireFormat.json: {
        await resp.header("content-type", "application/json");
        const data =
          response.data instanceof Uint8Array
            ? definition.resp.data.toJson(definition.resp.data.deserialize(response.data, response.meta), response.meta)
            : definition.resp.data.toJson(response.data, response.meta);
        const meta = definition.resp.meta.toJson(response.meta);
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
        const meta = definition.resp.meta.toHeadersObject(response.meta);
        meta["content-type"] = "application/octet-stream";
        await resp.headers(meta);
        const data =
          response.data instanceof Uint8Array
            ? response.data
            : definition.resp.data.serialize(response.data, response.meta);
        wireResponse = Buffer.from(data);
      }
    }
    if (response.statusCode !== undefined || definition.statusOk !== undefined) {
      resp.statusCode = response.statusCode ?? (definition.statusOk as number);
    }
    return wireResponse;
  };
}

export function createFastifyRoute<E extends Endpoint>(
  definition: RouteDefinition<E>,
  method: ApplicationMethod<E>,
  operationId: string,
  namespace?: string
): FastifyRoute<E> {
  return {
    url: toColonNotationPath(definition.url),
    method: definition.method,
    handler: createFastifyHandler(definition, method),
    schema: {
      ...getFastifySchema(definition.req.schema),
      ...(namespace ? {tags: [namespace]} : undefined),
      operationId,
    } as fastify.FastifySchema,
    config: {operationId} as FastifyRouteConfig,
  };
}

export function createFastifyRoutes<Es extends Record<string, Endpoint>>(
  definitions: RouteDefinitions<Es>,
  methods: ApplicationMethods<Es>,
  namespace?: string
): FastifyRoutes<Es> {
  return mapValues(definitions, (definition, operationId) =>
    createFastifyRoute(definition, methods[operationId], operationId as string, namespace)
  );
}

// we no longer need a registerRoute(s) function
export function registerRoute(server: fastify.FastifyInstance, route: FastifyRoute<Endpoint>): void {
  server.route(route);
}

/////

/** A higher default timeout, validator will sets its own shorter timeoutMs */
const DEFAULT_TIMEOUT_MS = 60_000;

const URL_SCORE_DELTA_SUCCESS = 1;
/** Require 2 success to recover from 1 failed request */
const URL_SCORE_DELTA_ERROR = 2 * URL_SCORE_DELTA_SUCCESS;
/** In case of continued errors, require 10 success to mark the URL as healthy */
const URL_SCORE_MAX = 10 * URL_SCORE_DELTA_SUCCESS;
const URL_SCORE_MIN = 0;

export class ApiError extends Error {
  status: number;
  operationId: string;

  constructor(message: string, status: number, operationId: string) {
    super(message);
    this.status = status;
    this.operationId = operationId;
  }

  toString(): string {
    return `${this.message} (status=${this.status}, operationId=${this.operationId})`;
  }
}

export interface IHttpClient {
  readonly baseUrl: string;

  requestWithRetries<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    localInit: ApiRequestInit
  ): Promise<UnknownApiResponse<E>>;
  request<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    localInit: ApiRequestInit,
    urlIndex?: number
  ): Promise<UnknownApiResponse<E>>;
}

export type HttpClientOptions = ({baseUrl: string} | {urls: (string | ApiRequestInit)[]}) & {
  globalInit?: ApiRequestInit;
  /** Override fetch function */
  fetch?: typeof fetch;
};

export type HttpClientModules = {
  logger?: Logger;
  metrics?: Metrics;
};

export class HttpClient implements IHttpClient {
  readonly urlsInits: ApiRequestInitRequired[] = [];

  private readonly fetch: typeof fetch;
  private readonly metrics: null | Metrics;
  private readonly logger: null | Logger;

  private readonly urlsScore: number[];

  get baseUrl(): string {
    return this.urlsInits[0].baseUrl;
  }

  constructor(opts: HttpClientOptions, {logger, metrics}: HttpClientModules = {}) {
    // Cast to all types optional since they are defined with syntax `HttpClientOptions = A | B`
    const {baseUrl, urls = []} = opts as {baseUrl?: string; urls?: (string | ApiRequestInit)[]};
    const globalInit = opts.globalInit;
    const defaults = {
      baseUrl: "",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      requestWireFormat: DEFAULT_REQUEST_WIRE_FORMAT,
      responseWireFormat: DEFAULT_RESPONSE_WIRE_FORMAT,
    };

    // opts.baseUrl is equivalent to `urls: [{baseUrl}]`
    // unshift opts.baseUrl to urls, without mutating opts.urls
    for (const [i, urlOrInit] of [...(baseUrl ? [baseUrl] : []), ...urls].entries()) {
      const init = typeof urlOrInit === "string" ? {baseUrl: urlOrInit} : urlOrInit;
      const urlInit: ApiRequestInitRequired = {
        ...defaults,
        ...globalInit,
        ...init,
        headers: mergeHeaders(globalInit?.headers, init.headers),
      };

      if (!urlInit.baseUrl) {
        throw Error(`HttpClient.urls[${i}] is empty or undefined: ${urlInit.baseUrl}`);
      }
      if (!isValidHttpUrl(urlInit.baseUrl)) {
        throw Error(`HttpClient.urls[${i}] must be a valid URL: ${urlInit.baseUrl}`);
      }
      // De-duplicate by baseUrl, having two baseUrls with different token or timeouts does not make sense
      if (!this.urlsInits.some((opt) => opt.baseUrl === urlInit.baseUrl)) {
        this.urlsInits.push(urlInit);
      }
    }

    if (this.urlsInits.length === 0) {
      throw Error("Must set at least 1 URL in HttpClient opts");
    }

    // Initialize scores to max value to only query first URL on start
    this.urlsScore = this.urlsInits.map(() => URL_SCORE_MAX);

    this.fetch = opts.fetch ?? fetch;
    this.metrics = metrics ?? null;
    this.logger = logger ?? null;

    if (metrics) {
      metrics.urlsScore.addCollect(() => {
        for (let i = 0; i < this.urlsScore.length; i++) {
          metrics.urlsScore.set({urlIndex: i}, this.urlsScore[i]);
        }
      });
    }
  }

  async requestWithRetries<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    localInit: ApiRequestInit
  ): Promise<UnknownApiResponse<E>> {
    // Early return when no fallback URLs are setup
    if (this.urlsInits.length === 1) {
      return this.request(definition, args, localInit, 0);
    }

    let i = 0;

    // Goals:
    // - if first server is stable and responding do not query fallbacks
    // - if first server errors, retry that same request on fallbacks
    // - until first server is shown to be reliable again, contact all servers

    // First loop: retry in sequence, query next URL only after previous errors
    for (; i < this.urlsInits.length; i++) {
      try {
        return await new Promise<UnknownApiResponse<E>>((resolve, reject) => {
          let requestCount = 0;
          let errorCount = 0;

          // Second loop: query all URLs up to the next healthy at once, racing them.
          // Score each URL available:
          // - If url[0] is good, only send to 0
          // - If url[0] has recently errored, send to both 0, 1, etc until url[0] does not error for some time
          for (; i < this.urlsInits.length; i++) {
            const baseUrl = this.urlsInits[i].baseUrl;
            const routeId = definition.operationId;

            if (i > 0) {
              this.metrics?.requestToFallbacks.inc({routeId});
              this.logger?.debug("Requesting fallback URL", {routeId, baseUrl, score: this.urlsScore[i]});
            }

            // eslint-disable-next-line @typescript-eslint/naming-convention
            const i_ = i; // Keep local copy of i variable to index urlScore after requestWithBody() resolves

            this.request(definition, args, localInit, i).then(
              (res) => {
                this.urlsScore[i_] = Math.min(URL_SCORE_MAX, this.urlsScore[i_] + URL_SCORE_DELTA_SUCCESS);
                // Resolve immediately on success
                resolve(res);
              },
              (err) => {
                this.urlsScore[i_] = Math.max(URL_SCORE_MIN, this.urlsScore[i_] - URL_SCORE_DELTA_ERROR);

                // Reject only when all queried URLs have errored
                // TODO: Currently rejects with last error only, should join errors?
                if (++errorCount >= requestCount) {
                  reject(err);
                } else {
                  this.logger?.debug("Request error, retrying", {routeId, baseUrl}, err);
                }
              }
            );

            requestCount++;

            // Do not query URLs after a healthy URL
            if (this.urlsScore[i] >= URL_SCORE_MAX) {
              break;
            }
          }
        });
      } catch (e) {
        if (i >= this.urlsInits.length - 1) {
          throw e;
        } else {
          this.logger?.debug("Request error, retrying", {}, e as Error);
        }
      }
    }

    throw Error("loop ended without return or rejection");
  }

  async request<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    localInit: ApiRequestInit,
    urlIndex = 0
  ): Promise<UnknownApiResponse<E>> {
    const globalInit = this.urlsInits[urlIndex];
    if (globalInit === undefined) {
      throw new Error(`Url at index ${urlIndex} does not exist`);
    }
    const init = {
      ...globalInit,
      ...localInit,
      headers: mergeHeaders(globalInit.headers, localInit.headers),
    };

    // Implement fetch timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
    init.signal = controller.signal;

    // Attach global/local signal to this request's controller
    const onGlobalSignalAbort = (): void => controller.abort();
    const signalGlobal = globalInit.signal;
    const signalLocal = localInit.signal;
    signalGlobal?.addEventListener("abort", onGlobalSignalAbort);
    signalLocal?.addEventListener("abort", onGlobalSignalAbort);

    const routeId = definition.operationId;
    const timer = this.metrics?.requestTime.startTimer({routeId});

    try {
      this.logger?.debug("API request begin", {routeId});
      const request = createApiRequest(definition, args, init);
      const response = await fetch(request.url, request);
      const apiResponse = new ApiResponse(definition, response.body, response) as UnknownApiResponse<E>;

      if (!apiResponse.ok) {
        this.logger?.debug("API response error", {routeId});
        this.metrics?.requestErrors.inc({routeId});
        return apiResponse;
      }

      const streamTimer = this.metrics?.streamTime.startTimer();
      try {
        await apiResponse.rawBody();
        this.logger?.debug("API response success", {routeId});
        return apiResponse;
      } finally {
        streamTimer?.();
      }
    } catch (e) {
      this.metrics?.requestErrors.inc({routeId});

      if (isAbortedError(e as Error)) {
        if (signalGlobal?.aborted || signalLocal?.aborted) {
          throw new ErrorAborted("API client");
        } else if (controller.signal.aborted) {
          throw new TimeoutError("request");
        } else {
          throw Error("Unknown aborted error");
        }
      } else {
        throw e;
      }
    } finally {
      timer?.();

      clearTimeout(timeout);
      signalGlobal?.removeEventListener("abort", onGlobalSignalAbort);
      signalLocal?.removeEventListener("abort", onGlobalSignalAbort);
    }
  }
}

export function isAbortedError(e: Error): boolean {
  return isFetchError(e) && e.type === "aborted";
}
