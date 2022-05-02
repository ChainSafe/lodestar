import {ICliCommand} from "../../util";
import {IGlobalArgs} from "../../options";
import {validatorMonitorOptions, IValidatorMonitorArgs} from "./options";
import {validatorMonitorHandler} from "./handler";

export const validatorMonitor: ICliCommand<IValidatorMonitorArgs, IGlobalArgs> = {
  command: "validatorMonitor",
  describe: "Monitor validator given a validator index range",
  examples: [
    {
      command:
        "validatorMonitor --network prater --beaconApiUrl http://localhost:9596 --validatorIndexes 200008..200015",
      description: "Run validatorMonitor with prater network",
    },
  ],
  options: validatorMonitorOptions,
  handler: validatorMonitorHandler,
};
