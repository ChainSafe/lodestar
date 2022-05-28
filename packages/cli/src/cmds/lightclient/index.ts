import {ICliCommand} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {ILightClientArgs, lightclientOptions} from "./options.js";
import {lightclientHandler} from "./handler.js";

export const lightclient: ICliCommand<ILightClientArgs, IGlobalArgs> = {
  command: "lightclient",
  describe: "Run lightclient",
  examples: [
    {
      command: "lightclient --network prater",
      description: "Run lightclient with prater network",
    },
  ],
  options: lightclientOptions,
  handler: lightclientHandler,
};
