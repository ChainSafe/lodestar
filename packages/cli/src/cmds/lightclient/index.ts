import {ICliCommand} from "../../util";
import {IGlobalArgs} from "../../options";
import {ILightClientArgs, lightclientOptions} from "./options";
import {lightclientHandler} from "./handler";

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
