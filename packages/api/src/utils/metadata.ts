/* eslint-disable @typescript-eslint/naming-convention */
import {ForkName} from "@lodestar/params";
import {RootHex} from "@lodestar/types";
import {ResponseMetadataCodec} from "./types.js";
import {toBoolean, toForkName} from "./serdes.js";

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
