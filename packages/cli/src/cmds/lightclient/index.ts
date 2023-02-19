import {CliCommand} from "../../util/index.js";
import {GlobalArgs} from "../../options/index.js";
import {ILightClientArgs, lightclientOptions} from "./options.js";
import {lightclientHandler} from "./handler.js";

export const lightclient: CliCommand<ILightClientArgs, GlobalArgs> = {
  command: "lightclient",
  describe: "Run lightclient",
  examples: [
    {
      command: "lightclient --network goerli",
      description: "Run lightclient with goerli network",
    },
  ],
  options: lightclientOptions,
  handler: lightclientHandler,
};
