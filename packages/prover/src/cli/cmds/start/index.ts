import {CliCommand, CliCommandOptions} from "../../../utils/command.js";
import {startHandler} from "./handler.js";
import {StartArgs, startOptions} from "./options.js";

export const start: CliCommand<StartArgs> = {
  command: "start",
  describe: "Start proxy server",
  examples: [
    {
      command:
        "start --network sepolia --execution-rpc https://lodestar-sepoliarpc.chainsafe.io --mode rest --beacon-rpc https://lodestar-sepolia.chainsafe.io",
      description: "Start a proxy server and connect to the sepolia testnet",
    },
  ],
  options: startOptions as CliCommandOptions<StartArgs>,
  handler: startHandler,
};
