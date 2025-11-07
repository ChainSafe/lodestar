import {ArchiveMode, DEFAULT_ARCHIVE_MODE, IBeaconNodeOptions, defaultOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";
import {ensure0xPrefix} from "../../util/format.js";

export type ChainArgs = {
  suggestedFeeRecipient: string;
  serveHistoricalState?: boolean;
  "chain.blacklistedBlocks"?: string[];
  "chain.blsVerifyAllMultiThread"?: boolean;
  "chain.blsVerifyAllMainThread"?: boolean;
  "chain.disableBlsBatchVerify"?: boolean;
  "chain.persistProducedBlocks"?: boolean;
  "chain.persistInvalidSszObjects"?: boolean;
  // No need to define chain.persistInvalidSszObjects as part of ChainArgs
  // as this is defined as part of BeaconPaths
  // "chain.persistInvalidSszObjectsDir": string;
  "chain.persistOrphanedBlocks"?: boolean;
  "chain.proposerBoost"?: boolean;
  "chain.proposerBoostReorg"?: boolean;
  "chain.disableImportExecutionFcU"?: boolean;
  "chain.preaggregateSlotDistance"?: number;
  "chain.attDataCacheSlotDistance"?: number;
  "chain.computeUnrealized"?: boolean;
  "chain.assertCorrectProgressiveBalances"?: boolean;
  "chain.maxSkipSlots"?: number;
  "safe-slots-to-import-optimistically": number;
  emitPayloadAttributes?: boolean;
  broadcastValidationStrictness?: string;
  "chain.minSameMessageSignatureSetsToBatch"?: number;
  "chain.maxShufflingCacheEpochs"?: number;
  "chain.archiveStateEpochFrequency": number;
  "chain.archiveDataEpochs"?: number;
  "chain.archiveMode": ArchiveMode;
  "chain.nHistoricalStates"?: boolean;
  "chain.nHistoricalStatesFileDataStore"?: boolean;
  "chain.maxBlockStates"?: number;
  "chain.maxCPStateEpochsInMemory"?: number;
  "chain.maxCPStateEpochsOnDisk"?: number;

  "chain.pruneHistory"?: boolean;
};

export function parseArgs(args: ChainArgs): IBeaconNodeOptions["chain"] {
  return {
    suggestedFeeRecipient: args.suggestedFeeRecipient,
    serveHistoricalState: args.serveHistoricalState,
    blacklistedBlocks: args["chain.blacklistedBlocks"],
    blsVerifyAllMultiThread: args["chain.blsVerifyAllMultiThread"],
    blsVerifyAllMainThread: args["chain.blsVerifyAllMainThread"],
    disableBlsBatchVerify: args["chain.disableBlsBatchVerify"],
    persistProducedBlocks: args["chain.persistProducedBlocks"],
    persistInvalidSszObjects: args["chain.persistInvalidSszObjects"],
    // biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
    persistInvalidSszObjectsDir: undefined as any,
    persistOrphanedBlocks: args["chain.persistOrphanedBlocks"],
    // biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
    persistOrphanedBlocksDir: undefined as any,
    proposerBoost: args["chain.proposerBoost"],
    proposerBoostReorg: args["chain.proposerBoostReorg"],
    disableImportExecutionFcU: args["chain.disableImportExecutionFcU"],
    preaggregateSlotDistance: args["chain.preaggregateSlotDistance"],
    attDataCacheSlotDistance: args["chain.attDataCacheSlotDistance"],
    computeUnrealized: args["chain.computeUnrealized"],
    assertCorrectProgressiveBalances: args["chain.assertCorrectProgressiveBalances"],
    maxSkipSlots: args["chain.maxSkipSlots"],
    safeSlotsToImportOptimistically: args["safe-slots-to-import-optimistically"],
    emitPayloadAttributes: args.emitPayloadAttributes,
    broadcastValidationStrictness: args.broadcastValidationStrictness,
    minSameMessageSignatureSetsToBatch:
      args["chain.minSameMessageSignatureSetsToBatch"] ?? defaultOptions.chain.minSameMessageSignatureSetsToBatch,
    maxShufflingCacheEpochs: args["chain.maxShufflingCacheEpochs"] ?? defaultOptions.chain.maxShufflingCacheEpochs,
    archiveStateEpochFrequency: args["chain.archiveStateEpochFrequency"],
    archiveDataEpochs: args["chain.archiveDataEpochs"],
    archiveMode: args["chain.archiveMode"] ?? defaultOptions.chain.archiveMode,
    nHistoricalStates: args["chain.nHistoricalStates"] ?? defaultOptions.chain.nHistoricalStates,
    nHistoricalStatesFileDataStore:
      args["chain.nHistoricalStatesFileDataStore"] ?? defaultOptions.chain.nHistoricalStatesFileDataStore,
    maxBlockStates: args["chain.maxBlockStates"] ?? defaultOptions.chain.maxBlockStates,
    maxCPStateEpochsInMemory: args["chain.maxCPStateEpochsInMemory"] ?? defaultOptions.chain.maxCPStateEpochsInMemory,
    maxCPStateEpochsOnDisk: args["chain.maxCPStateEpochsOnDisk"] ?? defaultOptions.chain.maxCPStateEpochsOnDisk,
    pruneHistory: args["chain.pruneHistory"],
  };
}

export const options: CliCommandOptions<ChainArgs> = {
  suggestedFeeRecipient: {
    type: "string",
    description:
      "Specify fee recipient default for collecting the EL block fees and rewards (a hex string representing 20 bytes address: ^0x[a-fA-F0-9]{40}$) in case validator fails to update for a validator index before calling `produceBlock`.",
    default: defaultOptions.chain.suggestedFeeRecipient,
    group: "chain",
  },

  emitPayloadAttributes: {
    type: "boolean",
    defaultDescription: String(defaultOptions.chain.emitPayloadAttributes),
    description: "Flag to SSE emit execution `payloadAttributes` before every slot",
    group: "chain",
  },

  serveHistoricalState: {
    description:
      "Enable regenerating finalized state to serve historical data. Fetching this data is expensive and may affect validator performance.",
    type: "boolean",
    default: defaultOptions.chain.serveHistoricalState,
    group: "chain",
  },

  "chain.blsVerifyAllMultiThread": {
    hidden: true,
    type: "boolean",
    description: "Always use worker threads for BLS verification",
    defaultDescription: String(defaultOptions.chain.blsVerifyAllMultiThread),
    group: "chain",
  },

  "chain.blsVerifyAllMainThread": {
    hidden: true,
    type: "boolean",
    description: "Always use main threads for BLS verification",
    defaultDescription: String(defaultOptions.chain.blsVerifyAllMainThread),
    group: "chain",
  },

  "chain.blacklistedBlocks": {
    hidden: true,
    type: "array",
    string: true,
    description:
      "Comma-separated list of 0x-prefixed root hex's for blocks that should not be allowed through processing",
    group: "chain",
    coerce: (blocks: string[]): string[] =>
      blocks
        .flatMap((hex) => hex.split(","))
        .map((hex) => hex.trim())
        .map(ensure0xPrefix),
  },

  "chain.disableBlsBatchVerify": {
    hidden: true,
    type: "boolean",
    description:
      "Do not use BLS batch verify to validate all block signatures at once. \
Will double processing times. Use only for debugging purposes.",
    defaultDescription: String(defaultOptions.chain.blsVerifyAllMultiThread),
    group: "chain",
  },

  "chain.persistProducedBlocks": {
    hidden: true,
    type: "boolean",
    description: "Persist produced blocks or not for debugging purpose",
    group: "chain",
  },

  "chain.persistInvalidSszObjects": {
    hidden: true,
    type: "boolean",
    description: "Persist invalid ssz objects or not for debugging purpose",
    group: "chain",
  },

  "chain.persistOrphanedBlocks": {
    hidden: true,
    type: "boolean",
    description: "Whether to persist orphaned blocks",
    group: "chain",
  },

  "chain.proposerBoost": {
    alias: ["chain.proposerBoostEnabled"],
    hidden: true,
    type: "boolean",
    description: "Enable proposer boost to reward a timely block",
    defaultDescription: String(defaultOptions.chain.proposerBoost),
    group: "chain",
  },

  "chain.proposerBoostReorg": {
    hidden: true,
    type: "boolean",
    description: "Enable proposer boost reorg to reorg out a late block",
    defaultDescription: String(defaultOptions.chain.proposerBoostReorg),
    group: "chain",
  },

  "chain.disableImportExecutionFcU": {
    hidden: true,
    type: "boolean",
    description: "Disable issuing FcUs to the execution engine on block import",
    group: "chain",
  },

  "chain.preaggregateSlotDistance": {
    hidden: true,
    type: "number",
    description: "Only preaggregate attestations or sync committee message since clockSlot - preaggregateSlotDistance",
    group: "chain",
  },

  "chain.attDataCacheSlotDistance": {
    hidden: true,
    type: "number",
    description: "Only cache AttestationData since clockSlot - attDataCacheSlotDistance",
    group: "chain",
  },

  "chain.computeUnrealized": {
    hidden: true,
    type: "boolean",
    description: "Compute unrealized checkpoints and use it in fork choice or not",
    defaultDescription: String(defaultOptions.chain.computeUnrealized),
    group: "chain",
  },

  "chain.maxSkipSlots": {
    hidden: true,
    type: "number",
    description: "Refuse to skip more than this many slots when processing a block or attestation",
    group: "chain",
  },

  "chain.assertCorrectProgressiveBalances": {
    hidden: true,
    description: "Enable asserting the progressive balances",
    type: "boolean",
    group: "chain",
  },

  "safe-slots-to-import-optimistically": {
    hidden: true,
    type: "number",
    description:
      "Slots from current (clock) slot till which its safe to import a block optimistically if the merge is not justified yet.",
    default: defaultOptions.chain.safeSlotsToImportOptimistically,
    group: "chain",
  },

  "chain.archiveStateEpochFrequency": {
    description: "Minimum number of epochs between archived states",
    default: defaultOptions.chain.archiveStateEpochFrequency,
    type: "number",
    group: "chain",
  },

  "chain.archiveMode": {
    hidden: true,
    choices: Object.values(ArchiveMode),
    description: `Strategy to manage archive states, only support ${DEFAULT_ARCHIVE_MODE} at this time`,
    default: defaultOptions.chain.archiveMode,
    type: "string",
    group: "chain",
  },

  broadcastValidationStrictness: {
    // TODO: hide the option till validations fully implemented
    hidden: true,
    description:
      "'warn' or 'error' - options to either throw error or to log warning when broadcast validation can't be performed",
    type: "string",
    default: "warn",
  },

  "chain.minSameMessageSignatureSetsToBatch": {
    hidden: true,
    description: "Minimum number of same message signature sets to batch",
    type: "number",
    default: defaultOptions.chain.minSameMessageSignatureSetsToBatch,
    group: "chain",
  },

  "chain.maxShufflingCacheEpochs": {
    hidden: true,
    description: "Maximum ShufflingCache epochs to keep in memory",
    type: "number",
    default: defaultOptions.chain.maxShufflingCacheEpochs,
    group: "chain",
  },

  "chain.archiveDataEpochs": {
    alias: "chain.archiveBlobEpochs",
    description:
      "Number of epochs to retain finalized blobs/columns (minimum of MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS/MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS)",
    type: "number",
    group: "chain",
  },

  "chain.nHistoricalStates": {
    hidden: true,
    description:
      "Use the new FIFOBlockStateCache and PersistentCheckpointStateCache or not which make lodestar heap size bounded instead of unbounded as before",
    type: "boolean",
    default: defaultOptions.chain.nHistoricalStates,
    group: "chain",
  },

  "chain.nHistoricalStatesFileDataStore": {
    hidden: true,
    description: "Use fs to store checkpoint state for PersistentCheckpointStateCache or not",
    type: "boolean",
    default: defaultOptions.chain.nHistoricalStatesFileDataStore,
    group: "chain",
  },

  "chain.maxBlockStates": {
    hidden: true,
    description: "Max block states to cache in memory, used for FIFOBlockStateCache",
    type: "number",
    default: defaultOptions.chain.maxBlockStates,
    group: "chain",
  },

  "chain.maxCPStateEpochsInMemory": {
    hidden: true,
    description: "Max epochs to cache checkpoint states in memory, used for PersistentCheckpointStateCache",
    type: "number",
    default: defaultOptions.chain.maxCPStateEpochsInMemory,
    group: "chain",
  },

  "chain.maxCPStateEpochsOnDisk": {
    hidden: true,
    description: "Max epochs to cache checkpoint states on disk, used for PersistentCheckpointStateCache",
    type: "number",
    default: defaultOptions.chain.maxCPStateEpochsOnDisk,
    group: "chain",
  },

  "chain.pruneHistory": {
    description: "Prune historical blocks and state",
    type: "boolean",
    default: defaultOptions.chain.pruneHistory,
    group: "chain",
  },
};
