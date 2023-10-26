/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, ListBasicType, ListCompositeType, Type, ValueOf} from "@chainsafe/ssz";
import {Epoch, Root, allForks, ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {fromHex, toHex} from "@lodestar/utils";
import {ExecutionOptimistic} from "../beacon/routes/beacon/block.js";
import {StateId} from "../beacon/routes/beacon/index.js";
import {AttesterDuty} from "../beacon/routes/validator.js";
import {Schema, SchemaDefinition} from "./schema.js";

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

type ValidatorIndicesType = ValueOf<typeof ValidatorIndices>;
type AttesterDutiesType = ValueOf<typeof AttesterDuties>;

// Endpoint

export type GetRequestData = {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | (string | number)[]>;
};

export type PostRequestData<P extends Record<string, string | number>, B> = {
  params?: P;
  body?: B;
};

export type SszPostRequestData<P extends PostRequestData<Record<string, string | number>, unknown>> = {
  params: P["params"];
  body: P["body"] extends undefined ? undefined : Buffer;
};

export type EndpointMethod = "GET" | "POST" | "DELETE";

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
  Method extends EndpointMethod = EndpointMethod,
  ParamsType = unknown,
  RequestType extends Method extends "GET"
    ? GetRequestData
    : PostRequestData<Record<string, string | number>, unknown> = GetRequestData,
  ReturnType = unknown,
  Meta = unknown,
> = {
  method: Method;
  /** the parameters the client passes / server app code ingests */
  params: ParamsType;
  /** the parameters in the http request */
  request: RequestType;
  /** the return data */
  return: ReturnType;
  /** the return metadata */
  meta: Meta;
};

// Request codec

/** Encode / decode requests to & from function params, as well as schema definitions */
export type GetReqCodec<E extends Endpoint> = {
  writeReqJson: (p: E["params"]) => E["request"];
  parseReqJson: (r: E["request"]) => E["params"];
  schema: SchemaDefinition<E["request"]>;
};

export type PostReqCodec<E extends Endpoint> = GetReqCodec<E> & {
  writeReqSsz: (p: E["params"]) => SszPostRequestData<E["request"]>;
  parseReqSsz: (r: SszPostRequestData<E["request"]>) => E["params"];
};

/**
 * Previously called ReqSerializer
 * this handles translating between Endpoint["params"] and Endpoint["request"]
 *
 * TODO: Should this be split into separate serialize and deserialize + schema objects?
 * For separate consumption by client and server.
 * Taking this idea to the extreme, Each group of endpoints would have definitions split into three files for nice treeshaking (types, client, server)
 */
export type RequestCodec<E extends Endpoint> = E["method"] extends "GET" ? GetReqCodec<E> : PostReqCodec<E>;

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
  toHeaders: (val: T) => Headers; // server
  fromHeaders: (val: Headers) => T; // server
};

export type ResponseCodec<E extends Endpoint> = {
  data: ResponseDataCodec<E["return"], E["meta"]>;
  meta: ResponseMetadataCodec<E["meta"]>;
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
  statusOk?: number; // only used for keymanager to set non-200 ok
  req: RequestCodec<E>;
  resp: ResponseCodec<E>;
};

export type RouteDefinitions<Es extends Record<string, Endpoint>> = {[K in keyof Es]: RouteDefinition<Es[K]>};

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
  toHeaders: (val) =>
    new Headers([
      ["Execution-Optimistic", String(val.executionOptimistic)],
      ["Eth-Consensus-Version", val.version],
    ]),
  fromHeaders: (val) => ({
    executionOptimistic: Boolean(val.get("Execution-Optimistic")),
    version: val.get("Eth-Consensus-Version")!.toLowerCase() as ForkName,
  }),
};

export const ExecutionOptimisticAndDependentRootCodec: ResponseMetadataCodec<ExecutionOptimisticAndDependentRoot> = {
  toJson: ({executionOptimistic, dependentRoot}) => ({executionOptimistic, dependentRoot: toHex(dependentRoot)}),
  fromJson: (val) =>
    ({
      executionOptimistic: (val as any).executionOptimistic as boolean,
      dependentRoot: fromHex((val as any).dependentRoot),
    }) as ExecutionOptimisticAndDependentRoot,
  toHeaders: (val) =>
    new Headers([
      ["Execution-Optimistic", String(val.executionOptimistic)],
      ["Dependent-Root", toHex(val.dependentRoot)],
    ]),
  fromHeaders: (val) => ({
    executionOptimistic: Boolean(val.get("Execution-Optimistic")),
    dependentRoot: fromHex(val.get("Dependent-Root")!),
  }),
};

export type ExecutionOptimisticAndVersion = {executionOptimistic: ExecutionOptimistic; version: ForkName};
export type ExecutionOptimisticAndDependentRoot = {executionOptimistic: ExecutionOptimistic; dependentRoot: Root};

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
};

// Then route definitions

export const definitions: RouteDefinitions<TestEndpoints> = {
  getState: {
    url: "/eth/v2/debug/beacon/states/{state_id}",
    method: "GET",
    req: {
      writeReqJson: ({stateId}) => ({params: {state_id: String(stateId)}}),
      parseReqJson: ({params}) => ({stateId: params.state_id}),
      schema: {params: {state_id: Schema.StringRequired}},
    },
    resp: {
      data: WithVersion((forkName) => ssz[forkName].BeaconState as unknown as Type<allForks.BeaconState>),
      meta: ExecutionOptimisticAndVersionCodec,
    },
  },
  getAttesterDuties: {
    url: "/eth/v1/validator/duties/attester/{epoch}",
    method: "POST",
    // POST request codecs include *Ssz functions to translate to / from ssz bodies
    req: {
      writeReqJson: ({epoch, indices}) => ({params: {epoch}, body: indices.map(String)}),
      parseReqJson: ({params, body}) => ({epoch: params.epoch, indices: body.map(Number)}),
      schema: {params: {epoch: Schema.UintRequired}, body: Schema.StringArray},
      writeReqSsz: ({epoch, indices}) => ({params: {epoch}, body: Buffer.from(ValidatorIndices.serialize(indices))}),
      parseReqSsz: ({params, body}) => ({epoch: params.epoch, indices: ValidatorIndices.deserialize(body)}),
    },
    resp: {
      data: AttesterDuties,
      meta: ExecutionOptimisticAndDependentRootCodec,
    },
  },
};
