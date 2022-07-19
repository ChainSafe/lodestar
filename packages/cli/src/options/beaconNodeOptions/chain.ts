import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {ICliCommandOptions} from "../../util/index.js";

export interface IChainArgs {
  "chain.blsVerifyAllMultiThread": boolean;
  "chain.blsVerifyAllMainThread": boolean;
  "chain.disableBlsBatchVerify": boolean;
  "chain.persistInvalidSszObjects": boolean;
  // No need to define chain.persistInvalidSszObjects as part of IChainArgs
  // as this is defined as part of IBeaconPaths
  // "chain.persistInvalidSszObjectsDir": string;
  "chain.proposerBoostEnabled": boolean;
  "chain.computeUnrealized": boolean;
  "chain.defaultFeeRecipient": string;
  "chain.assertCorrectProgressiveBalances": boolean;
  "chain.maxSkipSlots": number;
  "safe-slots-to-import-optimistically": number;
}

export function parseArgs(args: IChainArgs): IBeaconNodeOptions["chain"] {
  return {
    blsVerifyAllMultiThread: args["chain.blsVerifyAllMultiThread"],
    blsVerifyAllMainThread: args["chain.blsVerifyAllMainThread"],
    disableBlsBatchVerify: args["chain.disableBlsBatchVerify"],
    persistInvalidSszObjects: args["chain.persistInvalidSszObjects"],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    persistInvalidSszObjectsDir: undefined as any,
    proposerBoostEnabled: args["chain.proposerBoostEnabled"],
    computeUnrealized: args["chain.computeUnrealized"],
    defaultFeeRecipient: args["chain.defaultFeeRecipient"],
    assertCorrectProgressiveBalances: args["chain.assertCorrectProgressiveBalances"],
    maxSkipSlots: args["chain.maxSkipSlots"],
    safeSlotsToImportOptimistically: args["safe-slots-to-import-optimistically"],
  };
}

export const options: ICliCommandOptions<IChainArgs> = {
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

  "chain.persistInvalidSszObjects": {
    hidden: true,
    type: "boolean",
    description: "Persist invalid ssz objects or not for debugging purpose",
    group: "chain",
  },

  "chain.proposerBoostEnabled": {
    type: "boolean",
    description: "Enable proposer boost to reward a timely block",
    defaultDescription: String(defaultOptions.chain.proposerBoostEnabled),
    group: "chain",
  },

  "chain.computeUnrealized": {
    type: "boolean",
    description: "Compute unrealized checkpoints and use it in fork choice or not",
    defaultDescription: String(defaultOptions.chain.computeUnrealized),
    group: "chain",
  },

  "chain.defaultFeeRecipient": {
    type: "string",
    description:
      "Specify fee recipient default for collecting the EL block fees and rewards (a hex string representing 20 bytes address: ^0x[a-fA-F0-9]{40}$) in case validator fails to update for a validator index before calling produceBlock.",
    defaultDescription: defaultOptions.chain.defaultFeeRecipient,
    group: "chain",
  },

  "chain.maxSkipSlots": {
    hidden: true,
    type: "number",
    description: "Refuse to skip more than this many slots when processing a block or attestation",
    group: "chain",
  },

  "chain.assertCorrectProgressiveBalances": {
    description: "Enable asserting the progressive balances",
    type: "boolean",
    group: "chain",
  },

  "safe-slots-to-import-optimistically": {
    hidden: true,
    type: "number",
    description:
      "Slots from current (clock) slot till which its safe to import a block optimistically if the merge is not justified yet.",
    defaultDescription: String(defaultOptions.chain.safeSlotsToImportOptimistically),
    group: "chain",
  },
};
