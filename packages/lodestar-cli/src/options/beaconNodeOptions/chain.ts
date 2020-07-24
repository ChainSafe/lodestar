import {Options} from "yargs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

export const chainOptions = {
  "chain.name": {
    alias: ["chain.preset"],
    description: "Chain configuration",
    type: "string",
    choices: ["mainnet", "minimal"],
    defaultDescription: defaultOptions.chain.name
  } as Options,
};
