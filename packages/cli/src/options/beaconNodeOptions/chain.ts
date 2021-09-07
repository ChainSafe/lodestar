import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions} from "../../util";

export interface IChainArgs {
  "chain.useSingleThreadVerifier": boolean;
  "chain.disableBlsBatchVerify": boolean;
  "chain.persistInvalidSszObjects": boolean;
  // this is defined as part of IBeaconPaths
  // "chain.persistInvalidSszObjectsDir": string;
}

export function parseArgs(args: IChainArgs): IBeaconNodeOptions["chain"] {
  return {
    useSingleThreadVerifier: args["chain.useSingleThreadVerifier"],
    disableBlsBatchVerify: args["chain.disableBlsBatchVerify"],
    persistInvalidSszObjects: args["chain.persistInvalidSszObjects"],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    persistInvalidSszObjectsDir: undefined as any,
  };
}

export const options: ICliCommandOptions<IChainArgs> = {
  "chain.useSingleThreadVerifier": {
    hidden: true,
    type: "boolean",
    description: "Disable spawning worker threads for BLS verification, use single thread implementation.",
    defaultDescription: String(defaultOptions.chain.useSingleThreadVerifier),
    group: "chain",
  },

  "chain.disableBlsBatchVerify": {
    hidden: true,
    type: "boolean",
    description:
      "Do not use BLS batch verify to validate all block signatures at once. \
Will double processing times. Use only for debugging purposes.",
    defaultDescription: String(defaultOptions.chain.disableBlsBatchVerify),
    group: "chain",
  },

  "chain.persistInvalidSszObjects": {
    hidden: true,
    type: "boolean",
    description: "Persist invalid ssz objects or not for debugging purpose",
    group: "chain",
  },
};
