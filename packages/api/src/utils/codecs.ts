/* eslint-disable @typescript-eslint/naming-convention */

import {ArrayType, ListBasicType, ListCompositeType, Type, isBasicType, isCompositeType} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {Root} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {ExecutionOptimistic} from "../beacon/routes/beacon/block.js";
import {Endpoint, GetRequestCodec, ResponseDataCodec, ResponseMetadataCodec} from "./types.js";

// Utility types / codecs

export type EmptyArgs = void;
export type EmptyRequest = Record<string, never>;
export type EmptyResponseData = void;

export type EmptyMeta = Record<string, never>;
export type ExecutionOptimisticMeta = {executionOptimistic: ExecutionOptimistic};
export type VersionMeta = {version: ForkName};
export type ExecutionOptimisticAndVersionMeta = ExecutionOptimisticMeta & VersionMeta;
export type ExecutionOptimisticAndDependentRootMeta = {executionOptimistic: ExecutionOptimistic; dependentRoot: Root};

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

export const ExecutionOptimisticCodec: ResponseMetadataCodec<ExecutionOptimisticMeta> = {
  toJson: (val) => val,
  fromJson: (val) => val as ExecutionOptimisticAndVersionMeta,
  toHeadersObject: (val) => ({
    "Eth-Execution-Optimistic": String(val.executionOptimistic),
  }),
  fromHeaders: (val) => ({
    executionOptimistic: Boolean(val.get("Eth-Execution-Optimistic")),
  }),
};

export const VersionCodec: ResponseMetadataCodec<VersionMeta> = {
  toJson: (val) => val,
  fromJson: (val) => val as VersionMeta,
  toHeadersObject: (val) => ({
    "Eth-Consensus-Version": val.version,
  }),
  fromHeaders: (val) => ({
    version: val.get("Eth-Consensus-Version")!.toLowerCase() as ForkName,
  }),
};

export const ExecutionOptimisticAndVersionCodec: ResponseMetadataCodec<ExecutionOptimisticAndVersionMeta> = {
  toJson: (val) => val,
  fromJson: (val) => val as ExecutionOptimisticAndVersionMeta,
  toHeadersObject: (val) => ({
    "Eth-Execution-Optimistic": String(val.executionOptimistic),
    "Eth-Consensus-Version": val.version,
  }),
  fromHeaders: (val) => ({
    executionOptimistic: Boolean(val.get("Eth-Execution-Optimistic")),
    version: val.get("Eth-Consensus-Version")!.toLowerCase() as ForkName,
  }),
};

export const ExecutionOptimisticAndDependentRootCodec: ResponseMetadataCodec<ExecutionOptimisticAndDependentRootMeta> =
  {
    toJson: ({executionOptimistic, dependentRoot}) => ({executionOptimistic, dependentRoot: toHex(dependentRoot)}),
    fromJson: (val) =>
      ({
        executionOptimistic: (val as any).executionOptimistic as boolean,
        dependentRoot: fromHex((val as any).dependentRoot),
      }) as ExecutionOptimisticAndDependentRootMeta,
    toHeadersObject: (val) => ({
      "Eth-Execution-Optimistic": String(val.executionOptimistic),
      "Eth-Consensus-Dependent-Root": toHex(val.dependentRoot),
    }),
    fromHeaders: (val) => ({
      executionOptimistic: Boolean(val.get("Eth-Execution-Optimistic")),
      dependentRoot: fromHex(val.get("Eth-Consensus-Dependent-Root")!),
    }),
  };
