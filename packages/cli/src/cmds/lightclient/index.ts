import {CliCommand} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {lightclientHandler} from "./handler.js";
import {ILightClientArgs, lightclientOptions} from "./options.js";

export const lightclient: CliCommand<ILightClientArgs, GlobalArgs> = {
  command: "lightclient",
  describe: "Run lightclient",
  docsFolder: "libraries/lightclient-prover",
  examples: [
    {
      command: "lightclient --network holesky",
      description: "Run lightclient with holesky network",
    },
  ],
  options: lightclientOptions,
  handler: lightclientHandler,
};
