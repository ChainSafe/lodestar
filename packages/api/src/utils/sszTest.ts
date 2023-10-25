import {Type} from "@chainsafe/ssz";
import {Epoch, Root, ValidatorIndex, allForks, ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {ExecutionOptimistic} from "../beacon/routes/beacon/block.js";
import {StateId} from "../beacon/routes/beacon/index.js";
import {AttesterDuty} from "../beacon/routes/validator.js";
import {Schema, SchemaDefinition} from "./schema.js";

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

export type EndpointType = "GET" | "POST" | "DELETE";

export type Endpoint<
  Type extends EndpointType = EndpointType,
  ParamsType = unknown,
  RequestType extends Type extends "GET" ? GetRequestData : PostRequestData<{}, unknown> = GetRequestData,
  ReturnType = unknown,
  Meta = unknown,
> = {
  type: Type;
  /** the parameters the client passes / server app code ingests */
  params: ParamsType;
  /** the parameters in the http request */
  request: RequestType;
  /** the return data */
  return: ReturnType;
  /** the return metadata */
  meta: Meta;
}
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
export type ReqCodec<E extends Endpoint> = E["type"] extends "GET" ? GetReqCodec<E> : PostReqCodec<E>;

// Showing some usage of Endpoint(s), a GET and a POST
export type ExecutionOptimisticAndVersion = { executionOptimistic: ExecutionOptimistic;  version: ForkName }

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
    {epoch: Epoch; indices: ValidatorIndex[]},
    {params: {epoch: number}; body: string[]},
    AttesterDuty[],
    {executionOptimistic: ExecutionOptimistic; dependentRoot: Root}
  >;
};

export const getStateReqCodec: ReqCodec<TestEndpoints["getState"]> = {
  writeReqJson: ({stateId}) => ({params: {state_id: String(stateId)}}),
  parseReqJson: ({params}) => ({stateId: params.state_id}),
  schema: {params: {state_id: Schema.StringRequired}},
};

// POST req codecs include *Ssz functions to translate to / from ssz bodies
export const getAttesterDutiesReqCodec: ReqCodec<TestEndpoints["getAttesterDuties"]> = {
  writeReqJson: ({epoch, indices}) => ({params: {epoch}, body: indices.map(String)}),
  parseReqJson: ({params, body}) => ({epoch: params.epoch, indices: body.map(Number)}),
  schema: {params: {epoch: Schema.UintRequired}, body: Schema.StringArray},
  writeReqSsz: ({epoch, indices}) => ({params: {epoch}, body: ssz.ValidatorIndices.serialize(indices)}),
  parseReqSsz: ({params, body}) => ({epoch: params.epoch, indices: ssz.ValidatorIndices.deserialize(body)}),
};

export type ResponseDataCodec<T, M> = {
  toJson: (data: T, meta: M) => unknown; // server
  fromJson: (data: unknown, meta: M) => T; // client
  toSsz: (data: T, meta: M) => Uint8Array; // server
  fromSsz: (data: Uint8Array, meta: M) => T; // client
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

export function WithVersion<T, M extends {version: ForkName}>(
  getType: (v: ForkName) => Type<T>
): ResponseDataCodec<T, M> {
  return {
    toJson: (data, meta: M) => getType(meta.version).toJson(data),
    fromJson: (data, meta: M) => getType(meta.version).fromJson(data),
    toSsz: (data, meta: M) => getType(meta.version).serialize(data),
    fromSsz: (data, meta: M) => getType(meta.version).deserialize(data),
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
  })
}

export const getStateRespCodec: ResponseCodec<TestEndpoints["getState"]> = {
  data: WithVersion((forkName) => ssz[forkName].BeaconState as unknown as Type<allForks.BeaconState>),
  meta: ExecutionOptimisticAndVersionCodec,
};
