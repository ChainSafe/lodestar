import {ICliCommand} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {ExecutionEngineArgs} from "../../options/beaconNodeOptions/execution.js";
import {ILightClientArgs, lightclientOptions} from "./options.js";
import {lightclientHandler} from "./handler.js";

export const lightclient: ICliCommand<ILightClientArgs & ExecutionEngineArgs, IGlobalArgs> = {
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
