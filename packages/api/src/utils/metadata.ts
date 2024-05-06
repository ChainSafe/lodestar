/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {StringType, ssz, stringType} from "@lodestar/types";
import {ResponseMetadataCodec} from "./types.js";
import {toBoolean, toForkName} from "./serdes.js";

export const VersionType = new ContainerType({
  /**
   * Fork code name
   */
  version: new StringType<ForkName>(),
});
VersionType.fields.version.fromJson = (json) => {
  if (typeof json !== "string") {
    throw Error(`JSON invalid type ${typeof json} expected string`);
  }
  return toForkName(json);
};

export const ExecutionOptimisticType = new ContainerType(
  {
    /**
     * True if the response references an unverified execution payload.
     * Optimistic information may be invalidated at a later time.
     */
    executionOptimistic: ssz.Boolean,
  },
  {jsonCase: "eth2"}
);

export const ExecutionOptimisticAndFinalizedType = new ContainerType(
  {
    ...ExecutionOptimisticType.fields,
    /**
     * True if the response references the finalized history of the chain, as determined by fork choice
     */
    finalized: ssz.Boolean,
  },
  {jsonCase: "eth2"}
);

export const ExecutionOptimisticAndVersionType = new ContainerType(
  {
    ...ExecutionOptimisticType.fields,
    ...VersionType.fields,
  },
  {jsonCase: "eth2"}
);

export const ExecutionOptimisticFinalizedAndVersionType = new ContainerType(
  {
    ...ExecutionOptimisticAndFinalizedType.fields,
    ...VersionType.fields,
  },
  {jsonCase: "eth2"}
);

export const ExecutionOptimisticAndDependentRootType = new ContainerType(
  {
    ...ExecutionOptimisticType.fields,
    /**
     * The block root that this response is dependent on
     */
    dependentRoot: stringType,
  },
  {jsonCase: "eth2"}
);

export type VersionMeta = ValueOf<typeof VersionType>;
export type ExecutionOptimisticMeta = ValueOf<typeof ExecutionOptimisticType>;
export type ExecutionOptimisticAndFinalizedMeta = ValueOf<typeof ExecutionOptimisticAndFinalizedType>;
export type ExecutionOptimisticAndVersionMeta = ValueOf<typeof ExecutionOptimisticAndVersionType>;
export type ExecutionOptimisticFinalizedAndVersionMeta = ValueOf<typeof ExecutionOptimisticFinalizedAndVersionType>;
export type ExecutionOptimisticAndDependentRootMeta = ValueOf<typeof ExecutionOptimisticAndDependentRootType>;

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
  toJson: (val) => ExecutionOptimisticType.toJson(val),
  fromJson: (val) => ExecutionOptimisticType.fromJson(val),
  toHeadersObject: (val) => ({
    [MetaHeader.ExecutionOptimistic]: val.executionOptimistic.toString(),
  }),
  fromHeaders: (headers) => ({
    executionOptimistic: toBoolean(headers.getOrDefault(MetaHeader.ExecutionOptimistic, "false")),
  }),
};

export const VersionCodec: ResponseMetadataCodec<VersionMeta> = {
  toJson: (val) => VersionType.toJson(val),
  fromJson: (val) => VersionType.fromJson(val),
  toHeadersObject: (val) => ({
    [MetaHeader.Version]: val.version,
  }),
  fromHeaders: (headers) => ({
    version: toForkName(headers.getRequired(MetaHeader.Version)),
  }),
};

export const ExecutionOptimisticAndVersionCodec: ResponseMetadataCodec<ExecutionOptimisticAndVersionMeta> = {
  toJson: (val) => ExecutionOptimisticAndVersionType.toJson(val),
  fromJson: (val) => ExecutionOptimisticAndVersionType.fromJson(val),
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
  toJson: (val) => ExecutionOptimisticAndFinalizedType.toJson(val),
  fromJson: (val) => ExecutionOptimisticAndFinalizedType.fromJson(val),
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
    toJson: (val) => ExecutionOptimisticFinalizedAndVersionType.toJson(val),
    fromJson: (val) => ExecutionOptimisticFinalizedAndVersionType.fromJson(val),
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
    toJson: (val) => ExecutionOptimisticAndDependentRootType.toJson(val),
    fromJson: (val) => ExecutionOptimisticAndDependentRootType.fromJson(val),
    toHeadersObject: (val) => ({
      [MetaHeader.ExecutionOptimistic]: val.executionOptimistic.toString(),
      [MetaHeader.DependentRoot]: val.dependentRoot,
    }),
    fromHeaders: (headers) => ({
      executionOptimistic: toBoolean(headers.getOrDefault(MetaHeader.ExecutionOptimistic, "false")),
      dependentRoot: headers.getRequired(MetaHeader.DependentRoot),
    }),
  };
