import * as path from "node:path";
import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "../../util/index.js";

export type ChainArgs = {
  suggestedFeeRecipient: string;
  "chain.blsVerifyAllMultiThread"?: boolean;
  "chain.blsVerifyAllMainThread"?: boolean;
  "chain.disableBlsBatchVerify"?: boolean;
  "chain.persistProducedBlocks"?: boolean;
  "chain.persistInvalidSszObjects"?: boolean;
  // No need to define chain.persistInvalidSszObjects as part of ChainArgs
  // as this is defined as part of BeaconPaths
  // "chain.persistInvalidSszObjectsDir": string;
  "chain.proposerBoostEnabled"?: boolean;
  "chain.disableImportExecutionFcU"?: boolean;
  "chain.preaggregateSlotDistance"?: number;
  "chain.attDataCacheSlotDistance"?: number;
  "chain.computeUnrealized"?: boolean;
  "chain.assertCorrectProgressiveBalances"?: boolean;
  "chain.maxSkipSlots"?: number;
  "chain.trustedSetup"?: string;
  "safe-slots-to-import-optimistically": number;
  "chain.archiveStateEpochFrequency": number;
  emitPayloadAttributes?: boolean;
  broadcastValidationStrictness?: string;
  "chain.minSameMessageSignatureSetsToBatch"?: number;
  "chain.maxShufflingCacheEpochs"?: number;
  "chain.nHistoricalStates"?: boolean;
  "chain.maxBlockStates"?: number;
  "chain.maxCPStateEpochsInMemory"?: number;
};

export function parseArgs(args: ChainArgs): IBeaconNodeOptions["chain"] {
  return {
    suggestedFeeRecipient: args["suggestedFeeRecipient"],
    blsVerifyAllMultiThread: args["chain.blsVerifyAllMultiThread"],
    blsVerifyAllMainThread: args["chain.blsVerifyAllMainThread"],
    disableBlsBatchVerify: args["chain.disableBlsBatchVerify"],
    persistProducedBlocks: args["chain.persistProducedBlocks"],
    persistInvalidSszObjects: args["chain.persistInvalidSszObjects"],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    persistInvalidSszObjectsDir: undefined as any,
    proposerBoostEnabled: args["chain.proposerBoostEnabled"],
    disableImportExecutionFcU: args["chain.disableImportExecutionFcU"],
    preaggregateSlotDistance: args["chain.preaggregateSlotDistance"],
    attDataCacheSlotDistance: args["chain.attDataCacheSlotDistance"],
    computeUnrealized: args["chain.computeUnrealized"],
    assertCorrectProgressiveBalances: args["chain.assertCorrectProgressiveBalances"],
    maxSkipSlots: args["chain.maxSkipSlots"],
    trustedSetup: args["chain.trustedSetup"],
    safeSlotsToImportOptimistically: args["safe-slots-to-import-optimistically"],
    archiveStateEpochFrequency: args["chain.archiveStateEpochFrequency"],
    emitPayloadAttributes: args["emitPayloadAttributes"],
    broadcastValidationStrictness: args["broadcastValidationStrictness"],
    minSameMessageSignatureSetsToBatch:
      args["chain.minSameMessageSignatureSetsToBatch"] ?? defaultOptions.chain.minSameMessageSignatureSetsToBatch,
    maxShufflingCacheEpochs: args["chain.maxShufflingCacheEpochs"] ?? defaultOptions.chain.maxShufflingCacheEpochs,
    nHistoricalStates: args["chain.nHistoricalStates"] ?? defaultOptions.chain.nHistoricalStates,
    maxBlockStates: args["chain.maxBlockStates"] ?? defaultOptions.chain.maxBlockStates,
    maxCPStateEpochsInMemory: args["chain.maxCPStateEpochsInMemory"] ?? defaultOptions.chain.maxCPStateEpochsInMemory,
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

  "chain.proposerBoostEnabled": {
    hidden: true,
    type: "boolean",
    description: "Enable proposer boost to reward a timely block",
    defaultDescription: String(defaultOptions.chain.proposerBoostEnabled),
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

  "chain.trustedSetup": {
    hidden: true,
    type: "string",
    description: "Use a customized trustedSetup to verify blobSidecars",
    group: "chain",
    coerce: (arg: string) => (arg ? path.resolve(arg) : undefined),
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
    hidden: true,
    description: "Minimum number of epochs between archived states",
    default: defaultOptions.chain.archiveStateEpochFrequency,
    type: "number",
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

  "chain.nHistoricalStates": {
    hidden: true,
    description:
      "Use the new FIFOBlockStateCache and PersistentCheckpointStateCache or not which make lodestar heap size bounded instead of unbounded as before",
    type: "boolean",
    default: defaultOptions.chain.nHistoricalStates,
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
};
