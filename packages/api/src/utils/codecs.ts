/* eslint-disable @typescript-eslint/naming-convention */
import {ArrayType, ListBasicType, ListCompositeType, Type, isBasicType, isCompositeType} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {RootHex} from "@lodestar/types";
import {objectToExpectedCase} from "@lodestar/utils";
import {
  GetRequestCodec,
  PostRequestCodec,
  ResponseCodec,
  ResponseDataCodec,
  ResponseMetadataCodec,
  Endpoint,
  SszRequestMethods,
  JsonRequestMethods,
} from "./types.js";
import {toBoolean, toForkName} from "./serdes.js";
import {WireFormat} from "./wireFormat.js";

// Utility types / codecs

export type EmptyArgs = void;
export type EmptyRequest = Record<string, void>;
export type EmptyResponseData = void;

export type EmptyMeta = void;
export type VersionMeta = {
  /**
   * Fork code name
   */
  version: ForkName;
};
export type ExecutionOptimisticMeta = {
  /**
   * True if the response references an unverified execution payload.
   * Optimistic information may be invalidated at a later time.
   */
  executionOptimistic: boolean;
};
export type ExecutionOptimisticAndFinalizedMeta = ExecutionOptimisticMeta & {
  /**
   * True if the response references the finalized history of the chain, as determined by fork choice
   */
  finalized: boolean;
};
export type ExecutionOptimisticAndVersionMeta = ExecutionOptimisticMeta & VersionMeta;
export type ExecutionOptimisticFinalizedAndVersionMeta = ExecutionOptimisticAndFinalizedMeta & VersionMeta;
export type ExecutionOptimisticAndDependentRootMeta = ExecutionOptimisticMeta & {
  /**
   * The block root that this response is dependent on
   */
  dependentRoot: RootHex;
};

export enum MetaHeader {
  Version = "Eth-Consensus-Version",
  Finalized = "Eth-Consensus-Finalized",
  DependentRoot = "Eth-Consensus-Dependent-Root",
  ConsensusBlockValue = "Eth-Consensus-Block-Value",
  ExecutionOptimistic = "Eth-Execution-Optimistic",
  ExecutionPayloadSource = "Eth-Execution-Payload-Source",
  ExecutionPayloadBlinded = "Eth-Execution-Payload-Blinded",
  ExecutionPayloadValue = "Eth-Execution-Payload-Value",
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyEndpoint = Endpoint<any, any, any, any, any>;
export type EmptyRequestEndpoint = Endpoint<any, EmptyArgs, EmptyRequest, any, any>;
export type EmptyResponseEndpoint = Endpoint<any, any, any, EmptyResponseData, EmptyMeta>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Shortcut for routes that have no params, query */
export const EmptyGetRequestCodec: GetRequestCodec<EmptyRequestEndpoint> = {
  writeReq: () => ({}),
  parseReq: () => {},
  schema: {},
};
export const EmptyPostRequestCodec: PostRequestCodec<EmptyRequestEndpoint> = {
  writeReqJson: () => ({}),
  parseReqJson: () => {},
  writeReqSsz: () => ({}),
  parseReqSsz: () => {},
  schema: {},
};

export function JsonOnlyReq<E extends Endpoint>(
  req: Omit<PostRequestCodec<E>, keyof SszRequestMethods<E>>
): PostRequestCodec<E> {
  return {
    ...req,
    writeReqSsz: () => {
      throw Error("Not implemented");
    },
    parseReqSsz: () => {
      throw Error("Not implemented");
    },
    onlySupport: WireFormat.json,
  };
}

export function SszOnlyReq<E extends Endpoint>(
  req: Omit<PostRequestCodec<E>, keyof JsonRequestMethods<E>>
): PostRequestCodec<E> {
  return {
    ...req,
    writeReqJson: () => {
      throw Error("Not implemented");
    },
    parseReqJson: () => {
      throw Error("Not implemented");
    },
    onlySupport: WireFormat.ssz,
  };
}

export const EmptyResponseDataCodec: ResponseDataCodec<EmptyResponseData, EmptyMeta> = {
  toJson: () => {},
  fromJson: () => {},
  serialize: () => new Uint8Array(),
  deserialize: () => {},
};

export const EmptyMetaCodec: ResponseMetadataCodec<EmptyMeta> = {
  toJson: () => {},
  fromJson: () => {},
  toHeadersObject: () => ({}),
  fromHeaders: () => {},
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
  toJson: (val) => ({
    execution_optimistic: val.executionOptimistic,
  }),
  fromJson: (val) => ({
    executionOptimistic: (val as {execution_optimistic: boolean}).execution_optimistic,
  }),
  toHeadersObject: (val) => ({
    [MetaHeader.ExecutionOptimistic]: val.executionOptimistic.toString(),
  }),
  fromHeaders: (headers) => ({
    executionOptimistic: toBoolean(headers.getOrDefault(MetaHeader.ExecutionOptimistic, "false")),
  }),
};

export const VersionCodec: ResponseMetadataCodec<VersionMeta> = {
  toJson: (val) => ({version: val.version}),
  fromJson: (val) => ({
    version: toForkName((val as {version: string}).version),
  }),
  toHeadersObject: (val) => ({
    [MetaHeader.Version]: val.version,
  }),
  fromHeaders: (headers) => ({
    version: toForkName(headers.getRequired(MetaHeader.Version)),
  }),
};

export const ExecutionOptimisticAndVersionCodec: ResponseMetadataCodec<ExecutionOptimisticAndVersionMeta> = {
  toJson: (val) => ({
    execution_optimistic: val.executionOptimistic,
    version: val.version,
  }),
  fromJson: (val) => ({
    executionOptimistic: (val as {execution_optimistic: boolean}).execution_optimistic,
    version: toForkName((val as {version: string}).version),
  }),
  toHeadersObject: (val) => ({
    [MetaHeader.ExecutionOptimistic]: val.executionOptimistic.toString(),
    [MetaHeader.Version]: val.version,
  }),
  fromHeaders: (headers) => ({
    executionOptimistic: toBoolean(headers.getOrDefault(MetaHeader.ExecutionOptimistic, "false")),
    version: toForkName(headers.getRequired(MetaHeader.Version)),
  }),
};

export const ExecutionOptimisticAndFinalizedCodec: ResponseMetadataCodec<ExecutionOptimisticAndFinalizedMeta> = {
  toJson: (val) => ({
    execution_optimistic: val.executionOptimistic,
    finalized: val.finalized,
  }),
  fromJson: (val) => ({
    executionOptimistic: (val as {execution_optimistic: boolean}).execution_optimistic,
    finalized: (val as {finalized: boolean}).finalized,
  }),
  toHeadersObject: (val) => ({
    [MetaHeader.ExecutionOptimistic]: val.executionOptimistic.toString(),
    [MetaHeader.Finalized]: val.finalized.toString(),
  }),
  fromHeaders: (headers) => ({
    executionOptimistic: toBoolean(headers.getOrDefault(MetaHeader.ExecutionOptimistic, "false")),
    finalized: toBoolean(headers.getOrDefault(MetaHeader.Finalized, "false")),
  }),
};

export const ExecutionOptimisticFinalizedAndVersionCodec: ResponseMetadataCodec<ExecutionOptimisticFinalizedAndVersionMeta> =
  {
    toJson: (val) => ({
      execution_optimistic: val.executionOptimistic,
      finalized: val.finalized,
      version: val.version,
    }),
    fromJson: (val) => ({
      executionOptimistic: (val as {execution_optimistic: boolean}).execution_optimistic,
      finalized: (val as {finalized: boolean}).finalized,
      version: toForkName((val as {version: string}).version),
    }),
    toHeadersObject: (val) => ({
      [MetaHeader.ExecutionOptimistic]: val.executionOptimistic.toString(),
      [MetaHeader.Finalized]: val.finalized.toString(),
      [MetaHeader.Version]: val.version,
    }),
    fromHeaders: (headers) => ({
      executionOptimistic: toBoolean(headers.getOrDefault(MetaHeader.ExecutionOptimistic, "false")),
      finalized: toBoolean(headers.getOrDefault(MetaHeader.Finalized, "false")),
      version: toForkName(headers.getRequired(MetaHeader.Version)),
    }),
  };

export const ExecutionOptimisticAndDependentRootCodec: ResponseMetadataCodec<ExecutionOptimisticAndDependentRootMeta> =
  {
    toJson: (val) => ({
      execution_optimistic: val.executionOptimistic,
      dependent_root: val.dependentRoot,
    }),
    fromJson: (val) => ({
      executionOptimistic: (val as {execution_optimistic: boolean}).execution_optimistic,
      dependentRoot: (val as {dependent_root: string}).dependent_root,
    }),
    toHeadersObject: (val) => ({
      [MetaHeader.ExecutionOptimistic]: val.executionOptimistic.toString(),
      [MetaHeader.DependentRoot]: val.dependentRoot,
    }),
    fromHeaders: (headers) => ({
      executionOptimistic: toBoolean(headers.getOrDefault(MetaHeader.ExecutionOptimistic, "false")),
      dependentRoot: headers.getRequired(MetaHeader.DependentRoot),
    }),
  };

export const EmptyResponseCodec: ResponseCodec<EmptyResponseEndpoint> = {
  data: EmptyResponseDataCodec,
  meta: EmptyMetaCodec,
  isEmpty: true,
};

export const JsonOnlyResponseCodec: ResponseCodec<AnyEndpoint> = {
  data: {
    toJson: (d) => objectToExpectedCase(d as Record<string, unknown>, "snake"),
    fromJson: (d) => objectToExpectedCase(d as Record<string, unknown>, "camel"),
    serialize: () => {
      throw Error("Not implemented");
    },
    deserialize: () => {
      throw Error("Not implemented");
    },
  },
  meta: EmptyMetaCodec,
  onlySupport: WireFormat.json,
};
