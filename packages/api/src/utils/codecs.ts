/* eslint-disable @typescript-eslint/naming-convention */

import {ArrayType, ListBasicType, ListCompositeType, Type, isBasicType, isCompositeType} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {Root, Wei} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {ExecutionOptimistic} from "../beacon/routes/beacon/block.js";
import {
  AnyEndpoint,
  AnyGetEndpoint,
  AnyPostEndpoint,
  GetRequestCodec,
  PostRequestCodec,
  ResponseCodec,
  ResponseDataCodec,
  ResponseMetadataCodec,
} from "./types.js";
import {WireFormat} from "./headers.js";
import {toForkName} from "./serdes.js";

// Utility types / codecs

export type EmptyArgs = void;
export type EmptyRequest = Record<string, never>;
export type EmptyResponseData = void;

export type EmptyMeta = Record<string, never>;
export type ExecutionOptimisticMeta = {executionOptimistic: ExecutionOptimistic};
export type VersionMeta = {version: ForkName};
export type ExecutionOptimisticAndVersionMeta = ExecutionOptimisticMeta & VersionMeta;
export type ExecutionOptimisticAndDependentRootMeta = {executionOptimistic: ExecutionOptimistic; dependentRoot: Root};
export type BlockValuesMeta = {executionPayloadValue: Wei; consensusBlockValue: Wei};

/** Shortcut for routes that have no params, query */
export const EmptyGetRequestCodec: GetRequestCodec<AnyGetEndpoint> = {
  writeReq: () => ({}),
  parseReq: () => {},
  schema: {},
};
export const EmptyPostRequestCodec: PostRequestCodec<AnyPostEndpoint> = {
  writeReqJson: () => ({}),
  parseReqJson: () => {},
  writeReqSsz: () => ({body: new Uint8Array()}),
  parseReqSsz: () => {},
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

/** SSZ factory helper + typed. limit = 1e6 as a big enough random number */
export function ArrayOf<T>(elementType: Type<T>, limit = Infinity): ArrayType<Type<T>, unknown, unknown> {
  if (isCompositeType(elementType)) {
    return new ListCompositeType(elementType, limit) as unknown as ArrayType<Type<T>, unknown, unknown>;
  } else if (isBasicType(elementType)) {
    return new ListBasicType(elementType, limit) as unknown as ArrayType<Type<T>, unknown, unknown>;
  } else {
    throw Error(`Unknown type ${elementType.typeName}`);
  }
}

export function WithMeta<T, M extends {version: ForkName}>(getType: (m: M) => Type<T>): ResponseDataCodec<T, M> {
  return {
    toJson: (data, meta: M) => getType(meta).toJson(data),
    fromJson: (data, meta: M) => getType({...meta, version: toForkName(meta.version)}).fromJson(data),
    serialize: (data, meta: M) => getType(meta).serialize(data),
    deserialize: (data, meta: M) => getType({...meta, version: toForkName(meta.version)}).deserialize(data),
  };
}

export function WithVersion<T, M extends {version: ForkName}>(
  getType: (v: ForkName) => Type<T>
): ResponseDataCodec<T, M> {
  return {
    toJson: (data, meta: M) => getType(meta.version).toJson(data),
    fromJson: (data, meta: M) => getType(toForkName(meta.version)).fromJson(data),
    serialize: (data, meta: M) => getType(meta.version).serialize(data),
    deserialize: (data, meta: M) => getType(toForkName(meta.version)).deserialize(data),
  };
}

export const ExecutionOptimisticCodec: ResponseMetadataCodec<ExecutionOptimisticMeta> = {
  toJson: ({executionOptimistic}) => ({
    execution_optimistic: executionOptimistic,
  }),
  fromJson: (val) => ({
    executionOptimistic: (val as {execution_optimistic: boolean}).execution_optimistic,
  }),
  toHeadersObject: (val) => ({
    "Eth-Execution-Optimistic": String(val.executionOptimistic),
  }),
  fromHeaders: (val) => ({
    executionOptimistic: Boolean(val.get("Eth-Execution-Optimistic")),
  }),
};

export const VersionCodec: ResponseMetadataCodec<VersionMeta> = {
  toJson: (val) => val,
  fromJson: (val) => ({
    version: toForkName((val as {version: string}).version),
  }),
  toHeadersObject: (val) => ({
    "Eth-Consensus-Version": val.version,
  }),
  fromHeaders: (val) => ({
    version: toForkName(val.get("Eth-Consensus-Version")!),
  }),
};

export const ExecutionOptimisticAndVersionCodec: ResponseMetadataCodec<ExecutionOptimisticAndVersionMeta> = {
  toJson: ({executionOptimistic, version}) => ({
    execution_optimistic: executionOptimistic,
    version,
  }),
  fromJson: (val) => ({
    executionOptimistic: (val as {execution_optimistic: boolean}).execution_optimistic,
    version: toForkName((val as {version: string}).version),
  }),
  toHeadersObject: (val) => ({
    "Eth-Execution-Optimistic": String(val.executionOptimistic),
    "Eth-Consensus-Version": val.version,
  }),
  fromHeaders: (val) => ({
    executionOptimistic: Boolean(val.get("Eth-Execution-Optimistic")),
    version: toForkName(val.get("Eth-Consensus-Version")!),
  }),
};

export const ExecutionOptimisticAndDependentRootCodec: ResponseMetadataCodec<ExecutionOptimisticAndDependentRootMeta> =
  {
    toJson: ({executionOptimistic, dependentRoot}) => ({
      execution_optimistic: executionOptimistic,
      dependent_root: toHex(dependentRoot),
    }),
    fromJson: (val) => ({
      executionOptimistic: (val as {execution_optimistic: boolean}).execution_optimistic,
      dependentRoot: fromHex((val as {dependent_root: string}).dependent_root),
    }),
    toHeadersObject: (val) => ({
      "Eth-Execution-Optimistic": String(val.executionOptimistic),
      "Eth-Consensus-Dependent-Root": toHex(val.dependentRoot),
    }),
    fromHeaders: (val) => ({
      executionOptimistic: Boolean(val.get("Eth-Execution-Optimistic")),
      dependentRoot: fromHex(val.get("Eth-Consensus-Dependent-Root")!),
    }),
  };

export function WithBlockValues<M extends Record<string, unknown>>(
  meta: ResponseMetadataCodec<Omit<M, keyof BlockValuesMeta>>
): ResponseMetadataCodec<M & BlockValuesMeta> {
  return {
    toJson: (val) => ({
      ...(meta.toJson(val) as Record<string, unknown>),
      execution_payload_value: val.executionPayloadValue.toString(),
      consensus_block_value: val.consensusBlockValue.toString(),
    }),
    fromJson: (val) => ({
      ...(meta.fromJson(val) as M),
      // For cross client usage where beacon or validator are of separate clients, executionPayloadValue could be missing
      executionPayloadValue: BigInt((val as {execution_payload_value: string}).execution_payload_value ?? "0"),
      consensusBlockValue: BigInt((val as {consensus_block_value: string}).consensus_block_value ?? "0"),
    }),
    toHeadersObject: (val) => ({
      ...meta.toHeadersObject(val),
      "Eth-Execution-Payload-Value": val.executionPayloadValue.toString(),
      "Eth-Consensus-Block-Value": val.consensusBlockValue.toString(),
    }),
    fromHeaders: (val) => ({
      ...(meta.fromHeaders(val) as M),
      // For cross client usage where beacon or validator are of separate clients, executionPayloadValue could be missing
      executionPayloadValue: BigInt(val.get("Eth-Execution-Payload-Value") ?? "0"),
      consensusBlockValue: BigInt(val.get("Eth-Consensus-Block-Value") ?? "0"),
    }),
  };
}

export const EmptyResponseCodec: ResponseCodec<AnyEndpoint> = {
  data: EmptyResponseDataCodec,
  meta: EmptyMetaCodec,
};

export const JsonOnlyResponseCodec: ResponseCodec<AnyEndpoint> = {
  data: {
    toJson: (d) => d as unknown,
    fromJson: (d) => d,
    serialize: () => {
      throw new Error("unimplemented");
    },
    deserialize: () => {
      throw new Error("unimplemented");
    },
  },
  meta: EmptyMetaCodec,
  onlySupport: WireFormat.json,
};
