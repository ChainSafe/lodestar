import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions} from "../../util";

export interface IChainArgs {
  "chain.useSingleThreadVerifier": boolean;
}

export function parseArgs(args: IChainArgs): IBeaconNodeOptions["chain"] {
  return {
    useSingleThreadVerifier: args["chain.useSingleThreadVerifier"],
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
};
